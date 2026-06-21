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
 *   - Email via authEmail (sync SMTP or Postgres outbox when AUTH_EMAIL_ASYNC=true).
 */
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'crypto';
import { promisify } from 'util';

import bcrypt from 'bcrypt';
import * as OTPAuth from 'otpauth';
import QRCode from 'qrcode';

import { env as config } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { authEmail } from './auth-email.js';
import { isLoginTrustedDevice, trustCurrentDevice } from './trusted-device.service.js';
import {
  emailVerificationTemplate,
  mfaCodeTemplate,
  mfaDisableConfirmTemplate,
  mfaStatusTemplate,
  passwordResetTemplate,
} from '../../shared/email/templates.js';
import { logAudit } from '../../shared/middleware/audit-logger.js';
import {
  decrypt,
  encrypt,
  hashPassword,
  verifyPassword,
} from '../../shared/utils/encryption.js';
import { generateId } from '../../shared/utils/id.js';

import {
  blacklistAccessToken,
  loginMfaChallengeCache,
  mfaBackupTempCache,
  recordStepUpFreshness,
  revokeAllUserTokens as cacheRevokeAllUserTokens,
  stepUpChallengeCache,
  type LoginMFAChallenge,
  type StepUpChallenge,
} from './cache.js';
import {
  assertLoginAllowedByOrgPolicy,
  assertRefreshAllowedByOrgPolicy,
} from './policy.service.js';
import * as repository from './repository.js';
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
  type VerifyEmailQueryInput,
} from './types.js';
import {
  ABSOLUTE_SESSION_TTL_SECONDS,
  ACCESS_TOKEN_TTL_SECONDS,
  buildDeviceFingerprint,
  buildPasswordHistory,
  EMAIL_VERIFICATION_TTL_SECONDS,
  generateAccessToken,
  generateRefreshToken,
  generateSecureToken,
  hashEmailFlowToken,
  hashToken as hashAuthToken,
  MFA_DISABLE_TOKEN_TTL_SECONDS,
  MFA_LOGIN_CHALLENGE_TTL_SECONDS,
  normalizeEmail,
  PASSWORD_RESET_TTL_SECONDS,
  REFRESH_GRACE_WINDOW_MS,
  REFRESH_TOKEN_TTL_SECONDS,
  REMEMBER_ME_REFRESH_TTL_SECONDS,
  STEP_UP_CHALLENGE_TTL_SECONDS,
  timingSafeFakePasswordCompare,
  verifyRefreshToken,
} from './utils.js';

// ============================================================================
// CONSTANTS
// ============================================================================

const SESSION_CONFIG = {
  MAX_ACTIVE_SESSIONS: 10,
};

const TOTP_CONFIG = {
  // SHA-1 maximizes authenticator-app compatibility (Google Authenticator
  // does not support algorithm overrides via the otpauth URI). The TOTP
  // threat model depends on secret entropy, not hash strength.
  algorithm: 'SHA1' as const,
  digits: 6,
  period: 30,
  window: 1,
};

// Email OTP: 6-digit numeric code, 10-minute TTL.
const EMAIL_MFA_OTP_TTL_SECONDS = 10 * 60;
const EMAIL_MFA_OTP_DIGITS = 6;

const GENERIC_PASSWORD_RESET_MESSAGE =
  'If the email exists, a password reset link has been sent';
const GENERIC_VERIFICATION_MESSAGE =
  'If the account exists and is not verified, a verification email has been sent';
const GENERIC_REGISTRATION_MESSAGE =
  'Account creation request received. Check your email to continue.';

const randomBytesAsync = promisify(randomBytes);

// ============================================================================
// EMAIL HELPERS
// ============================================================================

function getBaseUrl(value: string | undefined, fallback: string): string {
  return (value || fallback).replace(/\/+$/, '');
}

function buildVerifyEmailUrl(token: string): string {
  // Verification links open in the SPA (same as password reset / MFA disable).
  return `${getBaseUrl(config.FRONTEND_URL, config.APP_URL)}/verify-email?token=${encodeURIComponent(token)}`;
}

function buildResetPasswordUrl(token: string): string {
  return `${getBaseUrl(config.FRONTEND_URL, config.APP_URL)}/reset-password?token=${encodeURIComponent(token)}`;
}

function buildMfaDisableConfirmUrl(token: string): string {
  return `${getBaseUrl(config.FRONTEND_URL, config.APP_URL)}/security/mfa/disable?token=${encodeURIComponent(token)}`;
}

function toMinutes(seconds: number): number {
  return Math.ceil(seconds / 60);
}

async function sendVerificationEmail(
  user: Pick<User, 'email' | 'full_name'>,
  token: string,
): Promise<void> {
  try {
    await authEmail.send({
      to: user.email,
      ...emailVerificationTemplate({
        appName: config.APP_NAME,
        userName: user.full_name,
        actionUrl: buildVerifyEmailUrl(token),
        expiresInMinutes: toMinutes(EMAIL_VERIFICATION_TTL_SECONDS),
      }),
    });
  } catch (error) {
    logger.error({ err: error, to: user.email }, 'Verification email failed');
    throw new AuthError(
      'Unable to send verification email',
      AuthErrorCodes.EMAIL_DELIVERY_FAILED,
      503,
    );
  }
}

async function sendPasswordResetEmail(
  user: Pick<User, 'email' | 'full_name'>,
  token: string,
): Promise<void> {
  try {
    await authEmail.send({
      to: user.email,
      ...passwordResetTemplate({
        appName: config.APP_NAME,
        userName: user.full_name,
        actionUrl: buildResetPasswordUrl(token),
        expiresInMinutes: toMinutes(PASSWORD_RESET_TTL_SECONDS),
      }),
    });
  } catch (error) {
    // Password reset emails are NOT critical-path: we silently log and
    // return the generic enumeration-safe message at the route layer.
    logger.error({ err: error, to: user.email }, 'Password reset email failed');
  }
}

async function sendMFAStatusEmail(
  user: Pick<User, 'email' | 'full_name'>,
  enabled: boolean,
): Promise<void> {
  try {
    await authEmail.send({
      to: user.email,
      ...mfaStatusTemplate({
        appName: config.APP_NAME,
        userName: user.full_name,
        enabled,
      }),
    });
  } catch (error) {
    // Non-critical; the security action already succeeded.
    logger.warn({ err: error, to: user.email, enabled }, 'MFA status email failed');
  }
}

async function sendMfaDisableConfirmEmail(
  user: Pick<User, 'email' | 'full_name'>,
  token: string,
): Promise<void> {
  try {
    await authEmail.send({
      to: user.email,
      ...mfaDisableConfirmTemplate({
        appName: config.APP_NAME,
        userName: user.full_name,
        actionUrl: buildMfaDisableConfirmUrl(token),
        expiresInMinutes: toMinutes(MFA_DISABLE_TOKEN_TTL_SECONDS),
      }),
    });
  } catch (error) {
    logger.error({ err: error, to: user.email }, 'MFA disable email failed');
    throw new AuthError(
      'Unable to send MFA disable confirmation email',
      AuthErrorCodes.EMAIL_DELIVERY_FAILED,
      503,
    );
  }
}

// ============================================================================
// EMAIL MFA OTP HELPERS
// ============================================================================

/**
 * Generate a cryptographically random 6-digit numeric OTP.
 * Uses rejection sampling to avoid modulo bias.
 */
async function generateEmailMfaOtp(): Promise<string> {
  // 3 bytes = 24 bits; max value 16777215. We need 0-999999.
  // Rejection threshold: floor(16777216 / 1000000) * 1000000 = 16000000.
  // Values >= 16000000 are rejected to eliminate bias.
  const REJECTION_THRESHOLD = 16_000_000;
  const RANGE = 1_000_000;
  while (true) {
    const buf = await randomBytesAsync(3);
    const val = (buf[0]! << 16) | (buf[1]! << 8) | buf[2]!;
    if (val < REJECTION_THRESHOLD) {
      return val.toString(10).padStart(EMAIL_MFA_OTP_DIGITS, '0');
    }
  }
}

function hashEmailMfaOtp(code: string): string {
  return createHash('sha256').update(`email_mfa_otp:${code}`).digest('hex');
}

/**
 * Persist an email MFA OTP. Any prior unconsumed OTP for the same device is
 * invalidated first so only the newest code is valid.
 */
async function createEmailMfaOtp(
  userId: string,
  deviceId: string,
  codeHash: string,
): Promise<void> {
  await repository.createEmailMfaOtp(userId, deviceId, codeHash, EMAIL_MFA_OTP_TTL_SECONDS);
}

/**
 * Atomically consume an email MFA OTP. Returns true if the code matched and
 * was not yet used/expired.
 */
async function consumeEmailMfaOtp(
  deviceId: string,
  codeHash: string,
): Promise<boolean> {
  return repository.consumeEmailMfaOtp(deviceId, codeHash);
}

async function sendEmailMfaOtpEmail(
  user: Pick<User, 'email' | 'full_name'>,
  code: string,
  deviceName: string,
  purpose: 'setup' | 'login' | 'challenge',
): Promise<void> {
  try {
    await authEmail.send({
      to: user.email,
      ...mfaCodeTemplate({
        appName: config.APP_NAME,
        userName: user.full_name,
        code,
        expiresInMinutes: toMinutes(EMAIL_MFA_OTP_TTL_SECONDS),
        purpose,
        deviceName,
      }),
    });
  } catch (error) {
    logger.error({ err: error, to: user.email }, 'Email MFA OTP send failed');
    throw new AuthError(
      'Unable to send MFA verification code',
      AuthErrorCodes.EMAIL_DELIVERY_FAILED,
      503,
    );
  }
}

// ============================================================================
// SHARED HELPERS
// ============================================================================

/**
 * Backup codes: 10 random hex codes (20 hex chars = 80 bits each), shown
 * once. Only the SHA-256 hash is persisted. 80 bits resists offline brute
 * force from a leaked DB while keeping the displayed code reasonable.
 */
async function generateBackupCodes(): Promise<{
  plain: string[];
  hashed: string[];
}> {
  const codes: string[] = [];
  for (let i = 0; i < 10; i++) {
    const bytes = await randomBytesAsync(10);
    codes.push(bytes.toString('hex'));
  }
  const hashed = codes.map((code) =>
    createHash('sha256').update(code).digest('hex'),
  );
  return { plain: codes, hashed };
}

function verifyBackupCodeHash(plain: string, hashed: string): boolean {
  const plainHash = createHash('sha256').update(plain).digest('hex');
  try {
    const a = Buffer.from(plainHash, 'hex');
    const b = Buffer.from(hashed, 'hex');
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}


function emailToHash(email: string): string {
  return createHash('sha256').update(normalizeEmail(email)).digest('hex');
}

function toUserProfile(user: User): UserProfile {
  return {
    id: user.id,
    email: user.email,
    email_verified: user.email_verified,
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

function assertUserUsable(user: User): void {
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

function getUserPasswordHashes(user: User): string[] {
  const history = Array.isArray(user.password_history)
    ? user.password_history.filter(
        (entry): entry is string => typeof entry === 'string',
      )
    : [];
  return [user.password_hash, ...history].filter(
    (entry): entry is string => Boolean(entry),
  );
}

async function ensurePasswordNotReused(
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
function markAllUserTokensRevoked(userId: string): void {
  cacheRevokeAllUserTokens(userId);
}

/** Revoke every active session for a user AND blacklist every in-flight token. */
async function revokeAllSessionsAndTokens(
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
async function blacklistOtherUserSessionTokens(
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

function buildTotp(secretBase32: string, label?: string): OTPAuth.TOTP {
  return new OTPAuth.TOTP({
    issuer: config.APP_NAME.replace(/\s+/g, '_'), // QR-safe
    label: label || config.APP_NAME,
    algorithm: TOTP_CONFIG.algorithm,
    digits: TOTP_CONFIG.digits,
    period: TOTP_CONFIG.period,
    secret: OTPAuth.Secret.fromBase32(secretBase32),
  });
}

function verifyTotpDeviceCode(device: MFADevice, code: string): boolean {
  if (device.device_type !== 'totp' || !device.secret_encrypted) {
    return false;
  }
  try {
    const secret = decrypt(device.secret_encrypted, config.ENCRYPTION_KEY);
    const totp = buildTotp(secret);
    return totp.validate({ token: code, window: TOTP_CONFIG.window }) !== null;
  } catch (err) {
    logger.error({ err, deviceId: device.id }, 'TOTP verification failed');
    return false;
  }
}

async function consumeBackupCode(
  userId: string,
  code: string,
): Promise<boolean> {
  const normalized = code.toLowerCase();
  const devices = await repository.findMFADevicesByUserId(userId, false);

  for (const device of devices) {
    const codes = Array.isArray(device.backup_codes_hash)
      ? device.backup_codes_hash.filter(
          (entry): entry is string => typeof entry === 'string',
        )
      : [];

    const matchIndex = codes.findIndex((hashedCode) =>
      verifyBackupCodeHash(normalized, hashedCode),
    );

    if (matchIndex >= 0) {
      codes.splice(matchIndex, 1);
      await repository.updateMFADeviceBackupCodes(
        device.id,
        codes.length > 0 ? codes : null,
      );
      return true;
    }
  }
  return false;
}

// ============================================================================
// SESSION ISSUANCE
// ============================================================================

export interface IssuedSession {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  sessionId: string;
}

/**
 * Single-INSERT session creation. We pre-allocate the session UUID and sign
 * both JWTs with it before writing any row, so there is no placeholder hash
 * window. The refresh JWT is hashed and persisted in the same INSERT.
 */
export interface SessionSsoContext {
  providerId?: string;
  loginMethod?: string;
  samlNameId?: string;
  samlSessionIndex?: string;
}

export async function issueSessionForUser(options: {
  user: User;
  ipAddress: string;
  userAgent: string;
  deviceName: string | undefined;
  deviceType: string | undefined;
  mfaVerified: boolean;
  rememberMe?: boolean;
  ssoContext?: SessionSsoContext;
}): Promise<IssuedSession> {
  const refreshTtlSeconds = options.rememberMe
    ? REMEMBER_ME_REFRESH_TTL_SECONDS
    : REFRESH_TOKEN_TTL_SECONDS;
  // Enforce session quota BEFORE the new INSERT.
  const activeCount = await repository.countActiveSessionsByUser(
    options.user.id,
  );
  if (activeCount >= SESSION_CONFIG.MAX_ACTIVE_SESSIONS) {
    await repository.revokeOldestSessions(
      options.user.id,
      SESSION_CONFIG.MAX_ACTIVE_SESSIONS - 1,
    );
  }

  const now = Date.now();
  const sessionId = randomUUID();
  const expiresAt = new Date(now + refreshTtlSeconds * 1000);
  const absoluteExpiresAt = new Date(now + ABSOLUTE_SESSION_TTL_SECONDS * 1000);

  const refreshToken = generateRefreshToken(
    options.user.id,
    sessionId,
    refreshTtlSeconds,
  );
  const refreshTokenHash = hashAuthToken(refreshToken);
  const accessToken = generateAccessToken(
    options.user.id,
    sessionId,
    options.mfaVerified,
  );

  const sso = options.ssoContext;
  await repository.createSession({
    id: sessionId,
    user_id: options.user.id,
    refresh_token_hash: refreshTokenHash,
    access_token_jti: sessionId,
    device_fingerprint: buildDeviceFingerprint(options.ipAddress, options.userAgent),
    device_name: options.deviceName || options.userAgent.slice(0, 255),
    device_type: options.deviceType || 'web',
    ip_address: options.ipAddress,
    user_agent: options.userAgent,
    expires_at: expiresAt,
    absolute_expires_at: absoluteExpiresAt,
    mfa_verified_at: options.mfaVerified ? new Date() : null,
    mfa_expires_at: options.mfaVerified
      ? new Date(now + ACCESS_TOKEN_TTL_SECONDS * 1000)
      : null,
    ...(sso?.providerId !== undefined ? { sso_provider_id: sso.providerId } : {}),
    ...(sso?.loginMethod !== undefined ? { login_method: sso.loginMethod } : {}),
    ...(sso?.samlNameId !== undefined ? { saml_name_id: sso.samlNameId } : {}),
    ...(sso?.samlSessionIndex !== undefined
      ? { saml_session_index: sso.samlSessionIndex }
      : {}),
  });

  return { accessToken, refreshToken, expiresAt, sessionId };
}

function createLoginMFAChallenge(options: {
  userId: string;
  device: MFADevice;
  ipAddress: string;
  userAgent: string;
  deviceName: string | undefined;
  clientDeviceType: string | undefined;
  rememberMe: boolean;
}): { challengeId: string; expiresAt: Date; deviceType: string } {
  const challengeId = generateId();
  const expiresAt = new Date(
    Date.now() + MFA_LOGIN_CHALLENGE_TTL_SECONDS * 1000,
  );

  const challenge: LoginMFAChallenge = {
    userId: options.userId,
    deviceId: options.device.id,
    deviceName: options.deviceName || options.userAgent.slice(0, 255),
    deviceType: options.device.device_type,
    clientDeviceType: options.clientDeviceType || 'web',
    ipAddress: options.ipAddress,
    userAgent: options.userAgent,
    attempts: 0,
    rememberMe: options.rememberMe,
  };

  loginMfaChallengeCache.set(challengeId, challenge);
  return { challengeId, expiresAt, deviceType: options.device.device_type };
}

// ============================================================================
// USER LIFECYCLE
// ============================================================================

/**
 * Register a user. To prevent email-existence enumeration, the route always
 * returns a generic 201 message regardless of whether the email is already
 * taken. When the email IS already taken we silently no-op (no second user
 * created) and emit an audit-only event so security teams can detect probes.
 */
export async function createUserFromEmail(
  input: CreateUserInput,
  ipAddress: string,
  requestId: string,
): Promise<void> {
  const normalizedEmail = normalizeEmail(input.email);
  const emailHash = emailToHash(normalizedEmail);

  const existing = await repository.findUserByEmailHash(emailHash);
  if (existing) {
    // Audit the probe; never differentiate to the caller.
    logAudit({
      user_id: existing.id,
      org_id: null,
      action: 'user.register_collision',
      resource_type: 'user',
      resource_id: existing.id,
      ip_address: ipAddress,
      request_id: requestId,
      metadata: { email_hash: emailHash },
    });
    return;
  }

  const passwordHash = await hashPassword(input.password);
  const verificationToken = generateSecureToken();
  const verificationTokenHash = hashEmailFlowToken(
    'email_verification',
    verificationToken,
  );
  const verificationExpiresAt = new Date(
    Date.now() + EMAIL_VERIFICATION_TTL_SECONDS * 1000,
  );

  const user = await repository.withTransaction(async (client) => {
    const created = await repository.createUser(
      {
        id: randomUUID(),
        email: normalizedEmail,
        full_name: input.full_name,
        avatar_url: input.avatar_url ?? null,
        password: passwordHash,
        accepted_terms_version: input.terms_version ?? null,
        accepted_privacy_version: input.privacy_version ?? null,
        marketing_consent: input.marketing_consent ?? false,
      },
      client,
    );

    await repository.createEmailVerification(
      {
        user_id: created.id,
        email: normalizedEmail,
        token_hash: verificationTokenHash,
        purpose: 'email_verification',
        expires_at: verificationExpiresAt,
      },
      client,
    );

    return created;
  });

  await sendVerificationEmail(user, verificationToken);

  logAudit({
    user_id: user.id,
    org_id: null,
    action: 'user.created',
    resource_type: 'user',
    resource_id: user.id,
    ip_address: ipAddress,
    request_id: requestId,
    metadata: { source: 'email_password', email_verified: false },
  });
}

export async function getCurrentUser(userId: string): Promise<UserProfile> {
  const user = await repository.findUserById(userId);
  if (!user) {
    throw new AuthError('User not found', AuthErrorCodes.USER_NOT_FOUND, 404);
  }
  assertUserUsable(user);
  return toUserProfile(user);
}

export async function updateCurrentUser(
  userId: string,
  input: UpdateUserInput,
): Promise<UserProfile> {
  const user = await repository.findUserById(userId);
  if (!user) {
    throw new AuthError('User not found', AuthErrorCodes.USER_NOT_FOUND, 404);
  }
  assertUserUsable(user);

  const updates: Partial<
    Pick<
      User,
      'full_name' | 'avatar_url' | 'timezone' | 'locale' | 'preferred_mfa_method'
    >
  > = {};
  if (input.full_name !== undefined) updates.full_name = input.full_name;
  if (input.avatar_url !== undefined) updates.avatar_url = input.avatar_url;
  if (input.timezone !== undefined) updates.timezone = input.timezone;
  if (input.locale !== undefined) updates.locale = input.locale;
  if (input.preferred_mfa_method !== undefined) {
    updates.preferred_mfa_method = input.preferred_mfa_method;
  }

  const updated = await repository.updateUser(userId, updates);
  if (!updated) {
    throw new AuthError('Update failed', AuthErrorCodes.USER_NOT_FOUND, 500);
  }
  return toUserProfile(updated);
}

export async function deleteCurrentUser(
  userId: string,
  input: DeleteUserInput,
  ipAddress: string,
  requestId: string,
): Promise<void> {
  const user = await repository.findUserById(userId);
  if (!user) {
    throw new AuthError('User not found', AuthErrorCodes.USER_NOT_FOUND, 404);
  }

  if (user.password_hash) {
    if (!input.password) {
      throw new AuthError(
        'Password required',
        AuthErrorCodes.PASSWORD_REQUIRED,
        400,
      );
    }
    const valid = await verifyPassword(input.password, user.password_hash);
    if (!valid) {
      throw new AuthError(
        'Password incorrect',
        AuthErrorCodes.PASSWORD_INCORRECT,
        401,
      );
    }
  }

  await repository.softDeleteUser(userId, input.reason || null, userId);
  await revokeAllSessionsAndTokens(userId, 'User account deleted');

  logAudit({
    user_id: userId,
    org_id: null,
    action: 'user.deleted',
    resource_type: 'user',
    resource_id: userId,
    ip_address: ipAddress,
    request_id: requestId,
    metadata: { reason: input.reason || null, method: 'self_delete' },
  });
}

export async function getUserById(
  targetUserId: string,
  requesterId: string,
  isAdmin: boolean,
): Promise<UserProfile> {
  if (!isAdmin && targetUserId !== requesterId) {
    throw new AuthError(
      'Insufficient permissions',
      AuthErrorCodes.INSUFFICIENT_PERMISSIONS,
      403,
    );
  }
  const user = await repository.findUserById(targetUserId);
  if (!user) {
    throw new AuthError('User not found', AuthErrorCodes.USER_NOT_FOUND, 404);
  }
  return toUserProfile(user);
}

export async function listAllUsers(
  options: ListUsersQueryInput,
  isAdmin: boolean,
): Promise<{ users: UserProfile[]; total: number }> {
  if (!isAdmin) {
    throw new AuthError(
      'Admin access required',
      AuthErrorCodes.INSUFFICIENT_PERMISSIONS,
      403,
    );
  }
  const repoOptions: repository.ListUsersOptions = {
    limit: options.limit,
    offset: options.offset,
  };
  if (options.status !== undefined) repoOptions.status = options.status;
  if (options.search !== undefined) repoOptions.search = options.search;

  const { users, total } = await repository.listUsers(repoOptions);
  return { users: users.map(toUserProfile), total };
}

export async function restoreDeletedUser(
  targetUserId: string,
  adminId: string,
  isAdmin: boolean,
  ipAddress: string,
  requestId: string,
): Promise<UserProfile> {
  if (!isAdmin) {
    throw new AuthError(
      'Admin access required',
      AuthErrorCodes.INSUFFICIENT_PERMISSIONS,
      403,
    );
  }
  const target = await repository.findUserByIdIncludingDeleted(targetUserId);
  if (!target || !target.deleted_at) {
    throw new AuthError(
      'User not found or not deleted',
      AuthErrorCodes.USER_NOT_FOUND,
      404,
    );
  }

  const restored = await repository.restoreUser(targetUserId);
  if (!restored) {
    throw new AuthError(
      'User not found or not deleted',
      AuthErrorCodes.USER_NOT_FOUND,
      404,
    );
  }

  logAudit({
    user_id: adminId,
    org_id: null,
    action: 'user.restored',
    resource_type: 'user',
    resource_id: targetUserId,
    ip_address: ipAddress,
    request_id: requestId,
    metadata: { previous_status: 'deleted' },
  });

  return toUserProfile(restored);
}

export async function suspendUser(
  targetUserId: string,
  reason: string,
  adminId: string,
  isAdmin: boolean,
  ipAddress: string,
  requestId: string,
): Promise<UserProfile> {
  if (!isAdmin) {
    throw new AuthError(
      'Admin access required',
      AuthErrorCodes.INSUFFICIENT_PERMISSIONS,
      403,
    );
  }
  if (!reason || reason.length < 10) {
    throw new AuthError(
      'Suspension reason required (min 10 chars)',
      AuthErrorCodes.VALIDATION_ERROR,
      400,
    );
  }
  if (targetUserId === adminId) {
    throw new AuthError(
      'Admins cannot suspend their own account',
      AuthErrorCodes.INVALID_OPERATION,
      400,
    );
  }

  const suspended = await repository.withTransaction(async (client) => {
    const updated = await repository.suspendUser(
      targetUserId,
      reason,
      adminId,
      client,
    );
    if (!updated) return null;

    await client.query(
      `UPDATE user_sessions
         SET status = 'terminated_by_admin',
             terminated_at = NOW(),
             terminated_by = $2,
             termination_reason = $3
       WHERE user_id = $1 AND status = 'active'`,
      [targetUserId, adminId, `Admin suspension: ${reason}`],
    );
    return updated;
  });

  if (!suspended) {
    throw new AuthError('User not found', AuthErrorCodes.USER_NOT_FOUND, 404);
  }

  markAllUserTokensRevoked(targetUserId);

  logAudit({
    user_id: adminId,
    org_id: null,
    action: 'user.suspended',
    resource_type: 'user',
    resource_id: targetUserId,
    ip_address: ipAddress,
    request_id: requestId,
    metadata: { reason },
  });

  return toUserProfile(suspended);
}

export async function unsuspendUser(
  targetUserId: string,
  adminId: string,
  isAdmin: boolean,
  ipAddress: string,
  requestId: string,
): Promise<UserProfile> {
  if (!isAdmin) {
    throw new AuthError(
      'Admin access required',
      AuthErrorCodes.INSUFFICIENT_PERMISSIONS,
      403,
    );
  }

  const unsuspended = await repository.unsuspendUser(targetUserId);
  if (!unsuspended) {
    throw new AuthError(
      'User not found or not suspended',
      AuthErrorCodes.USER_NOT_FOUND,
      404,
    );
  }

  logAudit({
    user_id: adminId,
    org_id: null,
    action: 'user.unsuspended',
    resource_type: 'user',
    resource_id: targetUserId,
    ip_address: ipAddress,
    request_id: requestId,
  });

  return toUserProfile(unsuspended);
}

export async function adminLockUserAccount(
  targetUserId: string,
  input: AdminLockUserInput,
  adminId: string,
  isAdmin: boolean,
  ipAddress: string,
  requestId: string,
): Promise<UserProfile> {
  if (!isAdmin) {
    throw new AuthError(
      'Admin access required',
      AuthErrorCodes.INSUFFICIENT_PERMISSIONS,
      403,
    );
  }
  if (targetUserId === adminId) {
    throw new AuthError(
      'Admins cannot lock their own account',
      AuthErrorCodes.INVALID_OPERATION,
      400,
    );
  }

  const locked = await repository.withTransaction(async (client) => {
    const updated = await repository.adminLockUser(
      targetUserId,
      input.reason,
      adminId,
      client,
    );
    if (!updated) return null;

    await client.query(
      `UPDATE user_sessions
         SET status = 'terminated_by_admin',
             terminated_at = NOW(),
             terminated_by = $2,
             termination_reason = $3
       WHERE user_id = $1 AND status = 'active'`,
      [targetUserId, adminId, `Admin lock: ${input.reason}`],
    );
    return updated;
  });

  if (!locked) {
    throw new AuthError('User not found', AuthErrorCodes.USER_NOT_FOUND, 404);
  }

  markAllUserTokensRevoked(targetUserId);

  logAudit({
    user_id: adminId,
    org_id: null,
    action: 'user.admin_locked',
    resource_type: 'user',
    resource_id: targetUserId,
    ip_address: ipAddress,
    request_id: requestId,
    metadata: { reason: input.reason },
  });

  return toUserProfile(locked);
}

export async function adminUnlockUserAccount(
  targetUserId: string,
  adminId: string,
  isAdmin: boolean,
  ipAddress: string,
  requestId: string,
): Promise<UserProfile> {
  if (!isAdmin) {
    throw new AuthError(
      'Admin access required',
      AuthErrorCodes.INSUFFICIENT_PERMISSIONS,
      403,
    );
  }

  const unlocked = await repository.adminUnlockUser(targetUserId);
  if (!unlocked) {
    throw new AuthError('User not found', AuthErrorCodes.USER_NOT_FOUND, 404);
  }

  logAudit({
    user_id: adminId,
    org_id: null,
    action: 'user.admin_unlocked',
    resource_type: 'user',
    resource_id: targetUserId,
    ip_address: ipAddress,
    request_id: requestId,
  });

  return toUserProfile(unlocked);
}

/**
 * Revoke every active session for a target user (platform admin support).
 */
export async function adminRevokeAllUserSessions(
  targetUserId: string,
  adminId: string,
  isAdmin: boolean,
  ipAddress: string,
  requestId: string,
): Promise<{ revoked: number }> {
  if (!isAdmin) {
    throw new AuthError(
      'Admin access required',
      AuthErrorCodes.INSUFFICIENT_PERMISSIONS,
      403,
    );
  }

  const user = await repository.findUserById(targetUserId);
  if (!user || user.deleted_at) {
    throw new AuthError('User not found', AuthErrorCodes.USER_NOT_FOUND, 404);
  }

  const revoked = await revokeAllSessionsAndTokens(
    targetUserId,
    'Admin revoked all sessions',
  );

  logAudit({
    user_id: adminId,
    org_id: null,
    action: 'user.sessions_revoked_by_admin',
    resource_type: 'user',
    resource_id: targetUserId,
    ip_address: ipAddress,
    request_id: requestId,
    metadata: { revoked },
  });

  return { revoked };
}

export async function getUserSecuritySummary(
  userId: string,
): Promise<UserSecuritySummary> {
  const user = await repository.findUserById(userId);
  if (!user) {
    throw new AuthError('User not found', AuthErrorCodes.USER_NOT_FOUND, 404);
  }

  const [sessions, devices] = await Promise.all([
    repository.listActiveSessionsByUser(userId),
    repository.findMFADevicesByUserId(userId, true),
  ]);

  const verifiedDevices = devices.filter((d) => d.verified && d.is_active);
  const locked =
    Boolean(user.locked_until) && user.locked_until! > new Date();

  return {
    email_verified: user.email_verified,
    mfa_enabled: user.mfa_enabled,
    active_session_count: sessions.length,
    verified_mfa_device_count: verifiedDevices.length,
    last_login_at: user.last_login_at,
    last_password_change: user.last_password_change,
    account_locked: locked,
    locked_until: user.locked_until,
    status: user.status,
  };
}

// ============================================================================
// LOGIN
// ============================================================================

export async function loginWithEmailPassword(
  input: LoginInput,
  ipAddress: string,
  userAgent: string,
  clientDeviceType: string,
  requestId: string,
): Promise<
  | {
      mfa_required: true;
      challenge_id: string;
      expires_at: Date;
      device_type: string;
    }
  | {
      mfa_required: false;
      access_token: string;
      refresh_token: string;
      expires_at: Date;
      token_type: 'Bearer';
      session_id: string;
      user_id: string;
    }
> {
  const normalizedEmail = normalizeEmail(input.email);
  const emailHash = emailToHash(normalizedEmail);

  const user = await repository.findUserByEmailHash(emailHash);

  // Defeat enumeration: equalize timing for missing user / no password / deleted.
  if (!user) {
    await timingSafeFakePasswordCompare(input.password);
    throw new AuthError(
      'Invalid email or password',
      AuthErrorCodes.INVALID_CREDENTIALS,
      401,
    );
  }

  if (user.deleted_at || user.status === 'deleted' || !user.password_hash) {
    await timingSafeFakePasswordCompare(input.password);
    throw new AuthError(
      'Invalid email or password',
      AuthErrorCodes.INVALID_CREDENTIALS,
      401,
    );
  }

  if (user.status === 'suspended') {
    throw new AuthError(
      'Account suspended. Contact support.',
      AuthErrorCodes.USER_SUSPENDED,
      403,
    );
  }

  if (user.locked_until && user.locked_until > new Date()) {
    throw new AuthError(
      `Account temporarily locked. Try again after ${user.locked_until.toISOString()}`,
      AuthErrorCodes.ACCOUNT_LOCKED,
      423,
      { lockedUntil: user.locked_until },
    );
  }

  const passwordValid = await verifyPassword(input.password, user.password_hash);
  if (!passwordValid) {
    const result = await repository.recordFailedLogin(user.id, ipAddress);

    if (result.locked_until) {
      // Atomic transition into a locked state. Record a security event so
      // SOC/IR can correlate.
      await repository
        .recordSecurityEvent({
          event_type: 'brute_force_attempt',
          severity: 7,
          user_id: user.id,
          ip_address: ipAddress,
          user_agent: userAgent,
          description: 'Account locked after consecutive failed login attempts',
          evidence: {
            failed_attempts: result.login_attempts,
            locked_until: result.locked_until.toISOString(),
          },
          action_taken: 'blocked',
          blocked_until: result.locked_until,
        })
        .catch((err) => {
          logger.warn({ err, userId: user.id }, 'recordSecurityEvent failed');
        });

      logAudit({
        user_id: user.id,
        org_id: null,
        action: 'user.login_locked',
        resource_type: 'user',
        resource_id: user.id,
        ip_address: ipAddress,
        request_id: requestId,
        metadata: {
          failed_attempts: result.login_attempts,
          locked_until: result.locked_until.toISOString(),
        },
      });
    }

    throw new AuthError(
      'Invalid email or password',
      AuthErrorCodes.INVALID_CREDENTIALS,
      401,
    );
  }

  // Password is correct. To avoid post-password enumeration of verification
  // state, we do NOT distinguish unverified accounts here. Instead we
  // silently re-issue a verification email and respond with the same
  // INVALID_CREDENTIALS code as a wrong password. The frontend can guide
  // the user via /auth/resend-verification (which is also enumeration-safe).
  if (!user.email_verified) {
    const verificationToken = generateSecureToken();
    await repository.createEmailVerification({
      user_id: user.id,
      email: normalizedEmail,
      token_hash: hashEmailFlowToken('email_verification', verificationToken),
      purpose: 'email_verification',
      expires_at: new Date(Date.now() + EMAIL_VERIFICATION_TTL_SECONDS * 1000),
    });
    try {
      await sendVerificationEmail(user, verificationToken);
    } catch (err) {
      logger.warn(
        { err, userId: user.id },
        'Auto-resend verification email failed during login',
      );
    }

    logAudit({
      user_id: user.id,
      org_id: null,
      action: 'user.login_unverified',
      resource_type: 'user',
      resource_id: user.id,
      ip_address: ipAddress,
      request_id: requestId,
    });

    throw new AuthError(
      'Invalid email or password',
      AuthErrorCodes.INVALID_CREDENTIALS,
      401,
    );
  }

  await assertLoginAllowedByOrgPolicy(user);

  // Trusted device: skip MFA when fingerprint is registered and valid.
  if (user.mfa_enabled) {
    const trusted = await isLoginTrustedDevice(user.id, ipAddress, userAgent);
    if (trusted) {
      const session = await issueSessionForUser({
        user,
        ipAddress,
        userAgent,
        deviceName: input.device_name,
        deviceType: clientDeviceType,
        mfaVerified: true,
        rememberMe: input.remember_me === true,
      });
      await repository.recordLogin(user.id, ipAddress, userAgent);
      if (input.trust_device) {
        await trustCurrentDevice(
          user.id,
          ipAddress,
          userAgent,
          input.device_name,
          requestId,
        ).catch(() => undefined);
      }
      logAudit({
        user_id: user.id,
        org_id: null,
        action: 'user.login',
        resource_type: 'user',
        resource_id: user.id,
        ip_address: ipAddress,
        user_agent: userAgent,
        request_id: requestId,
        metadata: {
          session_id: session.sessionId,
          mfa_required: false,
          trusted_device: true,
        },
      });
      return {
        mfa_required: false,
        access_token: session.accessToken,
        refresh_token: session.refreshToken,
        expires_at: session.expiresAt,
        token_type: 'Bearer',
        session_id: session.sessionId,
        user_id: user.id,
      };
    }
  }

  // MFA branch: issue a challenge but do NOT issue tokens.
  if (user.mfa_enabled) {
    const devices = await repository.findMFADevicesByUserId(user.id);
    const verifiedDevices = devices.filter((d) => d.verified && d.is_active);
    if (verifiedDevices.length === 0) {
      // mfa_enabled but no usable devices -> data inconsistency. Fail closed.
      logger.error(
        { userId: user.id },
        'mfa_enabled=true but no verified active devices',
      );
      throw new AuthError(
        'MFA setup is incomplete for this account',
        AuthErrorCodes.MFA_NOT_ENABLED,
        400,
      );
    }
    const primary =
      verifiedDevices.find((d) => d.is_primary) || verifiedDevices[0]!;

    // For email MFA, generate and send an OTP before issuing the challenge.
    // hardware_key uses POST /auth/login/mfa/webauthn/* — no OTP email.
    if (primary.device_type === 'email') {
      const otp = await generateEmailMfaOtp();
      const otpHash = hashEmailMfaOtp(otp);
      await createEmailMfaOtp(user.id, primary.id, otpHash);
      await sendEmailMfaOtpEmail(user, otp, primary.device_name, 'login');
    }

    const challenge = createLoginMFAChallenge({
      userId: user.id,
      device: primary,
      ipAddress,
      userAgent,
      deviceName: input.device_name,
      clientDeviceType,
      rememberMe: input.remember_me === true,
    });

    return {
      mfa_required: true,
      challenge_id: challenge.challengeId,
      expires_at: challenge.expiresAt,
      device_type: challenge.deviceType,
    };
  }

  // No MFA: issue a fresh session.
  const session = await issueSessionForUser({
    user,
    ipAddress,
    userAgent,
    deviceName: input.device_name,
    deviceType: clientDeviceType,
    mfaVerified: true, // No MFA configured -> requirement satisfied.
    rememberMe: input.remember_me === true,
  });

  await repository.recordLogin(user.id, ipAddress, userAgent);

  logAudit({
    user_id: user.id,
    org_id: null,
    action: 'user.login',
    resource_type: 'user',
    resource_id: user.id,
    ip_address: ipAddress,
    user_agent: userAgent,
    request_id: requestId,
    metadata: { session_id: session.sessionId, mfa_required: false },
  });

  return {
    mfa_required: false,
    access_token: session.accessToken,
    refresh_token: session.refreshToken,
    expires_at: session.expiresAt,
    token_type: 'Bearer',
    session_id: session.sessionId,
    user_id: user.id,
  };
}

export async function verifyLoginMFAChallenge(
  input: LoginMFAVerifyInput,
  ipAddress: string,
  userAgent: string,
  clientDeviceType: string,
  requestId: string,
): Promise<{
  access_token: string;
  refresh_token: string;
  expires_at: Date;
  token_type: 'Bearer';
  session_id: string;
  user_id: string;
}> {
  const challenge = loginMfaChallengeCache.get(input.challenge_id);
  if (!challenge) {
    throw new AuthError(
      'Challenge expired or invalid',
      AuthErrorCodes.MFA_CHALLENGE_EXPIRED,
      400,
    );
  }

  if (challenge.attempts >= 3) {
    loginMfaChallengeCache.delete(input.challenge_id);
    throw new AuthError(
      'Too many failed attempts',
      AuthErrorCodes.MFA_INVALID,
      400,
    );
  }

  const user = await repository.findUserById(challenge.userId);
  if (!user) {
    loginMfaChallengeCache.delete(input.challenge_id);
    throw new AuthError('User not found', AuthErrorCodes.USER_NOT_FOUND, 404);
  }

  const device = await repository.findMFADeviceById(challenge.deviceId, user.id);
  if (!device || !device.verified || !device.is_active) {
    loginMfaChallengeCache.delete(input.challenge_id);
    throw new AuthError('MFA device invalid', AuthErrorCodes.MFA_INVALID, 400);
  }

  // Verify the code based on device type.
  let verified = false;
  if (device.device_type === 'hardware_key') {
    throw new AuthError(
      'Use POST /auth/login/mfa/webauthn/options and /verify for passkey MFA',
      AuthErrorCodes.MFA_INVALID,
      400,
      { device_type: 'hardware_key' },
    );
  }
  if (device.device_type === 'email') {
    // Email MFA: check the OTP stored in email_mfa_otps.
    const codeHash = hashEmailMfaOtp(input.code);
    verified = await consumeEmailMfaOtp(device.id, codeHash);
  } else {
    // TOTP: validate against the encrypted secret.
    verified = verifyTotpDeviceCode(device, input.code);
  }

  if (!verified) {
    challenge.attempts += 1;
    loginMfaChallengeCache.set(input.challenge_id, challenge);
    throw new AuthError('Invalid MFA code', AuthErrorCodes.MFA_INVALID, 400);
  }

  loginMfaChallengeCache.delete(input.challenge_id);
  await repository.updateMFADeviceLastUsed(device.id, ipAddress);

  await assertLoginAllowedByOrgPolicy(user);

  const session = await issueSessionForUser({
    user,
    ipAddress,
    userAgent,
    deviceName: challenge.deviceName,
    deviceType: challenge.clientDeviceType || clientDeviceType,
    mfaVerified: true,
    rememberMe: challenge.rememberMe,
  });

  await repository.recordLogin(user.id, ipAddress, userAgent);

  logAudit({
    user_id: user.id,
    org_id: null,
    action: 'user.login',
    resource_type: 'user',
    resource_id: user.id,
    ip_address: ipAddress,
    user_agent: userAgent,
    request_id: requestId,
    metadata: { session_id: session.sessionId, mfa_required: true },
  });

  return {
    access_token: session.accessToken,
    refresh_token: session.refreshToken,
    expires_at: session.expiresAt,
    token_type: 'Bearer',
    session_id: session.sessionId,
    user_id: user.id,
  };
}

export async function verifyLoginBackupCode(
  input: BackupCodeLoginInput,
  ipAddress: string,
  userAgent: string,
  clientDeviceType: string,
  requestId: string,
): Promise<{
  access_token: string;
  refresh_token: string;
  expires_at: Date;
  token_type: 'Bearer';
  session_id: string;
  user_id: string;
}> {
  const challenge = loginMfaChallengeCache.get(input.challenge_id);
  if (!challenge) {
    throw new AuthError(
      'Challenge expired or invalid',
      AuthErrorCodes.MFA_CHALLENGE_EXPIRED,
      400,
    );
  }
  if (challenge.attempts >= 3) {
    loginMfaChallengeCache.delete(input.challenge_id);
    throw new AuthError(
      'Too many failed attempts',
      AuthErrorCodes.MFA_INVALID,
      400,
    );
  }

  const user = await repository.findUserById(challenge.userId);
  if (!user) {
    loginMfaChallengeCache.delete(input.challenge_id);
    throw new AuthError('User not found', AuthErrorCodes.USER_NOT_FOUND, 404);
  }

  const ok = await consumeBackupCode(user.id, input.code);
  if (!ok) {
    challenge.attempts += 1;
    loginMfaChallengeCache.set(input.challenge_id, challenge);
    throw new AuthError(
      'Invalid backup code',
      AuthErrorCodes.MFA_INVALID,
      400,
    );
  }

  loginMfaChallengeCache.delete(input.challenge_id);

  await assertLoginAllowedByOrgPolicy(user);

  const session = await issueSessionForUser({
    user,
    ipAddress,
    userAgent,
    deviceName: challenge.deviceName,
    deviceType: challenge.clientDeviceType || clientDeviceType,
    mfaVerified: true,
    rememberMe: challenge.rememberMe,
  });

  await repository.recordLogin(user.id, ipAddress, userAgent);

  logAudit({
    user_id: user.id,
    org_id: null,
    action: 'user.login_backup_code',
    resource_type: 'user',
    resource_id: user.id,
    ip_address: ipAddress,
    user_agent: userAgent,
    request_id: requestId,
    metadata: { session_id: session.sessionId },
  });

  return {
    access_token: session.accessToken,
    refresh_token: session.refreshToken,
    expires_at: session.expiresAt,
    token_type: 'Bearer',
    session_id: session.sessionId,
    user_id: user.id,
  };
}

// ============================================================================
// EMAIL VERIFICATION & PASSWORD RESET
// ============================================================================

export async function resendVerification(
  input: ResendVerificationInput,
  ipAddress: string,
  requestId: string,
): Promise<{ message: string }> {
  const normalizedEmail = normalizeEmail(input.email);
  const emailHash = emailToHash(normalizedEmail);

  const user = await repository.findUserByEmailHash(emailHash);

  if (
    user &&
    !user.deleted_at &&
    user.status === 'active' &&
    !user.email_verified
  ) {
    const verificationToken = generateSecureToken();
    await repository.createEmailVerification({
      user_id: user.id,
      email: normalizedEmail,
      token_hash: hashEmailFlowToken('email_verification', verificationToken),
      purpose: 'email_verification',
      expires_at: new Date(Date.now() + EMAIL_VERIFICATION_TTL_SECONDS * 1000),
    });
    try {
      await sendVerificationEmail(user, verificationToken);
    } catch (err) {
      logger.error({ err, userId: user.id }, 'Resend verification email failed');
    }

    logAudit({
      user_id: user.id,
      org_id: null,
      action: 'user.verification_resent',
      resource_type: 'user',
      resource_id: user.id,
      ip_address: ipAddress,
      request_id: requestId,
    });
  }

  return { message: GENERIC_VERIFICATION_MESSAGE };
}

export async function verifyEmail(
  input: VerifyEmailQueryInput,
  ipAddress: string,
  requestId: string,
): Promise<{ message: string }> {
  const tokenHash = hashEmailFlowToken('email_verification', input.token);
  let verifiedUserId: string | null = null;
  let alreadyVerified = false;

  await repository.withTransaction(async (client) => {
    const consumed = await repository.consumeEmailVerificationToken(
      tokenHash,
      'email_verification',
      client,
    );

    if (!consumed) {
      // Idempotency: a previously-consumed token for an already-verified
      // user returns success rather than confusing the caller.
      const existing = await repository.findEmailVerificationByTokenHash(
        tokenHash,
        'email_verification',
        client,
      );
      if (existing?.verified_at) {
        const user = await repository.findUserById(existing.user_id, client);
        if (user?.email_verified) {
          verifiedUserId = user.id;
          alreadyVerified = true;
          return;
        }
      }
      throw new AuthError(
        'Invalid or expired verification token',
        AuthErrorCodes.EMAIL_VERIFICATION_INVALID,
        400,
      );
    }

    const user = await repository.findUserById(consumed.user_id, client);
    if (
      !user ||
      user.deleted_at ||
      normalizeEmail(user.email) !== normalizeEmail(consumed.email)
    ) {
      throw new AuthError(
        'Invalid or expired verification token',
        AuthErrorCodes.EMAIL_VERIFICATION_INVALID,
        400,
      );
    }
    if (!user.email_verified) {
      await repository.markEmailAsVerified(user.id, client);
    }
    verifiedUserId = user.id;
  });

  if (verifiedUserId && !alreadyVerified) {
    logAudit({
      user_id: verifiedUserId,
      org_id: null,
      action: 'user.email_verified',
      resource_type: 'user',
      resource_id: verifiedUserId,
      ip_address: ipAddress,
      request_id: requestId,
    });
  }

  return { message: 'Email verified successfully' };
}

export async function requestPasswordReset(
  input: ForgotPasswordInput,
  ipAddress: string,
  requestId: string,
): Promise<{ message: string }> {
  const normalizedEmail = normalizeEmail(input.email);
  const emailHash = emailToHash(normalizedEmail);

  const user = await repository.findUserByEmailHash(emailHash);

  if (user && !user.deleted_at && user.status === 'active') {
    const resetToken = generateSecureToken();
    const resetTokenHash = hashEmailFlowToken('password_reset', resetToken);
    await repository.createEmailVerification({
      user_id: user.id,
      email: normalizedEmail,
      token_hash: resetTokenHash,
      purpose: 'password_reset',
      expires_at: new Date(Date.now() + PASSWORD_RESET_TTL_SECONDS * 1000),
    });

    await sendPasswordResetEmail(user, resetToken);

    logAudit({
      user_id: user.id,
      org_id: null,
      action: 'user.password_reset_requested',
      resource_type: 'user',
      resource_id: user.id,
      ip_address: ipAddress,
      request_id: requestId,
    });
  }

  return { message: GENERIC_PASSWORD_RESET_MESSAGE };
}

export async function resetPasswordWithToken(
  input: ResetPasswordInput,
  ipAddress: string,
  requestId: string,
): Promise<void> {
  const tokenHash = hashEmailFlowToken('password_reset', input.token);
  let resetUserId: string | null = null;

  await repository.withTransaction(async (client) => {
    const consumed = await repository.consumeEmailVerificationToken(
      tokenHash,
      'password_reset',
      client,
    );
    if (!consumed) {
      throw new AuthError(
        'Invalid or expired reset token',
        AuthErrorCodes.PASSWORD_RESET_INVALID,
        400,
      );
    }

    const userRes = await client.query<User>(
      `SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
      [consumed.user_id],
    );
    const user = userRes.rows[0];
    if (
      !user ||
      user.status !== 'active' ||
      normalizeEmail(user.email) !== normalizeEmail(consumed.email)
    ) {
      throw new AuthError(
        'Invalid or expired reset token',
        AuthErrorCodes.PASSWORD_RESET_INVALID,
        400,
      );
    }

    await ensurePasswordNotReused(user, input.new_password);

    const passwordHash = await hashPassword(input.new_password);
    const passwordHistory = buildPasswordHistory(
      user.password_history,
      user.password_hash,
    );

    const updated = await repository.updateUserPassword(
      user.id,
      passwordHash,
      passwordHistory,
      client,
    );
    if (!updated) {
      throw new AuthError(
        'Password reset failed',
        AuthErrorCodes.USER_NOT_FOUND,
        500,
      );
    }

    // Burn every other outstanding email-flow token for this user.
    await repository.invalidateAllUserTokens(user.id, client);
    resetUserId = user.id;
  });

  if (!resetUserId) {
    throw new AuthError(
      'Password reset failed',
      AuthErrorCodes.PASSWORD_RESET_INVALID,
      400,
    );
  }

  await revokeAllSessionsAndTokens(resetUserId, 'Password reset');

  logAudit({
    user_id: resetUserId,
    org_id: null,
    action: 'user.password_changed',
    resource_type: 'user',
    resource_id: resetUserId,
    ip_address: ipAddress,
    request_id: requestId,
    metadata: { method: 'password_reset' },
  });
}

/**
 * Change password from inside an authenticated session.
 *
 * Requirements:
 *   - Caller must currently have a fresh step-up MFA challenge if MFA is on
 *     (enforced at the route level via `requireStepUp`). This function still
 *     defends the requirement by checking `mfaVerified` for users who have
 *     mfa_enabled.
 *   - Caller must supply the current password.
 *   - New password must not match any of the last 5 hashes.
 *
 * Side effects:
 *   - Every OTHER session is revoked.
 *   - All access tokens for OTHER sessions are blacklisted.
 *   - The caller's current session is revoked and replaced with a fresh one
 *     so they remain signed in on the device they just verified themselves on.
 */
export async function changePassword(
  userId: string,
  currentSessionId: string,
  input: ChangePasswordInput,
  mfaVerified: boolean,
  ipAddress: string,
  userAgent: string,
  requestId: string,
): Promise<{
  access_token: string;
  refresh_token: string;
  expires_at: Date;
  token_type: 'Bearer';
  session_id: string;
}> {
  const user = await repository.findUserById(userId);
  if (!user) {
    throw new AuthError('User not found', AuthErrorCodes.USER_NOT_FOUND, 404);
  }
  assertUserUsable(user);

  if (user.mfa_enabled && !mfaVerified) {
    throw new AuthError(
      'MFA verification required',
      AuthErrorCodes.MFA_REQUIRED,
      403,
    );
  }
  if (!user.password_hash) {
    throw new AuthError(
      'Password change is not available for this account',
      AuthErrorCodes.PASSWORD_REQUIRED,
      400,
    );
  }

  const currentValid = await verifyPassword(
    input.current_password,
    user.password_hash,
  );
  if (!currentValid) {
    throw new AuthError(
      'Current password is incorrect',
      AuthErrorCodes.PASSWORD_INCORRECT,
      401,
    );
  }

  await ensurePasswordNotReused(user, input.new_password);

  const passwordHash = await hashPassword(input.new_password);
  const passwordHistory = buildPasswordHistory(
    user.password_history,
    user.password_hash,
  );
  const updated = await repository.updateUserPassword(
    user.id,
    passwordHash,
    passwordHistory,
  );
  if (!updated) {
    throw new AuthError(
      'Password update failed',
      AuthErrorCodes.USER_NOT_FOUND,
      500,
    );
  }

  await repository.revokeAllOtherSessions(
    userId,
    currentSessionId,
    'Password changed',
  );
  await blacklistOtherUserSessionTokens(userId, currentSessionId);
  blacklistAccessToken(currentSessionId);
  await repository.revokeSession(currentSessionId, 'Password changed');

  const session = await issueSessionForUser({
    user: updated,
    ipAddress,
    userAgent,
    deviceName: undefined,
    deviceType: undefined,
    mfaVerified: true,
  });

  logAudit({
    user_id: userId,
    org_id: null,
    action: 'user.password_changed',
    resource_type: 'user',
    resource_id: userId,
    ip_address: ipAddress,
    request_id: requestId,
    metadata: { method: 'change_password' },
  });

  return {
    access_token: session.accessToken,
    refresh_token: session.refreshToken,
    expires_at: session.expiresAt,
    token_type: 'Bearer',
    session_id: session.sessionId,
  };
}

// ============================================================================
// MFA — SETUP, VERIFY, MANAGE
// ============================================================================

export async function setupMFA(
  userId: string,
  input: MFASetupInput,
  ipAddress: string,
): Promise<(TOTPSetup | EmailMFASetup) & { device_id: string; device_type: string }> {
  const user = await repository.findUserById(userId);
  if (!user) {
    throw new AuthError('User not found', AuthErrorCodes.USER_NOT_FOUND, 404);
  }
  assertUserUsable(user);

  // ── Email MFA setup ──────────────────────────────────────────────────────
  if (input.type === 'email') {
    const existing = await repository.findAnyMFADeviceByType(userId, 'email');
    if (existing && existing.is_active && existing.verified) {
      throw new AuthError(
        'Email MFA is already configured. Disable it first if you want to re-enroll.',
        AuthErrorCodes.MFA_ALREADY_ENABLED,
        409,
      );
    }

    // A new device becomes primary only when the user has no other device
    // currently flagged primary+active. This mirrors the DB partial unique
    // index `one_primary_mfa (is_primary AND is_active)` exactly, so the
    // INSERT/UPDATE can never violate it. Re-enrolling a device that was
    // itself the primary keeps it primary.
    const allDevices = await repository.findMFADevicesByUserId(userId);
    const hasOtherPrimary = allDevices.some(
      (d) => d.is_primary && d.is_active && d.id !== existing?.id,
    );
    const isPrimary = existing?.is_primary === true || !hasOtherPrimary;

    let device: MFADevice;
    if (existing) {
      const reset = await repository.resetMFADeviceForReSetup(existing.id, {
        device_name: input.device_name,
        secret_encrypted: null, // email MFA has no stored secret
        is_primary: isPrimary,
        device_metadata: {
          setup_ip: ipAddress,
          re_enrolled_at: new Date().toISOString(),
        },
      });
      if (!reset) {
        throw new AuthError(
          'Failed to reset MFA device',
          AuthErrorCodes.MFA_DEVICE_NOT_FOUND,
          500,
        );
      }
      device = reset;
    } else {
      device = await repository.createMFADevice({
        user_id: userId,
        device_type: 'email',
        device_name: input.device_name,
        secret_encrypted: null,
        is_primary: isPrimary,
        device_metadata: { setup_ip: ipAddress },
      });
    }

    // Generate and send a setup OTP to confirm the user controls this email.
    const otp = await generateEmailMfaOtp();
    const otpHash = hashEmailMfaOtp(otp);
    await createEmailMfaOtp(userId, device.id, otpHash);
    await sendEmailMfaOtpEmail(user, otp, input.device_name, 'setup');

    const { plain: backupCodes, hashed } = await generateBackupCodes();
    mfaBackupTempCache.set(device.id, hashed);

    return {
      device_id: device.id,
      device_type: 'email',
      backupCodes,
    };
  }

  // ── TOTP setup ───────────────────────────────────────────────────────────
  // Look at any existing TOTP device so we can reactivate it.
  const existing = await repository.findAnyMFADeviceByType(userId, 'totp');
  if (existing && existing.is_active && existing.verified) {
    throw new AuthError(
      'TOTP MFA is already configured. Disable it first if you want to re-enroll.',
      AuthErrorCodes.MFA_ALREADY_ENABLED,
      409,
    );
  }

  const secret = new OTPAuth.Secret({ size: 32 });
  const totp = buildTotp(secret.base32, user.email);
  const secretEncrypted = encrypt(secret.base32, config.ENCRYPTION_KEY);
  // A new device becomes primary only when the user has no other verified
  // active device. Re-enrolling a device that was already primary keeps it
  // primary. Adding TOTP alongside an existing primary must not demote it.
  const allTotpDevices = await repository.findMFADevicesByUserId(userId);
  const hasOtherPrimaryTotp = allTotpDevices.some(
    (d) => d.is_primary && d.is_active && d.id !== existing?.id,
  );
  const isPrimary = existing?.is_primary === true || !hasOtherPrimaryTotp;

  let device: MFADevice;
  if (existing) {
    const reset = await repository.resetMFADeviceForReSetup(existing.id, {
      device_name: input.device_name,
      secret_encrypted: secretEncrypted,
      is_primary: isPrimary,
      device_metadata: {
        setup_ip: ipAddress,
        re_enrolled_at: new Date().toISOString(),
      },
    });
    if (!reset) {
      throw new AuthError(
        'Failed to reset MFA device',
        AuthErrorCodes.MFA_DEVICE_NOT_FOUND,
        500,
      );
    }
    device = reset;
  } else {
    device = await repository.createMFADevice({
      user_id: userId,
      device_type: 'totp',
      device_name: input.device_name,
      secret_encrypted: secretEncrypted,
      is_primary: isPrimary,
      device_metadata: { setup_ip: ipAddress },
    });
  }

  const { plain: backupCodes, hashed } = await generateBackupCodes();

  // Hold backup-code hashes in process until verify-setup commits them. The
  // LRU TTL (24h) is generous enough that "I'll set this up later today" is
  // safe; abandoned setups expire on their own.
  mfaBackupTempCache.set(device.id, hashed);

  const qrCodeUrl = await QRCode.toDataURL(totp.toString());
  return {
    device_id: device.id,
    device_type: 'totp',
    secret: secret.base32,
    qrCodeUrl,
    backupCodes,
  };
}

export async function verifyMFASetup(
  userId: string,
  input: MFAVerifySetupInput,
  ipAddress: string,
  requestId: string,
): Promise<void> {
  const device = await repository.findMFADeviceById(input.device_id, userId);
  if (!device) {
    throw new AuthError(
      'MFA device not found',
      AuthErrorCodes.MFA_DEVICE_NOT_FOUND,
      404,
    );
  }
  if (device.verified && device.is_active) {
    throw new AuthError(
      'Device already verified',
      AuthErrorCodes.MFA_ALREADY_ENABLED,
      409,
    );
  }

  // Verify the code based on device type.
  if (device.device_type === 'email') {
    const codeHash = hashEmailMfaOtp(input.code);
    const ok = await consumeEmailMfaOtp(device.id, codeHash);
    if (!ok) {
      throw new AuthError(
        'Invalid or expired verification code',
        AuthErrorCodes.MFA_INVALID,
        400,
      );
    }
  } else {
    // TOTP
    if (!device.secret_encrypted) {
      throw new AuthError(
        'Device has no secret to verify',
        AuthErrorCodes.MFA_INVALID,
        400,
      );
    }
    if (!verifyTotpDeviceCode(device, input.code)) {
      throw new AuthError(
        'Invalid verification code',
        AuthErrorCodes.MFA_INVALID,
        400,
      );
    }
  }

  const backupCodesHash = mfaBackupTempCache.get(device.id) ?? [];

  await repository.withTransaction(async (client) => {
    await repository.verifyMFADevice(device.id, backupCodesHash, client);
    if (device.is_primary) {
      await repository.updateMFADevicePrimary(userId, device.id, client);
    }
    await repository.updateUserMFAEnabled(userId, true, client);
    await repository.updateBackupCodesGenerated(userId, client);
  });

  mfaBackupTempCache.delete(device.id);

  const user = await repository.findUserById(userId);
  if (user) await sendMFAStatusEmail(user, true);

  logAudit({
    user_id: userId,
    org_id: null,
    action: 'user.mfa_enabled',
    resource_type: 'user',
    resource_id: userId,
    ip_address: ipAddress,
    request_id: requestId,
    metadata: { device_id: device.id, device_type: device.device_type },
  });
}

export async function createMFAChallenge(userId: string): Promise<MFAChallenge> {
  const devices = await repository.findMFADevicesByUserId(userId);
  const verified = devices.filter((d) => d.verified && d.is_active);
  if (verified.length === 0) {
    throw new AuthError(
      'No verified MFA devices',
      AuthErrorCodes.MFA_NOT_ENABLED,
      400,
    );
  }
  const primary = verified.find((d) => d.is_primary) || verified[0]!;

  // For email MFA, generate and send an OTP before issuing the challenge.
  if (primary.device_type === 'email') {
    const user = await repository.findUserById(userId);
    if (user) {
      const otp = await generateEmailMfaOtp();
      const otpHash = hashEmailMfaOtp(otp);
      await createEmailMfaOtp(userId, primary.id, otpHash);
      await sendEmailMfaOtpEmail(user, otp, primary.device_name, 'challenge');
    }
  }

  const challengeId = generateId();
  const challenge: StepUpChallenge = {
    userId,
    deviceId: primary.id,
    attempts: 0,
  };
  stepUpChallengeCache.set(challengeId, challenge);

  return {
    challengeId,
    deviceId: primary.id,
    deviceType: primary.device_type,
    expiresAt: new Date(Date.now() + STEP_UP_CHALLENGE_TTL_SECONDS * 1000),
  };
}

/**
 * Verify a step-up MFA challenge. On success, stamp step-up freshness on the
 * caller's session in the LRU. Sensitive routes (`requireStepUp`) check that
 * stamp.
 */
export async function verifyMFAChallenge(
  challengeId: string,
  input: MFAVerifyInput,
  sessionId: string,
  ipAddress: string,
): Promise<{ userId: string; deviceId: string }> {
  const challenge = stepUpChallengeCache.get(challengeId);
  if (!challenge) {
    throw new AuthError(
      'Challenge expired or invalid',
      AuthErrorCodes.MFA_CHALLENGE_EXPIRED,
      400,
    );
  }
  if (challenge.attempts >= 3) {
    stepUpChallengeCache.delete(challengeId);
    throw new AuthError(
      'Too many failed attempts',
      AuthErrorCodes.MFA_INVALID,
      400,
    );
  }

  const device = await repository.findMFADeviceById(
    challenge.deviceId,
    challenge.userId,
  );
  if (!device || !device.verified || !device.is_active) {
    stepUpChallengeCache.delete(challengeId);
    throw new AuthError('MFA device invalid', AuthErrorCodes.MFA_INVALID, 400);
  }

  // Verify the code based on device type.
  let stepUpVerified = false;
  if (device.device_type === 'hardware_key') {
    throw new AuthError(
      'Use POST /auth/mfa/step-up/webauthn/options and /verify for passkey step-up',
      AuthErrorCodes.MFA_INVALID,
      400,
      { device_type: 'hardware_key' },
    );
  }
  if (device.device_type === 'email') {
    const codeHash = hashEmailMfaOtp(input.code);
    stepUpVerified = await consumeEmailMfaOtp(device.id, codeHash);
  } else {
    stepUpVerified = verifyTotpDeviceCode(device, input.code);
  }

  if (!stepUpVerified) {
    challenge.attempts += 1;
    stepUpChallengeCache.set(challengeId, challenge);
    throw new AuthError('Invalid code', AuthErrorCodes.MFA_INVALID, 400);
  }

  stepUpChallengeCache.delete(challengeId);
  await repository.updateMFADeviceLastUsed(device.id, ipAddress);

  // Stamp step-up freshness on this session so subsequent sensitive
  // endpoints (`requireStepUp`) accept the call.
  recordStepUpFreshness(sessionId);

  return { userId: challenge.userId, deviceId: device.id };
}

export async function listMFADevices(userId: string): Promise<MFADevice[]> {
  return repository.findMFADevicesByUserId(userId, true);
}

export async function renameMFADevice(
  userId: string,
  deviceId: string,
  input: { device_name: string },
): Promise<void> {
  const updated = await repository.updateMFADeviceName(
    deviceId,
    userId,
    input.device_name,
  );
  if (!updated) {
    throw new AuthError(
      'MFA device not found',
      AuthErrorCodes.MFA_DEVICE_NOT_FOUND,
      404,
    );
  }
}

/**
 * Admin-initiated password reset email. Revokes all active sessions first.
 */
export async function adminForcePasswordReset(
  targetUserId: string,
  adminId: string,
  isAdmin: boolean,
  input: { reason?: string },
  ipAddress: string,
  requestId: string,
): Promise<{ message: string }> {
  if (!isAdmin) {
    throw new AuthError(
      'Admin access required',
      AuthErrorCodes.INSUFFICIENT_PERMISSIONS,
      403,
    );
  }
  if (targetUserId === adminId) {
    throw new AuthError(
      'Use change-password for your own account',
      AuthErrorCodes.INVALID_OPERATION,
      400,
    );
  }

  const user = await repository.findUserById(targetUserId);
  if (!user || user.deleted_at) {
    throw new AuthError('User not found', AuthErrorCodes.USER_NOT_FOUND, 404);
  }

  await repository.withTransaction(async (client) => {
    await client.query(
      `UPDATE user_sessions
         SET status = 'terminated_by_admin',
             terminated_at = NOW(),
             terminated_by = $2,
             termination_reason = $3
       WHERE user_id = $1 AND status = 'active'`,
      [
        targetUserId,
        adminId,
        input.reason
          ? `Admin password reset: ${input.reason}`
          : 'Admin password reset',
      ],
    );
  });

  markAllUserTokensRevoked(targetUserId);

  const resetToken = generateSecureToken();
  const resetTokenHash = hashEmailFlowToken('password_reset', resetToken);
  await repository.createEmailVerification({
    user_id: user.id,
    email: normalizeEmail(user.email),
    token_hash: resetTokenHash,
    purpose: 'password_reset',
    expires_at: new Date(Date.now() + PASSWORD_RESET_TTL_SECONDS * 1000),
  });
  await sendPasswordResetEmail(user, resetToken);

  logAudit({
    user_id: adminId,
    org_id: null,
    action: 'user.admin_password_reset',
    resource_type: 'user',
    resource_id: targetUserId,
    ip_address: ipAddress,
    request_id: requestId,
    metadata: { reason: input.reason ?? null },
  });

  return {
    message:
      'Password reset email sent and all sessions revoked for this user.',
  };
}

/**
 * Resend an email MFA OTP for a given device. Used during setup (to resend
 * the setup confirmation code) and during step-up challenges.
 */
export async function resendEmailMfaOtp(
  userId: string,
  deviceId: string,
): Promise<void> {
  const user = await repository.findUserById(userId);
  if (!user) {
    throw new AuthError('User not found', AuthErrorCodes.USER_NOT_FOUND, 404);
  }
  assertUserUsable(user);

  const device = await repository.findMFADeviceById(deviceId, userId);
  if (!device || !device.is_active) {
    throw new AuthError(
      'MFA device not found',
      AuthErrorCodes.MFA_DEVICE_NOT_FOUND,
      404,
    );
  }
  if (device.device_type !== 'email') {
    throw new AuthError(
      'Device is not an email MFA device',
      AuthErrorCodes.INVALID_OPERATION,
      400,
    );
  }

  const otp = await generateEmailMfaOtp();
  const otpHash = hashEmailMfaOtp(otp);
  await createEmailMfaOtp(userId, device.id, otpHash);
  const purpose = device.verified ? 'challenge' : 'setup';
  await sendEmailMfaOtpEmail(user, otp, device.device_name, purpose);
}

export async function setPrimaryMFADevice(
  userId: string,
  deviceId: string,
): Promise<void> {
  const device = await repository.findMFADeviceById(deviceId, userId);
  if (!device || !device.verified || !device.is_active) {
    throw new AuthError(
      'Invalid device',
      AuthErrorCodes.MFA_DEVICE_NOT_FOUND,
      400,
    );
  }
  await repository.updateMFADevicePrimary(userId, deviceId);
}

/**
 * Remove an MFA device.
 *
 * If this is the LAST verified+active device, we require the current
 * password AND step-up freshness on the session (`routes.ts` enforces step-up
 * via the route middleware). We never accept a TOTP from the device being
 * removed.
 *
 * If other devices remain, step-up freshness is still required by the route
 * but no password is needed; the user has already proven recent MFA via the
 * step-up challenge.
 */
export async function removeMFADevice(
  userId: string,
  deviceId: string,
  currentPassword: string | undefined,
  ipAddress: string,
  requestId: string,
): Promise<void> {
  const user = await repository.findUserById(userId);
  if (!user) {
    throw new AuthError('User not found', AuthErrorCodes.USER_NOT_FOUND, 404);
  }

  const devices = await repository.findMFADevicesByUserId(userId);
  const target = devices.find((d) => d.id === deviceId);
  if (!target) {
    throw new AuthError(
      'Device not found',
      AuthErrorCodes.MFA_DEVICE_NOT_FOUND,
      404,
    );
  }

  const remainingActive = devices.filter(
    (d) => d.verified && d.is_active && d.id !== deviceId,
  );

  if (remainingActive.length === 0) {
    if (!user.password_hash) {
      throw new AuthError(
        'Cannot remove last MFA device on a passwordless account; contact support',
        AuthErrorCodes.INVALID_OPERATION,
        400,
      );
    }
    if (!currentPassword) {
      throw new AuthError(
        'Current password required to remove the last MFA device',
        AuthErrorCodes.PASSWORD_REQUIRED,
        400,
      );
    }
    const valid = await verifyPassword(currentPassword, user.password_hash);
    if (!valid) {
      throw new AuthError(
        'Password incorrect',
        AuthErrorCodes.PASSWORD_INCORRECT,
        401,
      );
    }
  }

  await repository.withTransaction(async (client) => {
    await repository.disableMFADevice(deviceId, 'user_removed', client);
    if (remainingActive.length === 0) {
      await repository.updateUserMFAEnabled(userId, false, client);
    } else if (target.is_primary) {
      const newPrimary = remainingActive[0]!;
      await repository.updateMFADevicePrimary(userId, newPrimary.id, client);
    }
  });

  if (remainingActive.length === 0) {
    await sendMFAStatusEmail(user, false);
  }

  logAudit({
    user_id: userId,
    org_id: null,
    action:
      remainingActive.length === 0
        ? 'user.mfa_disabled'
        : 'user.mfa_device_removed',
    resource_type: 'user',
    resource_id: userId,
    ip_address: ipAddress,
    request_id: requestId,
    metadata: { device_id: deviceId, last_device: remainingActive.length === 0 },
  });
}

export async function generateNewBackupCodes(
  userId: string,
  input: RegenerateBackupCodesInput,
): Promise<string[]> {
  const devices = await repository.findMFADevicesByUserId(userId);
  const primary = devices.find((d) => d.is_primary && d.verified && d.is_active);
  if (!primary) {
    throw new AuthError(
      'No primary MFA device',
      AuthErrorCodes.MFA_NOT_ENABLED,
      400,
    );
  }
  // Verify the code based on device type.
  let codeValid = false;
  if (primary.device_type === 'email') {
    const codeHash = hashEmailMfaOtp(input.mfa_code);
    codeValid = await consumeEmailMfaOtp(primary.id, codeHash);
  } else {
    codeValid = verifyTotpDeviceCode(primary, input.mfa_code);
  }
  if (!codeValid) {
    throw new AuthError('Invalid MFA code', AuthErrorCodes.MFA_INVALID, 400);
  }

  const { plain, hashed } = await generateBackupCodes();

  await repository.withTransaction(async (client) => {
    await repository.setBackupCodesForAllUserDevices(userId, hashed, client);
    await repository.updateBackupCodesGenerated(userId, client);
  });

  return plain;
}

/**
 * Toggle MFA. Enabling requires possession of an already-verified device +
 * a fresh TOTP code. Disabling now goes through the two-step
 * `requestMfaDisable` / `confirmMfaDisable` flow and is rejected here.
 */
export async function toggleMFA(
  userId: string,
  input: MFAToggleInput,
  ipAddress: string,
  requestId: string,
): Promise<{ enabled: boolean }> {
  const user = await repository.findUserById(userId);
  if (!user) {
    throw new AuthError('User not found', AuthErrorCodes.USER_NOT_FOUND, 404);
  }
  assertUserUsable(user);

  if (input.enabled && user.mfa_enabled) return { enabled: true };

  // Enabling: require a currently-verified device.
  const devices = await repository.findMFADevicesByUserId(userId);
  const primary =
    devices.find((d) => d.is_primary && d.verified && d.is_active) ||
    devices.find((d) => d.verified && d.is_active);
  if (!primary) {
    throw new AuthError(
      'Verified MFA device required before enabling MFA',
      AuthErrorCodes.MFA_NOT_ENABLED,
      400,
    );
  }
  // Verify the code based on device type.
  let codeValid = false;
  if (primary.device_type === 'email') {
    const codeHash = hashEmailMfaOtp(input.mfa_code);
    codeValid = await consumeEmailMfaOtp(primary.id, codeHash);
  } else {
    codeValid = verifyTotpDeviceCode(primary, input.mfa_code);
  }
  if (!codeValid) {
    throw new AuthError('Invalid MFA code', AuthErrorCodes.MFA_INVALID, 400);
  }

  await repository.updateUserMFAEnabled(userId, true);
  await sendMFAStatusEmail(user, true);

  logAudit({
    user_id: userId,
    org_id: null,
    action: 'user.mfa_enabled',
    resource_type: 'user',
    resource_id: userId,
    ip_address: ipAddress,
    request_id: requestId,
    metadata: { reason: 'user_toggled' },
  });
  return { enabled: true };
}

/**
 * Step 1 of MFA disable: verify the supplied TOTP, then mail the user a
 * one-time confirmation link. MFA stays enabled until the link is consumed.
 *
 * This prevents the "phished password + one TOTP = MFA disabled" attack:
 * even if both are phished in real time, the attacker still needs control
 * of the user's email inbox.
 */
export async function requestMfaDisable(
  userId: string,
  input: MFADisableRequestInput,
  ipAddress: string,
  requestId: string,
): Promise<{ message: string }> {
  const user = await repository.findUserById(userId);
  if (!user) {
    throw new AuthError('User not found', AuthErrorCodes.USER_NOT_FOUND, 404);
  }
  if (!user.mfa_enabled) {
    throw new AuthError('MFA not enabled', AuthErrorCodes.MFA_NOT_ENABLED, 400);
  }

  const devices = await repository.findMFADevicesByUserId(userId);
  const primary = devices.find((d) => d.is_primary && d.verified && d.is_active);
  if (!primary) {
    throw new AuthError('MFA not enabled', AuthErrorCodes.MFA_NOT_ENABLED, 400);
  }

  // Accept TOTP or email OTP at this stage. Backup codes intentionally cannot
  // start a disable request, because a single phished backup code should not
  // be the entire trust signal for tearing down MFA.
  let codeValid = false;
  if (primary.device_type === 'email') {
    const codeHash = hashEmailMfaOtp(input.mfa_code);
    codeValid = await consumeEmailMfaOtp(primary.id, codeHash);
  } else {
    codeValid = verifyTotpDeviceCode(primary, input.mfa_code);
  }
  if (!codeValid) {
    throw new AuthError('Invalid MFA code', AuthErrorCodes.MFA_INVALID, 400);
  }

  const token = generateSecureToken();
  await repository.createEmailVerification({
    user_id: user.id,
    email: normalizeEmail(user.email),
    token_hash: hashEmailFlowToken('mfa_disable', token),
    purpose: 'mfa_disable',
    expires_at: new Date(Date.now() + MFA_DISABLE_TOKEN_TTL_SECONDS * 1000),
  });

  await sendMfaDisableConfirmEmail(user, token);

  await repository
    .recordSecurityEvent({
      event_type: 'mfa_disable_requested',
      severity: 5,
      user_id: user.id,
      ip_address: ipAddress,
      description: 'User requested MFA disable; awaiting email confirmation',
    })
    .catch((err) => {
      logger.warn({ err, userId: user.id }, 'recordSecurityEvent failed');
    });

  logAudit({
    user_id: userId,
    org_id: null,
    action: 'user.mfa_disable_requested',
    resource_type: 'user',
    resource_id: userId,
    ip_address: ipAddress,
    request_id: requestId,
  });

  return {
    message:
      'Confirmation email sent. Click the link in the email to complete MFA disable.',
  };
}

/**
 * Step 2 of MFA disable: consume the one-time email token and actually
 * disable MFA. The token can only be redeemed once; old tokens for the same
 * user/purpose are invalidated when a new request is made.
 */
export async function confirmMfaDisable(
  input: MFADisableConfirmInput,
  ipAddress: string,
  requestId: string,
): Promise<void> {
  const tokenHash = hashEmailFlowToken('mfa_disable', input.token);

  let userId: string | null = null;

  await repository.withTransaction(async (client) => {
    const consumed = await repository.consumeEmailVerificationToken(
      tokenHash,
      'mfa_disable',
      client,
    );
    if (!consumed) {
      throw new AuthError(
        'Invalid or expired MFA disable token',
        AuthErrorCodes.MFA_DISABLE_INVALID,
        400,
      );
    }

    const userRes = await client.query<User>(
      `SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
      [consumed.user_id],
    );
    const user = userRes.rows[0];
    if (
      !user ||
      user.status !== 'active' ||
      normalizeEmail(user.email) !== normalizeEmail(consumed.email)
    ) {
      throw new AuthError(
        'Invalid or expired MFA disable token',
        AuthErrorCodes.MFA_DISABLE_INVALID,
        400,
      );
    }

    if (!user.mfa_enabled) {
      // Token was valid but MFA already off — treat as idempotent success.
      userId = user.id;
      return;
    }

    await repository.disableAllMFADevices(user.id, 'User disabled MFA', client);
    await repository.updateUserMFAEnabled(user.id, false, client);
    userId = user.id;
  });

  if (userId) {
    const user = await repository.findUserById(userId);
    if (user) await sendMFAStatusEmail(user, false);

    logAudit({
      user_id: userId,
      org_id: null,
      action: 'user.mfa_disabled',
      resource_type: 'user',
      resource_id: userId,
      ip_address: ipAddress,
      request_id: requestId,
      metadata: { method: 'email_confirmation' },
    });
  }
}

// ============================================================================
// SESSIONS
// ============================================================================

export async function listUserSessions(
  userId: string,
  currentSessionId?: string,
): Promise<SessionInfo[]> {
  const sessions = await repository.listActiveSessionsByUser(userId);
  return sessions.map((s) => ({
    id: s.id,
    device_name: s.device_name,
    device_type: s.device_type,
    ip_address: s.ip_address,
    ip_geo_country: s.ip_geo_country,
    last_active_at: s.last_active_at,
    created_at: s.created_at,
    is_current: s.id === currentSessionId,
  }));
}

export async function revokeSession(
  userId: string,
  sessionId: string,
  currentSessionId?: string,
): Promise<void> {
  if (sessionId === currentSessionId) {
    throw new AuthError(
      'Cannot revoke current session via this endpoint; use /logout',
      AuthErrorCodes.INVALID_OPERATION,
      400,
    );
  }
  const session = await repository.findSessionById(sessionId, userId);
  if (!session) {
    throw new AuthError(
      'Session not found',
      AuthErrorCodes.SESSION_INVALID,
      404,
    );
  }
  await repository.revokeSession(sessionId, 'User revoked session');
  blacklistAccessToken(sessionId);
}

/**
 * Revoke every session except the caller's. Surgically blacklists the
 * access tokens of OTHER sessions only — the caller's current access token
 * remains valid until it expires naturally.
 */
export async function revokeAllOtherSessions(
  userId: string,
  currentSessionId: string,
): Promise<number> {
  const otherIds = await repository.listOtherActiveSessionIds(
    userId,
    currentSessionId,
  );
  for (const id of otherIds) {
    blacklistAccessToken(id);
  }
  return repository.revokeAllOtherSessions(
    userId,
    currentSessionId,
    'User revoked all other sessions',
  );
}

/**
 * Refresh-token rotation with reuse detection AND a 30-second retry-grace
 * window. The grace window is what protects legitimate clients on flaky
 * networks from being kicked out: when the same refresh token is presented
 * twice within the window, the second call is treated as a network retry,
 * not a replay attack.
 */
export async function refreshAccessToken(
  refreshToken: string,
  ipAddress: string,
  userAgent: string,
  requestId: string,
): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  sessionId: string;
}> {
  let decoded;
  try {
    decoded = verifyRefreshToken(refreshToken);
  } catch {
    throw new AuthError(
      'Invalid refresh token',
      AuthErrorCodes.SESSION_INVALID,
      401,
    );
  }
  if (decoded.type !== 'refresh') {
    throw new AuthError(
      'Invalid token type',
      AuthErrorCodes.SESSION_INVALID,
      401,
    );
  }

  const presentedHash = hashAuthToken(refreshToken);

  // Scoped lookup: only the session the JWT claims to belong to is allowed.
  const lookup = await repository.findSessionByAnyRefreshTokenHash(
    presentedHash,
    decoded.jti,
    decoded.sub,
  );
  if (!lookup) {
    throw new AuthError(
      'Invalid session',
      AuthErrorCodes.SESSION_INVALID,
      401,
    );
  }
  const { session, matchedPrevious } = lookup;

  // Grace window: legitimate retry of a JUST-rotated refresh.
  if (matchedPrevious && session.status === 'active') {
    const rotatedAt = session.previous_refresh_rotated_at;
    if (
      rotatedAt &&
      Date.now() - new Date(rotatedAt).getTime() <= REFRESH_GRACE_WINDOW_MS
    ) {
      // Treat as idempotent retry: do not rotate again. Re-issue an access
      // token for the existing (already-rotated) refresh hash. The client
      // must use the refresh token it received from the FIRST call going
      // forward.
      const user = await repository.findUserById(session.user_id);
      if (!user || user.deleted_at || user.status !== 'active') {
        await repository.revokeSession(session.id, 'User inactive');
        throw new AuthError('User inactive', AuthErrorCodes.USER_SUSPENDED, 401);
      }
      const mfaVerified =
        Boolean(session.mfa_verified_at) || !user.mfa_enabled;
      const accessToken = generateAccessToken(
        session.user_id,
        session.id,
        mfaVerified,
      );
      // We must return SOME refresh token in the response shape. The client
      // already has the new one from the first call; return it again is not
      // possible (we never saw the plaintext). Convention: return the SAME
      // token they presented; their first-call refresh is what is current
      // server-side. This is safe because the token is only valid until
      // their next successful refresh.
      return {
        accessToken,
        refreshToken,
        expiresAt: new Date(session.expires_at),
        sessionId: session.id,
      };
    }
  }

  // True reuse / inactive session: revoke entire family.
  if (matchedPrevious || session.status !== 'active') {
    logger.warn(
      { userId: session.user_id, sessionId: session.id, ipAddress, userAgent },
      'Refresh-token reuse detected',
    );
    await repository.revokeAllUserSessions(
      session.user_id,
      'refresh_token_reuse_detected',
    );
    markAllUserTokensRevoked(session.user_id);
    await repository
      .recordSecurityEvent({
        event_type: 'refresh_token_reuse',
        severity: 9,
        user_id: session.user_id,
        ip_address: ipAddress,
        user_agent: userAgent,
        description: 'Refresh token replay detected; all sessions revoked',
        evidence: {
          matched_previous: matchedPrevious,
          session_status: session.status,
        },
        action_taken: 'sessions_revoked',
      })
      .catch((err) => {
        logger.warn({ err }, 'recordSecurityEvent failed');
      });
    logAudit({
      user_id: session.user_id,
      org_id: null,
      action: 'user.security_event',
      resource_type: 'session',
      resource_id: session.id,
      ip_address: ipAddress,
      user_agent: userAgent,
      request_id: requestId,
      metadata: {
        type: 'refresh_token_reuse',
        matched_previous: matchedPrevious,
        session_status: session.status,
      },
    });
    throw new AuthError(
      'Refresh token reuse detected. All sessions have been revoked. Please sign in again.',
      AuthErrorCodes.REFRESH_TOKEN_REUSED,
      401,
    );
  }

  const now = new Date();
  if (now > new Date(session.absolute_expires_at)) {
    await repository.revokeSession(session.id, 'Absolute session expiry reached');
    throw new AuthError('Session expired', AuthErrorCodes.SESSION_EXPIRED, 401);
  }
  if (now > new Date(session.expires_at)) {
    await repository.revokeSession(session.id, 'Sliding window expired');
    throw new AuthError('Session expired', AuthErrorCodes.SESSION_EXPIRED, 401);
  }

  const user = await repository.findUserById(session.user_id);
  if (!user || user.deleted_at || user.status !== 'active') {
    await repository.revokeSession(session.id, 'User inactive');
    throw new AuthError('User inactive', AuthErrorCodes.USER_SUSPENDED, 401);
  }

  try {
    await assertRefreshAllowedByOrgPolicy(user, session.last_active_at);
  } catch (policyErr) {
    await repository.revokeSession(session.id, 'Organization policy violation');
    markAllUserTokensRevoked(user.id);
    throw policyErr;
  }

  // CAS rotation
  const newRefreshToken = generateRefreshToken(session.user_id, session.id);
  const newRefreshHash = hashAuthToken(newRefreshToken);

  const newExpiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000);
  const finalExpiresAt =
    newExpiresAt > new Date(session.absolute_expires_at)
      ? new Date(session.absolute_expires_at)
      : newExpiresAt;

  const rotated = await repository.rotateRefreshToken(
    session.id,
    presentedHash,
    newRefreshHash,
    finalExpiresAt,
  );
  if (!rotated) {
    // CAS failed: a concurrent refresh already rotated. Outside the grace
    // window we treat this as reuse for safety.
    await repository.revokeAllUserSessions(
      session.user_id,
      'refresh_token_concurrent_rotation',
    );
    markAllUserTokensRevoked(session.user_id);
    throw new AuthError(
      'Refresh token already rotated. Please sign in again.',
      AuthErrorCodes.REFRESH_TOKEN_REUSED,
      401,
    );
  }

  const mfaVerified = Boolean(session.mfa_verified_at) || !user.mfa_enabled;
  const accessToken = generateAccessToken(
    session.user_id,
    session.id,
    mfaVerified,
  );

  return {
    accessToken,
    refreshToken: newRefreshToken,
    expiresAt: finalExpiresAt,
    sessionId: session.id,
  };
}

export async function logout(
  userId: string,
  sessionId: string,
  ipAddress: string,
  requestId: string,
): Promise<{ saml_logout_url: string | null }> {
  const session = await repository.findSessionById(sessionId, userId);
  if (session?.saml_name_id && session.sso_provider_id) {
    const { completeSamlLogoutForUser } = await import('./saml-slo.service.js');
    const result = await completeSamlLogoutForUser(
      userId,
      sessionId,
      ipAddress,
      requestId,
    );
    return { saml_logout_url: result.logout_url };
  }

  await repository.revokeSession(sessionId, 'User logout');
  blacklistAccessToken(sessionId);

  logAudit({
    user_id: userId,
    org_id: null,
    action: 'user.logout',
    resource_type: 'session',
    resource_id: sessionId,
    ip_address: ipAddress,
    request_id: requestId,
  });

  return { saml_logout_url: null };
}

export async function getUserSessionDetail(
  userId: string,
  sessionId: string,
  currentSessionId: string,
): Promise<{
  id: string;
  device_name: string;
  device_type: string;
  ip_address: string;
  ip_geo_country: string | null;
  last_active_at: Date;
  created_at: Date;
  expires_at: Date;
  login_method: string | null;
  is_current: boolean;
}> {
  const session = await repository.findSessionById(sessionId, userId);
  if (!session || session.status !== 'active') {
    throw new AuthError(
      'Session not found',
      AuthErrorCodes.SESSION_INVALID,
      404,
    );
  }
  return {
    id: session.id,
    device_name: session.device_name ?? 'Unknown device',
    device_type: session.device_type ?? 'web',
    ip_address: session.ip_address,
    ip_geo_country: session.ip_geo_country,
    last_active_at: session.last_active_at,
    created_at: session.created_at,
    expires_at: session.expires_at,
    login_method: session.login_method,
    is_current: session.id === currentSessionId,
  };
}

export async function revokeAllSessionsForUser(
  userId: string,
  currentSessionId: string,
): Promise<number> {
  const sessions = await repository.listActiveSessionsByUser(userId);
  for (const s of sessions) {
    blacklistAccessToken(s.id);
  }
  await repository.revokeAllSessionsForUser(userId, 'User revoked all sessions');
  return sessions.length;
}
