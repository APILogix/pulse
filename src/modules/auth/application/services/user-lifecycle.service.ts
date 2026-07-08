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
import { sendVerificationEmail } from './email.service.js';
import { emailToHash, toUserProfile, assertUserUsable, markAllUserTokensRevoked, revokeAllSessionsAndTokens } from './shared-helpers.js';




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
  const verificationToken = generateEmailFlowToken();
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

  const updated = await repository.updateUser(userId, userId, updates);
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
