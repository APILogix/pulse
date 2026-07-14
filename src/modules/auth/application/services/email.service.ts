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
import { issueSessionForUser, revokeSession, revokeAllOtherSessions, logout } from './session.service.js';
import { EMAIL_MFA_OTP_TTL_SECONDS, EMAIL_MFA_OTP_DIGITS, GENERIC_PASSWORD_RESET_MESSAGE, GENERIC_VERIFICATION_MESSAGE, randomBytesAsync, emailToHash, assertUserUsable, ensurePasswordNotReused, revokeAllSessionsAndTokens, blacklistOtherUserSessionTokens } from './shared-helpers.js';




// ============================================================================
// EMAIL HELPERS
// ============================================================================

export function getBaseUrl(value: string | undefined, fallback: string): string {
  return (value || fallback).replace(/\/+$/, '');
}

export function buildVerifyEmailUrl(token: string): string {
  // Verification links open in the SPA (same as password reset / MFA disable).
  return `${getBaseUrl(config.FRONTEND_URL, config.APP_URL)}/auth/verify-email?token=${encodeURIComponent(token)}`;
}

export function buildResetPasswordUrl(token: string): string {
  return `${getBaseUrl(config.FRONTEND_URL, config.APP_URL)}/auth/reset-password?token=${encodeURIComponent(token)}`;
}

export function buildMfaDisableConfirmUrl(token: string): string {
  return `${getBaseUrl(config.FRONTEND_URL, config.APP_URL)}/security/mfa/disable?token=${encodeURIComponent(token)}`;
}

export function toMinutes(seconds: number): number {
  return Math.ceil(seconds / 60);
}

export async function sendVerificationEmail(
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

export async function sendPasswordResetEmail(
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

export async function sendMFAStatusEmail(
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

export async function sendMfaDisableConfirmEmail(
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
export async function generateEmailMfaOtp(): Promise<string> {
  // 4 bytes = 32 bits. Rejection threshold is the largest multiple of
  // 1,000,000 below 2^32, so modulo does not introduce bias.
  const REJECTION_THRESHOLD = 4_294_000_000;
  const RANGE = 1_000_000;
  while (true) {
    const buf = await randomBytesAsync(4);
    const val = buf.readUInt32BE(0);
    if (val < REJECTION_THRESHOLD) {
      return (val % RANGE).toString(10).padStart(EMAIL_MFA_OTP_DIGITS, '0');
    }
  }
}

export function hashEmailMfaOtp(code: string): string {
  return createHash('sha256').update(`email_mfa_otp:${code}`).digest('hex');
}

/**
 * Persist an email MFA OTP. Any prior unconsumed OTP for the same device is
 * invalidated first so only the newest code is valid.
 */
export async function createEmailMfaOtp(
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
export async function consumeEmailMfaOtp(
  deviceId: string,
  codeHash: string,
): Promise<boolean> {
  return repository.consumeEmailMfaOtp(deviceId, codeHash);
}

export async function sendEmailMfaOtpEmail(
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
    !user.email_is_verified
  ) {
    const verificationToken = generateEmailFlowToken();
    await repository.createEmailVerification({
      user_id: user.id,
      email: normalizedEmail,
      token_hash: hashEmailFlowToken('email_verification', verificationToken),
      purpose: 'email_verification',
      expires_at: new Date(Date.now() + EMAIL_VERIFICATION_TTL_SECONDS * 1000),
    });
    try {
      await sendVerificationEmail(user, verificationToken);
    } catch (err: any) {
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
  input: VerifyEmailInput,
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
        if (user?.email_is_verified) {
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
    if (!user.email_is_verified) {
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
    const resetToken = generateEmailFlowToken();
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
  await repository.revokeSession(currentSessionId, userId, 'Password changed');

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

