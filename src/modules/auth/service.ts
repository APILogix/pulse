/**
 * Auth Service - Business Logic
 * Enterprise-grade security with rate limiting, encryption, and audit logging
 */

import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { promisify } from "util";
import * as OTPAuth from "otpauth"; // Install: npm install otpauth
import QRCode from "qrcode"; // Install: npm install qrcode

import { AuthError, AuthErrorCodes, MFAType } from "./types.js";
import type {
  User,
  UserProfile,
  MFADevice,
  TOTPSetup,
  MFAChallenge,
  SessionInfo,
  UserSession,
  CreateUserInput,
  UpdateUserInput,
  DeleteUserInput,
  MFASetupInput,
  MFAVerifySetupInput,
  MFAVerifyInput,
  BackupCodeVerificationInput,
  LoginInput,
  LoginMFAVerifyInput,
  ChangePasswordInput,
  ForgotPasswordInput,
  ResetPasswordInput,
} from "./types.js";
import bcrypt from "bcrypt";
import * as repository from "./repository.js";
import {
  encrypt,
  decrypt,
  hashPassword,
  verifyPassword,
} from "../../shared/utils/encryption.js";
import { generateId, generateUUID } from "../../shared/utils/id.js";
import { env as config } from "../../config/env.js";
import { redis } from "../../config/redis.js";
import { logAudit } from "../../shared/middleware/audit-logger.js";
import {
  ACCESS_TOKEN_TTL_SECONDS,
  MFA_LOGIN_CHALLENGE_TTL_SECONDS,
  PASSWORD_RESET_TTL_SECONDS,
  REFRESH_TOKEN_TTL_SECONDS,
  buildPasswordHistory,
  generateAccessToken,
  generateSecureToken,
  hashToken as hashAuthToken,
  normalizeEmail,
} from "./utils.js";

// ============================================
// CONSTANTS & CONFIG
// ============================================

const SESSION_CONFIG = {
  ACCESS_TOKEN_TTL: 15 * 60, // 15 minutes
  REFRESH_TOKEN_TTL: 7 * 24 * 60 * 60, // 7 days
  ABSOLUTE_SESSION_TTL: 30 * 24 * 60 * 60, // 30 days max
  MFA_CHALLENGE_TTL: 5 * 60, // 5 minutes
  MAX_ACTIVE_SESSIONS: 10,
};

const RATE_LIMITS = {
  LOGIN: { points: 5, duration: 60 * 15 }, // 5 attempts per 15 min
  MFA_SETUP: { points: 3, duration: 60 * 60 }, // 3 per hour
  MFA_VERIFY: { points: 5, duration: 60 * 15 },
  PASSWORD_CHECK: { points: 10, duration: 60 * 15 },
};

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Generate cryptographically secure random bytes
 */
const randomBytesAsync = promisify(randomBytes);

/**
 * Hash a token for storage (SHA-256)
 */
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Generate secure backup codes
 */
async function generateBackupCodes(): Promise<{
  plain: string[];
  hashed: string[];
}> {
  const codes: string[] = [];
  for (let i = 0; i < 10; i++) {
    const bytes = await randomBytesAsync(5);
    codes.push(bytes.toString("hex")); // 10 chars
  }
  const hashed = codes.map((code) =>
    createHash("sha256").update(code).digest("hex"),
  );
  return { plain: codes, hashed };
}

/**
 * Verify a backup code using constant-time comparison
 */
function verifyBackupCodeHash(plain: string, hashed: string): boolean {
  const plainHash = createHash("sha256").update(plain).digest("hex");
  try {
    return timingSafeEqual(Buffer.from(plainHash), Buffer.from(hashed));
  } catch {
    return false;
  }
}

/**
 * Rate limit check using Redis
 */
async function checkRateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<boolean> {
  const redisKey = `rate_limit:${key}`;
  const current = await redis.incr(redisKey);
  if (current === 1) {
    await redis.expire(redisKey, windowSeconds);
  }
  return current <= limit;
}

/**
 * Get device fingerprint from request
 */
function getDeviceFingerprint(ip: string, userAgent: string): string {
  return createHash("sha256")
    .update(`${ip}:${userAgent}`)
    .digest("hex")
    .substring(0, 32);
}

/**
 * Mask user for public response
 */
function toUserProfile(user: User, isAdmin = false): UserProfile {
  const base: UserProfile = {
    id: user.id,
    email: user.email,
    email_verified: user.email_verified,
    full_name: user.full_name,
    avatar_url: user.avatar_url,
    status: user.status,
    mfa_enabled: user.mfa_enabled,
    timezone: user.timezone,
    locale: user.locale,
    last_login_at: user.last_login_at,
    created_at: user.created_at,
  };

  if (isAdmin) {
    // Add admin-only fields if needed
  }

  return base;
}

/**
 * Validate user is active and not locked
 */
function validateUserActive(user: User): void {
  if (user.deleted_at) {
    throw new AuthError(
      "User account has been deleted",
      AuthErrorCodes.USER_DELETED,
      403,
    );
  }
  if (user.status === "suspended") {
    throw new AuthError(
      `Account suspended: ${user.status_reason || "Contact support"}`,
      AuthErrorCodes.USER_SUSPENDED,
      403,
    );
  }
  if (user.locked_until && user.locked_until > new Date()) {
    throw new AuthError(
      `Account locked until ${user.locked_until.toISOString()}`,
      AuthErrorCodes.USER_SUSPENDED,
      403,
      { lockedUntil: user.locked_until },
    );
  }
}

function getUserPasswordHashes(user: User): string[] {
  const history = Array.isArray(user.password_history)
    ? user.password_history.filter((entry): entry is string => typeof entry === "string")
    : [];

  return [user.password_hash, ...history].filter(
    (entry): entry is string => Boolean(entry),
  );
}

async function ensurePasswordNotReused(
  user: User,
  newPassword: string,
): Promise<void> {
  const previousHashes = getUserPasswordHashes(user);

  for (const hash of previousHashes) {
    if (await verifyPassword(newPassword, hash)) {
      throw new AuthError(
        "New password must not match a recent password",
        AuthErrorCodes.PASSWORD_REUSE_NOT_ALLOWED,
        400,
      );
    }
  }
}

async function blacklistAccessToken(sessionId: string): Promise<void> {
  await redis.setex(`token_revoke:${sessionId}`, ACCESS_TOKEN_TTL_SECONDS, "1");
}

async function revokeUserSessions(
  userId: string,
  reason: string,
): Promise<number> {
  const sessions = await repository.listActiveSessionsByUser(userId);

  for (const session of sessions) {
    await repository.revokeSession(session.id, reason);
    await blacklistAccessToken(session.id);
  }

  return sessions.length;
}

type IssuedSession = {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  sessionId: string;
};

async function issueSessionForUser(options: {
  user: User;
  ipAddress: string;
  userAgent: string;
  deviceName: string | undefined;
  deviceType: string | undefined;
  mfaVerified: boolean;
}): Promise<IssuedSession> {
  const refreshToken = generateSecureToken();
  const refreshTokenHash = hashAuthToken(refreshToken);
  const now = Date.now();
  const expiresAt = new Date(now + REFRESH_TOKEN_TTL_SECONDS * 1000);
  const absoluteExpiresAt = new Date(
    now + SESSION_CONFIG.ABSOLUTE_SESSION_TTL * 1000,
  );

  const session = await repository.createSession({
    user_id: options.user.id,
    refresh_token_hash: refreshTokenHash,
    access_token_jti: null,
    device_fingerprint: getDeviceFingerprint(
      options.ipAddress,
      options.userAgent,
    ),
    device_name: options.deviceName || options.userAgent.slice(0, 255),
    device_type: options.deviceType || "web",
    ip_address: options.ipAddress,
    user_agent: options.userAgent,
    expires_at: expiresAt,
    absolute_expires_at: absoluteExpiresAt,
    mfa_verified_at: options.mfaVerified ? new Date() : null,
    mfa_expires_at: options.mfaVerified
      ? new Date(now + ACCESS_TOKEN_TTL_SECONDS * 1000)
      : null,
  });

  await repository.updateSessionActivity(session.id, session.id);

  return {
    accessToken: generateAccessToken(
      options.user.id,
      session.id,
      options.mfaVerified,
    ),
    refreshToken,
    expiresAt,
    sessionId: session.id,
  };
}

async function createLoginMFAChallenge(options: {
  user: User;
  challengeDevice: MFADevice;
  ipAddress: string;
  userAgent: string;
  deviceName: string | undefined;
  clientDeviceType: string | undefined;
}): Promise<{
  challengeId: string;
  expiresAt: Date;
  deviceType: string;
}> {
  const challengeId = generateId();
  const expiresAt = new Date(
    Date.now() + MFA_LOGIN_CHALLENGE_TTL_SECONDS * 1000,
  );

  await redis.setex(
    `auth_login_challenge:${challengeId}`,
    MFA_LOGIN_CHALLENGE_TTL_SECONDS,
      JSON.stringify({
      userId: options.user.id,
      deviceId: options.challengeDevice.id,
      deviceName: options.deviceName || options.userAgent.slice(0, 255),
      deviceType: options.challengeDevice.device_type,
      clientDeviceType: options.clientDeviceType || "web",
      ipAddress: options.ipAddress,
      userAgent: options.userAgent,
      attempts: 0,
    }),
  );

  return {
    challengeId,
    expiresAt,
    deviceType: options.challengeDevice.device_type,
  };
}

async function consumeBackupCode(
  userId: string,
  code: string,
): Promise<boolean> {
  const devices = await repository.findMFADevicesByUserId(userId, false);

  for (const device of devices) {
    const codes = Array.isArray(device.backup_codes_hash)
      ? device.backup_codes_hash.filter(
          (entry): entry is string => typeof entry === "string",
        )
      : [];

    const matchIndex = codes.findIndex((hashedCode) =>
      verifyBackupCodeHash(code, hashedCode),
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

// ============================================
// USER SERVICES
// ============================================

export async function createUserFromEmail(
  input: CreateUserInput,
  ipAddress: string,
  requestId: string,
): Promise<User> {
  // Check email hash collision
  const emailHash = createHash("sha256")
    .update(input.email.toLowerCase())
    .digest("hex");
  const emailExists = await repository.findUserByEmailHash(emailHash);
  if (emailExists) {
    throw new AuthError(
      "Email already registered",
      AuthErrorCodes.USER_EXISTS,
      409,
    );
  }


  const passwordhash= await hashPassword(input.password);
  const user = await repository.createUser({
    id: generateUUID(),
    email: input.email,
    full_name: input.full_name,
    avatar_url: input.avatar_url,
    email_hash: emailHash,
    password: passwordhash,
  });

  // // Audit log
  // await logAudit({
  //   user_id: user.id,
  //   org_id: null,
  //   action: "user.created",
  //   resource_type: "user",
  //   resource_id: user.id,
  //   ip_address: ipAddress,
  //   request_id,
  //   metadata: { source: "clerk_webhook", email_verified: input.email_verified },
  // });

  return user;
}

export async function getCurrentUser(userId: string): Promise<UserProfile> {
  const user = await repository.findUserById(userId);
  if (!user) {
    throw new AuthError("User not found", AuthErrorCodes.USER_NOT_FOUND, 404);
  }
  validateUserActive(user);
  return toUserProfile(user);
}

export async function updateCurrentUser(
  userId: string,
  input: UpdateUserInput,
): Promise<UserProfile> {
  const user = await repository.findUserById(userId);
  if (!user) {
    throw new AuthError("User not found", AuthErrorCodes.USER_NOT_FOUND, 404);
  }
  validateUserActive(user);

  const updates: Partial<Pick<User, "full_name" | "avatar_url" | "timezone" | "locale" | "preferred_mfa_method">> = {};
  if (input.full_name !== undefined) updates.full_name = input.full_name;
  if (input.avatar_url !== undefined) updates.avatar_url = input.avatar_url;
  if (input.timezone !== undefined) updates.timezone = input.timezone;
  if (input.locale !== undefined) updates.locale = input.locale;
  if (input.preferred_mfa_method !== undefined) {
    updates.preferred_mfa_method = input.preferred_mfa_method;
  }

  const updated = await repository.updateUser(userId, updates);

  if (!updated) {
    throw new AuthError("Update failed", AuthErrorCodes.USER_NOT_FOUND, 500);
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
    throw new AuthError("User not found", AuthErrorCodes.USER_NOT_FOUND, 404);
  }

  // If user has password (non-SSO), verify it
  if (user.password_hash) {
    if (!input.password) {
      throw new AuthError(
        "Password required",
        AuthErrorCodes.PASSWORD_REQUIRED,
        400,
      );
    }

    const rateKey = `pwd_check:${userId}`;
    const allowed = await checkRateLimit(
      rateKey,
      RATE_LIMITS.PASSWORD_CHECK.points,
      RATE_LIMITS.PASSWORD_CHECK.duration,
    );
    if (!allowed) {
      throw new AuthError(
        "Too many attempts",
        AuthErrorCodes.RATE_LIMITED,
        429,
      );
    }

    const valid = await verifyPassword(input.password, user.password_hash);
    if (!valid) {
      throw new AuthError(
        "Password incorrect",
        AuthErrorCodes.PASSWORD_INCORRECT,
        401,
      );
    }
  }

  // Soft delete
  await repository.softDeleteUser(userId, input.reason || null, userId);

  // Revoke all sessions
  await revokeUserSessions(userId, "User account deleted");

  // Audit log
  await logAudit({
    user_id: userId,
    org_id: null,
    action: "user.deleted",
    resource_type: "user",
    resource_id: userId,
    ip_address: ipAddress,
    request_id: requestId,
    metadata: { reason: input.reason, method: "self_delete" },
  });
}

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
      user_id: string;
    }
  | {
      mfa_required: false;
      access_token: string;
      refresh_token: string;
      expires_at: Date;
      token_type: "Bearer";
      session_id: string;
    }
> {
  const normalizedEmail = normalizeEmail(input.email);
  const emailHash = createHash("sha256")
    .update(normalizedEmail)
    .digest("hex");

  const rateKey = `login:${emailHash}:${ipAddress}`;
  const allowed = await checkRateLimit(
    rateKey,
    RATE_LIMITS.LOGIN.points,
    RATE_LIMITS.LOGIN.duration,
  );
  if (!allowed) {
    throw new AuthError(
      "Too many login attempts",
      AuthErrorCodes.RATE_LIMITED,
      429,
    );
  }

  const user = await repository.findUserByEmailHash(emailHash);
  if (!user || user.deleted_at || user.status === "deleted") {
    throw new AuthError(
      "Invalid email or password",
      AuthErrorCodes.INVALID_CREDENTIALS,
      401,
    );
  }

  if (user.status === "suspended") {
    throw new AuthError(
      `Account suspended: ${user.status_reason || "Contact support"}`,
      AuthErrorCodes.USER_SUSPENDED,
      403,
    );
  }

  if (user.locked_until && user.locked_until > new Date()) {
    throw new AuthError(
      `Account locked until ${user.locked_until.toISOString()}`,
      AuthErrorCodes.USER_SUSPENDED,
      423,
      { lockedUntil: user.locked_until },
    );
  }

  if (!user.password_hash) {
    throw new AuthError(
      "Password login is not enabled for this account",
      AuthErrorCodes.PASSWORD_REQUIRED,
      400,
    );
  }

  const passwordValid = await verifyPassword(input.password, user.password_hash);
  if (!passwordValid) {
    await repository.updateLoginAttempts(user.id, user.login_attempts + 1);
    throw new AuthError(
      "Invalid email or password",
      AuthErrorCodes.INVALID_CREDENTIALS,
      401,
    );
  }

  if (user.mfa_enabled) {
    const devices = await repository.findMFADevicesByUserId(user.id);
    const verifiedDevices = devices.filter((device) => device.verified && device.is_active);

    if (verifiedDevices.length === 0) {
      throw new AuthError(
        "MFA setup is incomplete for this account",
        AuthErrorCodes.MFA_NOT_ENABLED,
        400,
      );
    }

    const primaryDevice =
      verifiedDevices.find((device) => device.is_primary) || verifiedDevices[0];

    if (!primaryDevice) {
      throw new AuthError(
        "MFA setup is incomplete for this account",
        AuthErrorCodes.MFA_NOT_ENABLED,
        400,
      );
    }

    const challenge = await createLoginMFAChallenge({
      user,
      challengeDevice: primaryDevice,
      ipAddress,
      userAgent,
      deviceName: input.device_name,
      clientDeviceType,
    });

    return {
      mfa_required: true,
      challenge_id: challenge.challengeId,
      expires_at: challenge.expiresAt,
      device_type: challenge.deviceType,
      user_id: user.id,
    };
  }

  const session = await issueSessionForUser({
    user,
    ipAddress,
    userAgent,
    deviceName: input.device_name,
    deviceType: clientDeviceType,
    mfaVerified: !user.mfa_enabled,
  });

  await repository.recordLogin(user.id, ipAddress, userAgent);

  await logAudit({
    user_id: user.id,
    org_id: null,
    action: "user.login",
    resource_type: "user",
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
    token_type: "Bearer",
    session_id: session.sessionId,
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
  token_type: "Bearer";
  session_id: string;
  user_id: string;
}> {
  const rawChallenge = await redis.get(`auth_login_challenge:${input.challenge_id}`);
  if (!rawChallenge) {
    throw new AuthError(
      "Challenge expired or invalid",
      AuthErrorCodes.MFA_CHALLENGE_EXPIRED,
      400,
    );
  }

  const challenge = JSON.parse(rawChallenge) as {
    userId: string;
    deviceId: string;
    deviceName?: string;
    deviceType?: string;
    clientDeviceType?: string;
    attempts: number;
  };

  if (challenge.attempts >= 3) {
    await redis.del(`auth_login_challenge:${input.challenge_id}`);
    throw new AuthError(
      "Too many failed attempts",
      AuthErrorCodes.MFA_INVALID,
      400,
    );
  }

  const user = await repository.findUserById(challenge.userId);
  if (!user) {
    await redis.del(`auth_login_challenge:${input.challenge_id}`);
    throw new AuthError(
      "User not found",
      AuthErrorCodes.USER_NOT_FOUND,
      404,
    );
  }

  const device = await repository.findMFADeviceById(challenge.deviceId, user.id);
  if (!device || !device.verified || !device.is_active) {
    await redis.del(`auth_login_challenge:${input.challenge_id}`);
    throw new AuthError("MFA device invalid", AuthErrorCodes.MFA_INVALID, 400);
  }

  let verified = false;
  const secret = device.secret_encrypted
    ? decrypt(device.secret_encrypted, config.ENCRYPTION_KEY)
    : null;

  if (secret) {
    const totp = new OTPAuth.TOTP({
      issuer: "api-monitoring-backend",
      algorithm: "SHA256",
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(secret),
    });

    verified = totp.validate({ token: input.code, window: 1 }) !== null;
  }

  if (!verified) {
    verified = await consumeBackupCode(user.id, input.code);
  }

  if (!verified) {
    challenge.attempts += 1;
    await redis.setex(
      `auth_login_challenge:${input.challenge_id}`,
      MFA_LOGIN_CHALLENGE_TTL_SECONDS,
      JSON.stringify(challenge),
    );
    throw new AuthError("Invalid MFA code", AuthErrorCodes.MFA_INVALID, 400);
  }

  await redis.del(`auth_login_challenge:${input.challenge_id}`);

  await repository.withTransaction(async (client) => {
    await client.query(
      `UPDATE user_mfa_devices
       SET last_used_at = NOW(), last_used_ip = $2, updated_at = NOW()
       WHERE id = $1`,
      [device.id, ipAddress],
    );
  });

  const session = await issueSessionForUser({
    user,
    ipAddress,
    userAgent,
    deviceName: challenge.deviceName,
    deviceType: challenge.clientDeviceType || clientDeviceType,
    mfaVerified: true,
  });

  await repository.recordLogin(user.id, ipAddress, userAgent);

  await logAudit({
    user_id: user.id,
    org_id: null,
    action: "user.login",
    resource_type: "user",
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
    token_type: "Bearer",
    session_id: session.sessionId,
    user_id: user.id,
  };
}

export async function requestPasswordReset(
  input: ForgotPasswordInput,
  ipAddress: string,
  requestId: string,
): Promise<{ message: string; resetToken?: string }> {
  const normalizedEmail = normalizeEmail(input.email);
  const emailHash = createHash("sha256")
    .update(normalizedEmail)
    .digest("hex");
  const user = await repository.findUserByEmailHash(emailHash);

  if (!user || user.deleted_at) {
    return { message: "If the email exists, a password reset link has been sent" };
  }

  const resetToken = generateSecureToken();
  const resetTokenHash = hashAuthToken(resetToken);
  const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_SECONDS * 1000);

  await repository.invalidatePasswordResetsForUser(user.id);
  await repository.createPasswordReset({
    user_id: user.id,
    token_hash: resetTokenHash,
    expires_at: expiresAt,
  });

  await logAudit({
    user_id: user.id,
    org_id: null,
    action: "user.updated",
    resource_type: "user",
    resource_id: user.id,
    ip_address: ipAddress,
    request_id: requestId,
    metadata: { action: "password_reset_requested" },
  });

  if (config.NODE_ENV !== "production") {
    return {
      message: "If the email exists, a password reset link has been sent",
      resetToken,
    };
  }

  return { message: "If the email exists, a password reset link has been sent" };
}

export async function resetPasswordWithToken(
  input: ResetPasswordInput,
  ipAddress: string,
  requestId: string,
): Promise<void> {
  const tokenHash = hashAuthToken(input.token);
  const reset = await repository.findPasswordResetByToken(tokenHash);

  if (!reset) {
    throw new AuthError(
      "Invalid or expired reset token",
      AuthErrorCodes.PASSWORD_RESET_INVALID,
      400,
    );
  }

  const user = await repository.findUserById(reset.user_id);
  if (!user) {
    throw new AuthError("User not found", AuthErrorCodes.USER_NOT_FOUND, 404);
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
    throw new AuthError("Password reset failed", AuthErrorCodes.USER_NOT_FOUND, 500);
  }

  await repository.markPasswordResetUsed(reset.id, ipAddress);
  await repository.invalidatePasswordResetsForUser(user.id);
  await revokeUserSessions(user.id, "Password reset");

  await logAudit({
    user_id: user.id,
    org_id: null,
    action: "user.password_changed",
    resource_type: "user",
    resource_id: user.id,
    ip_address: ipAddress,
    request_id: requestId,
    metadata: { action: "password_reset" },
  });
}

export async function changePassword(
  userId: string,
  input: ChangePasswordInput,
  mfaVerified: boolean,
  ipAddress: string,
  requestId: string,
): Promise<void> {
  const user = await repository.findUserById(userId);
  if (!user) {
    throw new AuthError("User not found", AuthErrorCodes.USER_NOT_FOUND, 404);
  }

  if (user.mfa_enabled && !mfaVerified) {
    throw new AuthError(
      "MFA verification required",
      AuthErrorCodes.MFA_REQUIRED,
      403,
    );
  }

  if (!user.password_hash) {
    throw new AuthError(
      "Password change is not available for this account",
      AuthErrorCodes.PASSWORD_REQUIRED,
      400,
    );
  }

  const currentPasswordValid = await verifyPassword(
    input.current_password,
    user.password_hash,
  );
  if (!currentPasswordValid) {
    throw new AuthError(
      "Current password is incorrect",
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
    throw new AuthError("Password update failed", AuthErrorCodes.USER_NOT_FOUND, 500);
  }

  await revokeUserSessions(user.id, "Password changed");

  await logAudit({
    user_id: user.id,
    org_id: null,
    action: "user.password_changed",
    resource_type: "user",
    resource_id: user.id,
    ip_address: ipAddress,
    request_id: requestId,
    metadata: { action: "change_password" },
  });
}

export async function verifyBackupCode(
  userId: string,
  input: BackupCodeVerificationInput,
): Promise<boolean> {
  const user = await repository.findUserById(userId);
  if (!user) {
    throw new AuthError("User not found", AuthErrorCodes.USER_NOT_FOUND, 404);
  }

  return consumeBackupCode(userId, input.code);
}

export async function getUserById(
  targetUserId: string,
  requesterId: string,
  isAdmin: boolean,
): Promise<UserProfile> {
  if (!isAdmin && targetUserId !== requesterId) {
    throw new AuthError(
      "Insufficient permissions",
      AuthErrorCodes.INSUFFICIENT_PERMISSIONS,
      403,
    );
  }

  const user = await repository.findUserById(targetUserId);
  if (!user) {
    throw new AuthError("User not found", AuthErrorCodes.USER_NOT_FOUND, 404);
  }

  return toUserProfile(user, isAdmin);
}

export async function listAllUsers(
  options: {
    status?: import("./types.js").UserStatus;
    limit?: number;
    offset?: number;
    search?: string;
  },
  isAdmin: boolean,
): Promise<{ users: UserProfile[]; total: number }> {
  if (!isAdmin) {
    throw new AuthError(
      "Admin access required",
      AuthErrorCodes.INSUFFICIENT_PERMISSIONS,
      403,
    );
  }

  const { users, total } = await repository.listUsers(options);
  return {
    users: users.map((u) => toUserProfile(u, true)),
    total,
  };
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
      "Admin access required",
      AuthErrorCodes.INSUFFICIENT_PERMISSIONS,
      403,
    );
  }

  const restored = await repository.restoreUser(targetUserId);
  if (!restored) {
    throw new AuthError(
      "User not found or not deleted",
      AuthErrorCodes.USER_NOT_FOUND,
      404,
    );
  }

  await logAudit({
    user_id: adminId,
    org_id: null,
    action: "user.updated",
    resource_type: "user",
    resource_id: targetUserId,
    ip_address: ipAddress,
    request_id: requestId,
    metadata: { action: "restore", previous_status: "deleted" },
  });

  return toUserProfile(restored, true);
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
      "Admin access required",
      AuthErrorCodes.INSUFFICIENT_PERMISSIONS,
      403,
    );
  }

  if (!reason || reason.length < 10) {
    throw new AuthError(
      "Suspension reason required (min 10 chars)",
      "INVALID_INPUT",
      400,
    );
  }

  const suspended = await repository.suspendUser(targetUserId, reason, adminId);
  if (!suspended) {
    throw new AuthError("User not found", AuthErrorCodes.USER_NOT_FOUND, 404);
  }

  // Revoke all sessions immediately
  await repository.revokeAllOtherSessions(targetUserId, "admin_suspension");

  await logAudit({
    user_id: adminId,
    org_id: null,
    action: "user.updated",
    resource_type: "user",
    resource_id: targetUserId,
    ip_address: ipAddress,
    request_id: requestId,
    metadata: { action: "suspend", reason },
  });

  return toUserProfile(suspended, true);
}

// ============================================
// MFA SERVICES
// ============================================

export async function setupMFA(
  userId: string,
  input: MFASetupInput,
  ipAddress: string,
): Promise<TOTPSetup> {
  // Rate limit
  const rateKey = `mfa_setup:${userId}`;
  const allowed = await checkRateLimit(
    rateKey,
    RATE_LIMITS.MFA_SETUP.points,
    RATE_LIMITS.MFA_SETUP.duration,
  );
  if (!allowed) {
    throw new AuthError(
      "Too many MFA setup attempts",
      AuthErrorCodes.RATE_LIMITED,
      429,
    );
  }

  const user = await repository.findUserById(userId);
  if (!user) {
    throw new AuthError("User not found", AuthErrorCodes.USER_NOT_FOUND, 404);
  }

  // Check if MFA already enabled for this type
  const existingDevices = await repository.findMFADevicesByUserId(userId);
  const hasType = existingDevices.some(
    (d) => d.device_type === input.type && d.is_active,
  );
  if (hasType) {
    throw new AuthError(
      `${input.type} MFA already enabled`,
      AuthErrorCodes.MFA_ALREADY_ENABLED,
      409,
    );
  }

  if (input.type === "totp") {
    // Generate TOTP secret
    const secret = new OTPAuth.Secret({ size: 32 });
    const totp = new OTPAuth.TOTP({
      issuer: "api-monitoring-backend",
      label: user.email,
      algorithm: "SHA256",
      digits: 6,
      period: 30,
      secret,
    });

    const secretEncrypted = encrypt(secret.base32, config.ENCRYPTION_KEY);

    // Create unverified device
    const device = await repository.createMFADevice({
      user_id: userId,
      device_type: "totp",
      device_name: input.device_name,
      secret_encrypted: secretEncrypted,
      is_primary: existingDevices.length === 0, // First device is primary
      device_metadata: { setup_ip: ipAddress },
    });

    // Generate backup codes
    const { plain: backupCodes, hashed } = await generateBackupCodes();

    // Store hashed backup codes temporarily (will be confirmed on verify)
    await redis.setex(
      `mfa_backup_temp:${device.id}`,
      600, // 10 min to complete setup
      JSON.stringify(hashed),
    );

    const qrCodeUrl = await QRCode.toDataURL(totp.toString());

    return {
      secret: secret.base32, // Show once
      qrCodeUrl,
      backupCodes, // Show once
    };
  }

  if (input.type === "sms") {
    if (!input.phone_number) {
      throw new AuthError(
        "Phone number required for SMS MFA",
        "VALIDATION_ERROR",
        400,
      );
    }
    // TODO: Implement SMS via Twilio/Authy
    throw new AuthError("SMS MFA not yet implemented", "NOT_IMPLEMENTED", 501);
  }

  if (input.type === "email") {
    // Use user's email, send code
    const device = await repository.createMFADevice({
      user_id: userId,
      device_type: "email",
      device_name: input.device_name,
      secret_encrypted: encrypt(user.email, config.ENCRYPTION_KEY),
      is_primary: existingDevices.length === 0,
      device_metadata: { email: user.email, setup_ip: ipAddress },
    });

    // TODO: Send verification email with code
    throw new AuthError(
      "Email MFA setup - verification email sent",
      "PENDING_VERIFICATION",
      202,
    );
  }

  throw new AuthError("Invalid MFA type", "VALIDATION_ERROR", 400);
}

export async function verifyMFASetup(
  userId: string,
  input: MFAVerifySetupInput,
): Promise<void> {
  const rateKey = `mfa_verify:${userId}`;
  const allowed = await checkRateLimit(
    rateKey,
    RATE_LIMITS.MFA_VERIFY.points,
    RATE_LIMITS.MFA_VERIFY.duration,
  );
  if (!allowed) {
    throw new AuthError(
      "Too many verification attempts",
      AuthErrorCodes.RATE_LIMITED,
      429,
    );
  }

  const device = await repository.findMFADeviceById(input.device_id, userId);
  if (!device || device.verified) {
    throw new AuthError(
      "Invalid or already verified device",
      AuthErrorCodes.MFA_INVALID,
      400,
    );
  }

  // Verify TOTP code
  const secret = decrypt(device.secret_encrypted!, config.ENCRYPTION_KEY);
  const totp = new OTPAuth.TOTP({
    issuer: "YourAppName",
    algorithm: "SHA256",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secret),
  });

  const delta = totp.validate({ token: input.code, window: 1 });
  if (delta === null) {
    throw new AuthError(
      "Invalid verification code",
      AuthErrorCodes.MFA_INVALID,
      400,
    );
  }

  // Get backup codes from temp storage
  const tempBackup = await redis.get(`mfa_backup_temp:${device.id}`);
  const backupCodesHash = tempBackup ? JSON.parse(tempBackup) : null;

  // Verify device and save backup codes
  await repository.verifyMFADevice(device.id, backupCodesHash);

  // Enable MFA on user if not already
  await repository.updateUserMFAEnabled(userId, true);
  await repository.updateBackupCodesGenerated(userId);

  // Cleanup
  await redis.del(`mfa_backup_temp:${device.id}`);
}

export async function createMFAChallenge(
  userId: string,
): Promise<MFAChallenge> {
  const devices = await repository.findMFADevicesByUserId(userId);
  const verifiedDevices = devices.filter((d) => d.verified && d.is_active);

  if (verifiedDevices.length === 0) {
    throw new AuthError(
      "No verified MFA devices",
      AuthErrorCodes.MFA_NOT_ENABLED,
      400,
    );
  }

  // Select primary device or first available
  const primaryCandidate =
    verifiedDevices.find((d) => d.is_primary) || verifiedDevices[0];

  if (!primaryCandidate) {
    throw new AuthError(
      "No verified MFA devices",
      AuthErrorCodes.MFA_NOT_ENABLED,
      400,
    );
  }
  const primary = primaryCandidate;

  const challengeId = generateId();
  const challenge: MFAChallenge = {
    challengeId,
    deviceId: primary.id,
    deviceType: primary.device_type,
    expiresAt: new Date(Date.now() + SESSION_CONFIG.MFA_CHALLENGE_TTL * 1000),
  };

  // Store challenge in Redis
  await redis.setex(
    `mfa_challenge:${challengeId}`,
    SESSION_CONFIG.MFA_CHALLENGE_TTL,
    JSON.stringify({
      userId,
      deviceId: primary.id,
      attempts: 0,
    }),
  );

  return challenge;
}

export async function verifyMFAChallenge(
  challengeId: string,
  input: MFAVerifyInput,
): Promise<{ userId: string; deviceId: string }> {
  const challengeData = await redis.get(`mfa_challenge:${challengeId}`);
  if (!challengeData) {
    throw new AuthError(
      "Challenge expired or invalid",
      AuthErrorCodes.MFA_INVALID,
      400,
    );
  }

  const challenge = JSON.parse(challengeData);

  // Check attempts
  if (challenge.attempts >= 3) {
    await redis.del(`mfa_challenge:${challengeId}`);
    throw new AuthError(
      "Too many failed attempts",
      AuthErrorCodes.MFA_INVALID,
      400,
    );
  }

  const device = await repository.findMFADeviceById(challenge.deviceId);
  if (!device || !device.verified || !device.is_active) {
    throw new AuthError("MFA device invalid", AuthErrorCodes.MFA_INVALID, 400);
  }

  // Verify code
  const secret = decrypt(device.secret_encrypted!, config.ENCRYPTION_KEY);
  const totp = new OTPAuth.TOTP({
    algorithm: "SHA256",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secret),
  });

  const delta = totp.validate({ token: input.code, window: 1 });
  if (delta === null) {
    // Increment attempts
    challenge.attempts++;
    await redis.setex(
      `mfa_challenge:${challengeId}`,
      SESSION_CONFIG.MFA_CHALLENGE_TTL,
      JSON.stringify(challenge),
    );
    throw new AuthError("Invalid code", AuthErrorCodes.MFA_INVALID, 400);
  }

  // Success - cleanup and return
  await redis.del(`mfa_challenge:${challengeId}`);

  // Update device last used
  await repository.withTransaction(async (client) => {
    await client.query(
      `UPDATE user_mfa_devices SET last_used_at = NOW(), last_used_ip = $2 WHERE id = $1`,
      [device.id, "ip_from_request"], // Pass IP from context
    );
  });

  return { userId: challenge.userId, deviceId: device.id };
}

export async function listMFADevices(userId: string): Promise<MFADevice[]> {
  return repository.findMFADevicesByUserId(userId, true);
}

export async function setPrimaryMFADevice(
  userId: string,
  deviceId: string,
): Promise<void> {
  const device = await repository.findMFADeviceById(deviceId, userId);
  if (!device || !device.verified || !device.is_active) {
    throw new AuthError("Invalid device", AuthErrorCodes.MFA_INVALID, 400);
  }

  await repository.updateMFADevicePrimary(userId, deviceId);
}

export async function removeMFADevice(
  userId: string,
  deviceId: string,
  mfaCode?: string,
  ipAddress?: string,
  requestId?: string,
): Promise<void> {
  const devices = await repository.findMFADevicesByUserId(userId);
  const targetDevice = devices.find((d) => d.id === deviceId);

  if (!targetDevice) {
    throw new AuthError("Device not found", AuthErrorCodes.MFA_INVALID, 404);
  }

  // If removing last device, require MFA verification
  const activeVerified = devices.filter(
    (d) => d.verified && d.is_active && d.id !== deviceId,
  );
  if (activeVerified.length === 0) {
    if (!mfaCode) {
      throw new AuthError(
        "MFA code required to remove last device",
        AuthErrorCodes.MFA_REQUIRED,
        400,
      );
    }

    // Verify the code against this device before allowing removal
    const secret = decrypt(
      targetDevice.secret_encrypted!,
      config.ENCRYPTION_KEY,
    );
    const totp = new OTPAuth.TOTP({
      algorithm: "SHA256",
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(secret),
    });

    if (totp.validate({ token: mfaCode, window: 1 }) === null) {
      throw new AuthError("Invalid MFA code", AuthErrorCodes.MFA_INVALID, 400);
    }

    // Disable MFA on user since no devices left
    await repository.updateUserMFAEnabled(userId, false);
  }

  await repository.deleteMFADevice(deviceId);

  await logAudit({
    user_id: userId,
    org_id: null,
    action: "user.mfa_disabled",
    resource_type: "user",
    resource_id: userId,
    ip_address: ipAddress || "unknown",
    request_id: requestId || "unknown",
    metadata: { device_id: deviceId, reason: "user_removed" },
  });
}

export async function generateNewBackupCodes(
  userId: string,
  mfaCode: string,
): Promise<string[]> {
  // Verify MFA first
  const devices = await repository.findMFADevicesByUserId(userId);
  const primaryCandidate = devices.find((d) => d.is_primary && d.verified);

  if (!primaryCandidate) {
    throw new AuthError(
      "No primary MFA device",
      AuthErrorCodes.MFA_NOT_ENABLED,
      400,
    );
  }
  const primary = primaryCandidate;

  const secret = decrypt(primary.secret_encrypted!, config.ENCRYPTION_KEY);
  const totp = new OTPAuth.TOTP({
    algorithm: "SHA256",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secret),
  });

  if (totp.validate({ token: mfaCode, window: 1 }) === null) {
    throw new AuthError("Invalid MFA code", AuthErrorCodes.MFA_INVALID, 400);
  }

  const { plain, hashed } = await generateBackupCodes();

  // Update all devices with new backup codes (they're user-level)
  await repository.withTransaction(async (client) => {
    for (const device of devices) {
      if (device.verified) {
        await client.query(
          `UPDATE user_mfa_devices SET backup_codes_hash = $2, updated_at = NOW() WHERE id = $1`,
          [device.id, JSON.stringify(hashed)],
        );
      }
    }
    await client.query(
      `UPDATE users SET mfa_backup_codes_generated_at = NOW() WHERE id = $1`,
      [userId],
    );
  });

  return plain; // Show once
}

export async function disableMFA(
  userId: string,
  mfaCode: string,
  ipAddress: string,
  requestId?: string,
): Promise<void> {
  const devices = await repository.findMFADevicesByUserId(userId);
  const primaryCandidate = devices.find((d) => d.is_primary && d.verified);

  if (!primaryCandidate) {
    throw new AuthError("MFA not enabled", AuthErrorCodes.MFA_NOT_ENABLED, 400);
  }
  const primary = primaryCandidate;

  // Verify code
  const secret = decrypt(primary.secret_encrypted!, config.ENCRYPTION_KEY);
  const totp = new OTPAuth.TOTP({
    algorithm: "SHA256",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secret),
  });

  if (totp.validate({ token: mfaCode, window: 1 }) === null) {
    throw new AuthError("Invalid MFA code", AuthErrorCodes.MFA_INVALID, 400);
  }

  // Disable all devices
  await repository.withTransaction(async (client) => {
    for (const device of devices) {
      await client.query(
        `UPDATE user_mfa_devices SET is_active = FALSE, disabled_at = NOW(), disabled_reason = 'User disabled MFA' WHERE id = $1`,
        [device.id],
      );
    }
    await client.query(
      `UPDATE users SET mfa_enabled = FALSE, mfa_enforced_at = NULL WHERE id = $1`,
      [userId],
    );
  });

  await logAudit({
    user_id: userId,
    org_id: null,
    action: "user.mfa_disabled",
    resource_type: "user",
    resource_id: userId,
    ip_address: ipAddress,
    request_id: requestId || "unknown",
    metadata: { reason: "user_disabled" },
  });
}

// ============================================
// SESSION SERVICES
// ============================================

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
  // Prevent revoking current session through this endpoint (use logout instead)
  if (sessionId === currentSessionId) {
    throw new AuthError(
      "Cannot revoke current session via this endpoint",
      "INVALID_OPERATION",
      400,
    );
  }

  const session = await repository.findSessionById(sessionId, userId);
  if (!session) {
    throw new AuthError(
      "Session not found",
      AuthErrorCodes.SESSION_INVALID,
      404,
    );
  }

  await repository.revokeSession(sessionId, "User revoked session");
}

export async function revokeAllOtherSessions(
  userId: string,
  currentSessionId: string,
): Promise<number> {
  return repository.revokeAllOtherSessions(userId, currentSessionId);
}

export async function refreshAccessToken(
  refreshToken: string,
  ipAddress: string,
  userAgent: string,
): Promise<{ accessToken: string; refreshToken: string; expiresAt: Date }> {
  const tokenHash = hashAuthToken(refreshToken);
  const session = await repository.findSessionByRefreshToken(tokenHash);

  if (!session) {
    throw new AuthError("Invalid session", AuthErrorCodes.SESSION_INVALID, 401);
  }

  // Check expiration
  if (new Date() > new Date(session.absolute_expires_at)) {
    await repository.revokeSession(
      session.id,
      "Absolute session expiry reached",
    );
    throw new AuthError("Session expired", AuthErrorCodes.SESSION_EXPIRED, 401);
  }

  if (new Date() > new Date(session.expires_at)) {
    // Sliding refresh window expired, but absolute hasn't - allow one refresh
    if (new Date() > new Date(session.absolute_expires_at)) {
      throw new AuthError(
        "Session expired",
        AuthErrorCodes.SESSION_EXPIRED,
        401,
      );
    }
  }

  const user = await repository.findUserById(session.user_id);
  if (!user || user.deleted_at || user.status !== "active") {
    await repository.revokeSession(session.id, "User inactive");
    throw new AuthError("User inactive", AuthErrorCodes.USER_SUSPENDED, 401);
  }

  // Generate new tokens
  const newRefreshToken = (await randomBytesAsync(32)).toString("hex");
  const newRefreshHash = hashAuthToken(newRefreshToken);
  const accessTokenJti = session.id;

  // Calculate new expiry (extend sliding window, respect absolute)
  const newExpiresAt = new Date(
    Date.now() + SESSION_CONFIG.REFRESH_TOKEN_TTL * 1000,
  );
  const finalExpiresAt =
    newExpiresAt > new Date(session.absolute_expires_at)
      ? new Date(session.absolute_expires_at)
      : newExpiresAt;

  // Update session
  await repository.withTransaction(async (client) => {
    await client.query(
      `UPDATE user_sessions 
       SET refresh_token_hash = $2, access_token_jti = $3, expires_at = $4, last_active_at = NOW()
       WHERE id = $1`,
      [session.id, newRefreshHash, accessTokenJti, finalExpiresAt],
    );
  });

  // Generate JWT access token
  const mfaVerified = Boolean(session.mfa_verified_at) || !user.mfa_enabled;

  const accessToken = generateAccessToken(
    session.user_id,
    accessTokenJti,
    mfaVerified,
  );

  return {
    accessToken,
    refreshToken: newRefreshToken,
    expiresAt: finalExpiresAt,
  };
}

export async function logout(sessionId: string): Promise<void> {
  await repository.revokeSession(sessionId, "User logout");
  await blacklistAccessToken(sessionId);
}

// ============================================
// WEBHOOK HANDLERS
// ============================================

export async function handleClerkWebhook(
  payload: unknown,
  signature: string,
  secret: string,
): Promise<void> {
  // Verify webhook signature
  const expectedSig = createHash("sha256")
    .update(JSON.stringify(payload) + secret)
    .digest("hex");
  if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig))) {
    throw new AuthError(
      "Invalid webhook signature",
      AuthErrorCodes.WEBHOOK_INVALID,
      401,
    );
  }

  // Process based on event type
  // Implementation depends on Clerk's specific webhook format
}
// Add these to the existing service.ts if not already present
