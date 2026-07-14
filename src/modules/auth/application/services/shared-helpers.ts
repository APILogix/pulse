/**
 * Auth service — business logic.
 *
 * Responsibilities:
 *   - User lifecycle: register, profile, soft-delete, restore, suspend.
 *   - Authentication: password login with optional MFA, session issuance.
 *   - Session management: refresh-token rotation with reuse detection AND a
 *     short retry-grace window, listing, revoke, "logout from everywhere".
 *   - MFA: TOTP setup, verify-setup, step-up challenges, backup codes,
 *     primary-device selection, two-step disable (email-confirmation).
 *   - Password: change (re-auths and keeps current session), reset (full
 *     session purge), forgot-password (no enumeration).
 *
 * Conventions:
 *   - All thrown errors are AuthError (typed) so the routes layer maps them
 *     to HTTP responses without leaking internals.
 *   - Sensitive bearer credentials are stored only as SHA-256 hashes.
 *   - Login responses are timing-equalized to defeat user enumeration.
 *   - Multi-row mutations are wrapped in withTransaction.
 *   - Auth runs Redis-free; revocation/challenge state lives in an
 *     in-process LRU (see `cache.ts`). DB-level state (sessions, users,
 *     email tokens) is the cross-process source of truth.
 *   - Email via the Postgres-backed auth outbox worker (queue-only).
 */
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'crypto';
import { promisify } from 'util';

import bcrypt from 'bcrypt';
import * as OTPAuth from 'otpauth';
import QRCode from 'qrcode';

import { env as config } from '../../../../config/env.js';
import { logger } from '../../../../config/logger.js';
import { authEmail } from '../../infrastructure/email/auth-email.js';
import { isLoginTrustedDevice, trustCurrentDevice } from '../../application/services/trusted-device.service.js';
import {
  emailVerificationTemplate,
  mfaCodeTemplate,
  mfaDisableConfirmTemplate,
  mfaStatusTemplate,
  passwordResetTemplate,
} from '../../../../shared/email/templates.js';
import { logAudit } from '../../../../shared/middleware/audit-logger.js';
import { buildSessionDeviceLabel } from '../../../../shared/utils/request.js';
import {
  decrypt,
  encrypt,
  hashPassword,
  verifyPassword,
} from '../../../../shared/utils/encryption.js';
import { generateId } from '../../../../shared/utils/id.js';

import {
  blacklistAccessToken,
  loginMfaChallengeCache,
  mfaBackupTempCache,
  recordStepUpFreshness,
  revokeAllUserTokens as cacheRevokeAllUserTokens,
  stepUpChallengeCache,
  type LoginMFAChallenge,
  type StepUpChallenge,
} from '../../infrastructure/cache/auth.cache.js';
import {
  assertLoginAllowedByOrgPolicy,
  assertRefreshAllowedByOrgPolicy,
  assertMfaEnrollmentAllowed,
} from '../../domain/policies.js';
import * as repository from '../../infrastructure/repositories/index.js';
import {
  AuthError,
  AuthErrorCodes,
  type BackupCodeLoginInput,
  type ChangePasswordInput,
  type CreateUserInput,
  type DeleteUserInput,
  type EmailMFASetup,
  type ForgotPasswordInput,
  type ListUsersQueryInput,
  type LoginInput,
  type LoginMFAVerifyInput,
  type MFAChallenge,
  type MFADevice,
  type MFADisableConfirmInput,
  type MFADisableRequestInput,
  type MFAType,
  type MFASetupInput,
  type MFAToggleInput,
  type MFAVerifyInput,
  type MFAVerifySetupInput,
  type RegenerateBackupCodesInput,
  type ResendVerificationInput,
  type ResetPasswordInput,
  type SessionInfo,
  type TOTPSetup,
  type AdminLockUserInput,
  type UpdateUserInput,
  type User,
  type UserProfile,
  type UserSecuritySummary,
  type VerifyEmailInput,
} from '../../domain/types.js';
import { ABSOLUTE_SESSION_TTL_SECONDS, ACCESS_TOKEN_TTL_SECONDS, buildPasswordHistory, EMAIL_VERIFICATION_TTL_SECONDS, MFA_DISABLE_TOKEN_TTL_SECONDS, MFA_LOGIN_CHALLENGE_TTL_SECONDS, normalizeEmail, PASSWORD_RESET_TTL_SECONDS, REFRESH_GRACE_WINDOW_MS, REFRESH_TOKEN_TTL_SECONDS, REMEMBER_ME_REFRESH_TTL_SECONDS, STEP_UP_CHALLENGE_TTL_SECONDS } from '../../domain/constants.js';
import { buildDeviceFingerprint, generateEmailFlowToken, hashEmailFlowToken, hashToken as hashAuthToken, timingSafeFakePasswordCompare } from '../../infrastructure/crypto/hash.js';
import { generateAccessToken, generateRefreshToken, verifyRefreshToken } from '../../infrastructure/crypto/jwt.js';
import { logout } from './session.service.js';



// ============================================================================
// CONSTANTS
// ============================================================================

export const SESSION_CONFIG = {
  MAX_ACTIVE_SESSIONS: 10,
};

export const TOTP_CONFIG = {
  // SHA-1 maximizes authenticator-app compatibility (Google Authenticator
  // does not support algorithm overrides via the otpauth URI). The TOTP
  // threat model depends on secret entropy, not hash strength.
  algorithm: 'SHA1' as const,
  digits: 6,
  period: 30,
  window: 1,
};

// Email OTP: 6-digit numeric code, 10-minute TTL.
export const EMAIL_MFA_OTP_TTL_SECONDS = 10 * 60;
export const EMAIL_MFA_OTP_DIGITS = 6;

export const GENERIC_PASSWORD_RESET_MESSAGE =
  'If the email exists, a password reset link has been sent';
export const GENERIC_VERIFICATION_MESSAGE =
  'If the account exists and is not verified, a verification email has been sent';
export const GENERIC_REGISTRATION_MESSAGE =
  'Account creation request received. Check your email to continue.';

export const randomBytesAsync = promisify(randomBytes);

export function looksLikeRawUserAgent(value: string | null | undefined): boolean {
  if (!value) return false;
  return /mozilla\/|chrome\/|safari\/|firefox\/|edg\/|android|iphone|ipad/i.test(value);
}

export function getSessionDeviceName(session: {
  device_name: string | null;
  device_type: string | null;
  user_agent?: string | null;
}): string {
  if (session.device_name && !looksLikeRawUserAgent(session.device_name)) {
    return session.device_name;
  }

  if (session.user_agent) {
    return buildSessionDeviceLabel(session.user_agent, session.device_type);
  }

  return buildSessionDeviceLabel('unknown', session.device_type);
}

// ============================================================================
// SHARED HELPERS
// ============================================================================

/**
 * Backup codes: 10 random hex codes (20 hex chars = 80 bits each), shown
 * once. Persisted as bcrypt hashes (saltRounds=10) to resist rainbow-table
 * attacks if the DB is ever leaked. 80 bits of raw entropy still makes
 * online brute-force infeasible.
 */
export async function generateBackupCodes(): Promise<{
  plain: string[];
  hashed: string[];
}> {
  const codes: string[] = [];
  for (let i = 0; i < 10; i++) {
    // BUG-015 FIX: 16 bytes per code = 128 bits of entropy.
    // OWASP 2023 recommends ≥ 128 bits for recovery codes (≥20 bits/char).
    const bytes = await randomBytesAsync(16);
    codes.push(bytes.toString('hex'));
  }
  // BUG-012 FIX: use bcrypt instead of SHA-256 for backup-code storage.
  const hashed = await Promise.all(
    codes.map((code) => bcrypt.hash(code, 10)),
  );
  return { plain: codes, hashed };
}

export function verifyBackupCodeHash(plain: string, hashed: string): boolean {
  // BUG-012 FIX: delegate to bcrypt.compare for constant-time verification.
  return bcrypt.compareSync(plain, hashed);
}


export function emailToHash(email: string): string {
  return createHash('sha256').update(normalizeEmail(email)).digest('hex');
}

export function toUserProfile(user: User): UserProfile {
  return {
    id: user.id,
    email: user.email,
    email_is_verified: user.email_is_verified,
    full_name: user.full_name,
    avatar_url: user.avatar_url,
    status: user.status,
    is_admin: user.is_admin === true,
    mfa_enabled: user.mfa_enabled,
    timezone: user.timezone,
    locale: user.locale,
    last_login_at: user.last_login_at,
    created_at: user.created_at,
  };
}

export function assertUserUsable(user: User): void {
  if (user.deleted_at) {
    throw new AuthError(
      'User account has been deleted',
      AuthErrorCodes.USER_DELETED,
      403,
    );
  }
  if (user.status === 'suspended') {
    throw new AuthError(
      `Account suspended: ${user.status_reason || 'Contact support'}`,
      AuthErrorCodes.USER_SUSPENDED,
      403,
    );
  }
  if (user.locked_until && user.locked_until > new Date()) {
    throw new AuthError(
      `Account locked until ${user.locked_until.toISOString()}`,
      AuthErrorCodes.ACCOUNT_LOCKED,
      423,
      { lockedUntil: user.locked_until },
    );
  }
}

export function getUserPasswordHashes(user: User): string[] {
  const history = Array.isArray(user.password_history)
    ? user.password_history.filter(
        (entry): entry is string => typeof entry === 'string',
      )
    : [];
  return [user.password_hash, ...history].filter(
    (entry): entry is string => Boolean(entry),
  );
}

export async function ensurePasswordNotReused(
  user: User,
  newPassword: string,
): Promise<void> {
  for (const hash of getUserPasswordHashes(user)) {
    if (await verifyPassword(newPassword, hash)) {
      throw new AuthError(
        'New password must not match a recent password',
        AuthErrorCodes.PASSWORD_REUSE_NOT_ALLOWED,
        400,
      );
    }
  }
}

// ----------------------------------------------------------------------------
// Session-revocation helpers (in-process LRU + DB row state)
// ----------------------------------------------------------------------------

/**
 * Mark every active access token issued for a user as dead. The middleware
 * compares the JWT iat against the cutoff; tokens issued at or before the
 * cutoff are rejected.
 */
export function markAllUserTokensRevoked(userId: string): void {
  cacheRevokeAllUserTokens(userId);
}

/** Revoke every active session for a user AND blacklist every in-flight token. */
export async function revokeAllSessionsAndTokens(
  userId: string,
  reason: string,
): Promise<number> {
  const count = await repository.revokeAllUserSessions(userId, reason);
  markAllUserTokensRevoked(userId);
  return count;
}

/**
 * Blacklist the access tokens of every OTHER active session for the user
 * (per-session entry in the LRU). Critically does NOT blacklist the caller's
 * current session token.
 */
export async function blacklistOtherUserSessionTokens(
  userId: string,
  currentSessionId: string,
): Promise<void> {
  const otherIds = await repository.listOtherActiveSessionIds(
    userId,
    currentSessionId,
  );
  for (const id of otherIds) {
    blacklistAccessToken(id);
  }
}

// ----------------------------------------------------------------------------
// TOTP helpers
// ----------------------------------------------------------------------------

/** Mask an email for display hints: "jane.doe@example.com" -> "j•••@example.com". */
export function maskEmailForHint(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain || !local) return 'Email code';
  const head = local.slice(0, 1);
  return `${head}•••@${domain}`;
}

/**
 * Build the masked "try another way" display hint for a device. TOTP and
 * hardware keys fall back to the user-chosen device name; email/SMS are masked.
 */
export function buildMfaDisplayHint(
  deviceType: MFAType,
  deviceName: string,
  opts: { email?: string | null } = {},
): string {
  switch (deviceType) {
    case 'email':
      return opts.email ? maskEmailForHint(opts.email) : 'Email code';
    case 'totp':
      return deviceName?.trim() || 'Authenticator App';
    case 'hardware_key':
      return deviceName?.trim() || 'Security key';
    case 'sms':
      return deviceName?.trim() || 'Text message';
    case 'backup_codes':
      return 'Backup code';
    default:
      return deviceName?.trim() || 'Verification method';
  }
}

export function buildTotp(secretBase32: string, label?: string): OTPAuth.TOTP {
  return new OTPAuth.TOTP({
    issuer: config.APP_NAME.replace(/\s+/g, '_'), // QR-safe
    label: label || config.APP_NAME,
    algorithm: TOTP_CONFIG.algorithm,
    digits: TOTP_CONFIG.digits,
    period: TOTP_CONFIG.period,
    secret: OTPAuth.Secret.fromBase32(secretBase32),
  });
}

export function verifyTotpDeviceCode(device: MFADevice, code: string): boolean {
  if (device.device_type !== 'totp' || !device.secret_encrypted) {
    return false;
  }
  try {
    const secret = decrypt(device.secret_encrypted, config.ENCRYPTION_KEY);
    const totp = buildTotp(secret);
    return totp.validate({ token: code, window: TOTP_CONFIG.window }) !== null;
  } catch (err: any) {
    logger.error({ err, deviceId: device.id }, 'TOTP verification failed');
    return false;
  }
}

export async function consumeBackupCode(
  userId: string,
  code: string,
  ipAddress = '0.0.0.0',
): Promise<boolean> {
  const normalized = code.toLowerCase();
  const codes = await repository.getUnusedBackupCodes(userId);

  for (const backupCode of codes) {
    const hashedCode = typeof backupCode.code_hash === 'string' ? backupCode.code_hash : '';
    if (verifyBackupCodeHash(normalized, hashedCode)) {
      await repository.markBackupCodeUsed(backupCode.id, userId, ipAddress);
      return true;
    }
  }
  return false;
}

