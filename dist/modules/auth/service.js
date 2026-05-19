/**
 * Auth Service - Business Logic
 * Enterprise-grade security with rate limiting, encryption, and audit logging
 *
 * Flow:
 * 1. Normalize and hash identity inputs before repository lookups.
 * 2. Enforce account state, password policy, rate limits, and MFA rules in one
 *    place so routes stay thin.
 * 3. Persist sessions with hashed refresh tokens, then issue signed access and
 *    refresh JWTs.
 * 4. Store short-lived MFA/login challenges in Redis so failed attempts and
 *    expiry do not depend on process memory.
 * 5. Emit audit logs for sensitive lifecycle actions where enabled.
 */
import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { promisify } from "util";
import * as OTPAuth from "otpauth"; // Install: npm install otpauth
import QRCode from "qrcode"; // Install: npm install qrcode
import { AuthError, AuthErrorCodes, MFAType } from "./types.js";
import bcrypt from "bcrypt";
import * as repository from "./repository.js";
import { encrypt, decrypt, hashPassword, verifyPassword, } from "../../shared/utils/encryption.js";
import { generateId, generateUUID } from "../../shared/utils/id.js";
import { env as config } from "../../config/env.js";
import { redis } from "../../config/redis.js";
import { logAudit } from "../../shared/middleware/audit-logger.js";
import { ACCESS_TOKEN_TTL_SECONDS, MFA_LOGIN_CHALLENGE_TTL_SECONDS, PASSWORD_RESET_TTL_SECONDS, REFRESH_TOKEN_TTL_SECONDS, buildPasswordHistory, generateAccessToken, generateRefreshToken, generateSecureToken, hashToken as hashAuthToken, normalizeEmail, } from "./utils.js";
import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";
import { emailVerificationTemplate, mfaStatusTemplate, passwordResetTemplate, } from "../../shared/email/templates.js";
import { emailService } from "../../shared/email/email.service.js";
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
    EMAIL_VERIFICATION: { points: 5, duration: 60 * 15 },
    PASSWORD_RESET: { points: 5, duration: 60 * 15 },
};
const EMAIL_VERIFICATION_TTL_SECONDS = 24 * 60 * 60;
const GENERIC_PASSWORD_RESET_MESSAGE = "If the email exists, a password reset link has been sent";
const GENERIC_VERIFICATION_MESSAGE = "If the account exists and is not verified, a verification email has been sent";
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
function hashToken(token) {
    return createHash("sha256").update(token).digest("hex");
}
function hashEmailFlowToken(purpose, token) {
    // The purpose is part of the hash input so a reset token cannot be replayed
    // against the email-verification route, even though both flows share one table.
    return hashAuthToken(`${purpose}:${token}`);
}
function getBaseUrl(value, fallback) {
    return (value || fallback).replace(/\/+$/, "");
}
function buildVerifyEmailUrl(token) {
    return `${getBaseUrl(config.APP_URL, "http://localhost:3000")}/auth/verify-email?token=${encodeURIComponent(token)}`;
}
function buildResetPasswordUrl(token) {
    return `${getBaseUrl(config.FRONTEND_URL, config.APP_URL)}/reset-password?token=${encodeURIComponent(token)}`;
}
function toMinutes(seconds) {
    return Math.ceil(seconds / 60);
}
async function sendVerificationEmail(user, token) {
    try {
        await emailService.send({
            to: user.email,
            ...emailVerificationTemplate({
                appName: config.APP_NAME,
                userName: user.full_name,
                actionUrl: buildVerifyEmailUrl(token),
                expiresInMinutes: toMinutes(EMAIL_VERIFICATION_TTL_SECONDS),
            }),
        });
    }
    catch (error) {
        throw new AuthError("Unable to send verification email", AuthErrorCodes.EMAIL_DELIVERY_FAILED, 503);
    }
}
async function sendPasswordResetEmail(user, token) {
    try {
        await emailService.send({
            to: user.email,
            ...passwordResetTemplate({
                appName: config.APP_NAME,
                userName: user.full_name,
                actionUrl: buildResetPasswordUrl(token),
                expiresInMinutes: toMinutes(PASSWORD_RESET_TTL_SECONDS),
            }),
        });
    }
    catch (error) {
        throw new AuthError("Unable to send password reset email", AuthErrorCodes.EMAIL_DELIVERY_FAILED, 503);
    }
}
async function sendMFAStatusEmail(user, enabled) {
    try {
        await emailService.send({
            to: user.email,
            ...mfaStatusTemplate({
                appName: config.APP_NAME,
                userName: user.full_name,
                enabled,
            }),
        });
    }
    catch (error) {
        logger.warn({ err: error, userEmail: user.email, enabled }, "Failed to send MFA status email");
    }
}
/**
 * Generate secure backup codes
 */
async function generateBackupCodes() {
    // Backup codes are shown once as plaintext and stored only as SHA-256 hashes.
    const codes = [];
    for (let i = 0; i < 10; i++) {
        const bytes = await randomBytesAsync(5);
        codes.push(bytes.toString("hex")); // 10 chars
    }
    const hashed = codes.map((code) => createHash("sha256").update(code).digest("hex"));
    return { plain: codes, hashed };
}
/**
 * Verify a backup code using constant-time comparison
 */
function verifyBackupCodeHash(plain, hashed) {
    const plainHash = createHash("sha256").update(plain).digest("hex");
    try {
        return timingSafeEqual(Buffer.from(plainHash), Buffer.from(hashed));
    }
    catch {
        return false;
    }
}
/**
 * Rate limit check using Redis
 */
async function checkRateLimit(key, limit, windowSeconds) {
    // Redis INCR + EXPIRE gives a simple fixed-window limiter that works across
    // multiple Node.js processes.
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
function getDeviceFingerprint(ip, userAgent) {
    return createHash("sha256")
        .update(`${ip}:${userAgent}`)
        .digest("hex")
        .substring(0, 32);
}
/**
 * Mask user for public response
 */
function toUserProfile(user, isAdmin = false) {
    const base = {
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
function validateUserActive(user) {
    // Central account-state guard used before exposing profile data or issuing
    // new privileged actions.
    if (user.deleted_at) {
        throw new AuthError("User account has been deleted", AuthErrorCodes.USER_DELETED, 403);
    }
    if (user.status === "suspended") {
        throw new AuthError(`Account suspended: ${user.status_reason || "Contact support"}`, AuthErrorCodes.USER_SUSPENDED, 403);
    }
    if (user.locked_until && user.locked_until > new Date()) {
        throw new AuthError(`Account locked until ${user.locked_until.toISOString()}`, AuthErrorCodes.USER_SUSPENDED, 403, { lockedUntil: user.locked_until });
    }
}
function getUserPasswordHashes(user) {
    const history = Array.isArray(user.password_history)
        ? user.password_history.filter((entry) => typeof entry === "string")
        : [];
    return [user.password_hash, ...history].filter((entry) => Boolean(entry));
}
async function ensurePasswordNotReused(user, newPassword) {
    // Compare the candidate password against the current hash and password
    // history using the normal password verifier instead of comparing raw hashes.
    const previousHashes = getUserPasswordHashes(user);
    for (const hash of previousHashes) {
        if (await verifyPassword(newPassword, hash)) {
            throw new AuthError("New password must not match a recent password", AuthErrorCodes.PASSWORD_REUSE_NOT_ALLOWED, 400);
        }
    }
}
async function blacklistAccessToken(sessionId) {
    await redis.setex(`token_revoke:${sessionId}`, ACCESS_TOKEN_TTL_SECONDS, "1");
}
async function revokeUserSessions(userId, reason) {
    // Revocation is persisted on every active session. Access-token blacklist
    // support is available separately for immediate jti/session invalidation.
    const sessions = await repository.listActiveSessionsByUser(userId);
    logger.debug({ userId, sessionCount: sessions.length }, 'Revoking user sessions');
    for (const session of sessions) {
        await repository.revokeSession(session.id, reason);
        // await blacklistAccessToken(session.id);
    }
    return sessions.length;
}
async function issueSessionForUser(options) {
    // Session creation needs the database session id before the refresh JWT can be
    // signed, so a temporary hash is inserted and then replaced by the real token
    // hash after JWT generation.
    const now = Date.now();
    const expiresAt = new Date(now + REFRESH_TOKEN_TTL_SECONDS * 1000);
    const absoluteExpiresAt = new Date(now + SESSION_CONFIG.ABSOLUTE_SESSION_TTL * 1000);
    // Create session first to get the session ID
    // Use a temporary hash, we'll update after generating the signed JWT
    const tempHash = hashAuthToken(generateSecureToken());
    const session = await repository.createSession({
        user_id: options.user.id,
        refresh_token_hash: tempHash,
        access_token_jti: null,
        device_fingerprint: getDeviceFingerprint(options.ipAddress, options.userAgent),
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
    // Generate signed JWT refresh token with session ID
    const refreshToken = generateRefreshToken(options.user.id, session.id);
    const refreshTokenHash = hashAuthToken(refreshToken);
    // Update session with the actual refresh token hash
    await repository.withTransaction(async (client) => {
        await client.query(`UPDATE user_sessions SET refresh_token_hash = $2 WHERE id = $1`, [session.id, refreshTokenHash]);
    });
    await repository.updateSessionActivity(session.id, session.id);
    return {
        accessToken: generateAccessToken(options.user.id, session.id, options.mfaVerified),
        refreshToken,
        expiresAt,
        sessionId: session.id,
    };
}
async function createLoginMFAChallenge(options) {
    // Login MFA challenges are stored in Redis with attempt counters and device
    // metadata. No access or refresh token is issued until this challenge succeeds.
    const challengeId = generateId();
    const expiresAt = new Date(Date.now() + MFA_LOGIN_CHALLENGE_TTL_SECONDS * 1000);
    await redis.setex(`auth_login_challenge:${challengeId}`, MFA_LOGIN_CHALLENGE_TTL_SECONDS, JSON.stringify({
        userId: options.user.id,
        deviceId: options.challengeDevice.id,
        deviceName: options.deviceName || options.userAgent.slice(0, 255),
        deviceType: options.challengeDevice.device_type,
        clientDeviceType: options.clientDeviceType || "web",
        ipAddress: options.ipAddress,
        userAgent: options.userAgent,
        attempts: 0,
    }));
    return {
        challengeId,
        expiresAt,
        deviceType: options.challengeDevice.device_type,
    };
}
async function consumeBackupCode(userId, code) {
    // A matching backup code is removed immediately, making backup-code use
    // one-time even under repeated login attempts.
    const devices = await repository.findMFADevicesByUserId(userId, false);
    for (const device of devices) {
        const codes = Array.isArray(device.backup_codes_hash)
            ? device.backup_codes_hash.filter((entry) => typeof entry === "string")
            : [];
        const matchIndex = codes.findIndex((hashedCode) => verifyBackupCodeHash(code, hashedCode));
        if (matchIndex >= 0) {
            codes.splice(matchIndex, 1);
            await repository.updateMFADeviceBackupCodes(device.id, codes.length > 0 ? codes : null);
            return true;
        }
    }
    return false;
}
function verifyTotpDeviceCode(device, code) {
    if (device.device_type !== "totp" || !device.secret_encrypted) {
        return false;
    }
    const secret = decrypt(device.secret_encrypted, config.ENCRYPTION_KEY);
    const totp = new OTPAuth.TOTP({
        algorithm: "SHA256",
        digits: 6,
        period: 30,
        secret: OTPAuth.Secret.fromBase32(secret),
    });
    return totp.validate({ token: code, window: 1 }) !== null;
}
// ============================================
// USER SERVICES
// ============================================
export async function createUserFromEmail(input, ipAddress, requestId) {
    // Email uniqueness is checked through a normalized hash so lookups do not need
    // plaintext email comparison.
    // Check email hash collision
    const normalizedEmail = normalizeEmail(input.email);
    const emailHash = createHash("sha256").update(normalizedEmail).digest("hex");
    const emailExists = await repository.findUserByEmailHash(emailHash);
    if (emailExists) {
        throw new AuthError("Email already registered", AuthErrorCodes.USER_EXISTS, 409);
    }
    const passwordhash = await hashPassword(input.password);
    const verificationToken = generateSecureToken();
    const verificationTokenHash = hashEmailFlowToken("email_verification", verificationToken);
    const verificationExpiresAt = new Date(Date.now() + EMAIL_VERIFICATION_TTL_SECONDS * 1000);
    const user = await repository.withTransaction(async (client) => {
        const created = await repository.createUser({
            id: generateUUID(),
            email: normalizedEmail,
            full_name: input.full_name,
            avatar_url: input.avatar_url,
            password: passwordhash,
        }, client);
        await repository.createEmailVerification({
            user_id: created.id,
            email: normalizedEmail,
            token_hash: verificationTokenHash,
            expires_at: verificationExpiresAt,
        }, client);
        return created;
    });
    await sendVerificationEmail(user, verificationToken);
    await logAudit({
        user_id: user.id,
        org_id: null,
        action: "user.created",
        resource_type: "user",
        resource_id: user.id,
        ip_address: ipAddress,
        request_id: requestId,
        metadata: { source: "email_password", email_verified: false },
    });
    return user;
}
export async function getCurrentUser(userId) {
    const user = await repository.findUserById(userId);
    if (!user) {
        throw new AuthError("User not found", AuthErrorCodes.USER_NOT_FOUND, 404);
    }
    validateUserActive(user);
    return toUserProfile(user);
}
export async function updateCurrentUser(userId, input) {
    const user = await repository.findUserById(userId);
    if (!user) {
        throw new AuthError("User not found", AuthErrorCodes.USER_NOT_FOUND, 404);
    }
    validateUserActive(user);
    const updates = {};
    if (input.full_name !== undefined)
        updates.full_name = input.full_name;
    if (input.avatar_url !== undefined)
        updates.avatar_url = input.avatar_url;
    if (input.timezone !== undefined)
        updates.timezone = input.timezone;
    if (input.locale !== undefined)
        updates.locale = input.locale;
    if (input.preferred_mfa_method !== undefined) {
        updates.preferred_mfa_method = input.preferred_mfa_method;
    }
    const updated = await repository.updateUser(userId, updates);
    if (!updated) {
        throw new AuthError("Update failed", AuthErrorCodes.USER_NOT_FOUND, 500);
    }
    return toUserProfile(updated);
}
export async function deleteCurrentUser(userId, input, ipAddress, requestId) {
    const user = await repository.findUserById(userId);
    if (!user) {
        throw new AuthError("User not found", AuthErrorCodes.USER_NOT_FOUND, 404);
    }
    // If user has password (non-SSO), verify it
    if (user.password_hash) {
        if (!input.password) {
            throw new AuthError("Password required", AuthErrorCodes.PASSWORD_REQUIRED, 400);
        }
        const rateKey = `pwd_check:${userId}`;
        const allowed = await checkRateLimit(rateKey, RATE_LIMITS.PASSWORD_CHECK.points, RATE_LIMITS.PASSWORD_CHECK.duration);
        if (!allowed) {
            throw new AuthError("Too many attempts", AuthErrorCodes.RATE_LIMITED, 429);
        }
        const valid = await verifyPassword(input.password, user.password_hash);
        if (!valid) {
            throw new AuthError("Password incorrect", AuthErrorCodes.PASSWORD_INCORRECT, 401);
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
export async function loginWithEmailPassword(input, ipAddress, userAgent, clientDeviceType, requestId) {
    // Login flow: normalize email -> find user -> validate account state ->
    // verify password -> either create MFA challenge or issue a full session.
    const normalizedEmail = normalizeEmail(input.email);
    const emailHash = createHash("sha256").update(normalizedEmail).digest("hex");
    // const rateKey = `login:${emailHash}:${ipAddress}`;
    // const allowed = await checkRateLimit(
    //   rateKey,
    //   RATE_LIMITS.LOGIN.points,
    //   RATE_LIMITS.LOGIN.duration,
    // );
    // if (!allowed) {
    //   throw new AuthError(
    //     "Too many login attempts",
    //     AuthErrorCodes.RATE_LIMITED,
    //     429,
    //   );
    // }
    const start = Date.now();
    const user = await repository.findUserByEmailHash(emailHash);
    if (!user || user.status === "deleted") {
        throw new AuthError("Invalid email or password", AuthErrorCodes.INVALID_CREDENTIALS, 401);
    }
    if (!user.email_verified) {
        throw new AuthError("Email not verified", AuthErrorCodes.EMAIL_NOT_VERIFIED, 403, {
            action: "VERIFY_EMAIL",
            resend_allowed: true,
        });
    }
    if (user.status === "suspended") {
        throw new AuthError(`Account suspended: ${user.status_reason || "Contact support"}`, AuthErrorCodes.USER_SUSPENDED, 403);
    }
    if (user.locked_until && user.locked_until > new Date()) {
        throw new AuthError(`Account locked until ${user.locked_until.toISOString()}`, AuthErrorCodes.USER_SUSPENDED, 423, { lockedUntil: user.locked_until });
    }
    if (!user.password_hash) {
        throw new AuthError("Password login is not enabled for this account", AuthErrorCodes.PASSWORD_REQUIRED, 400);
    }
    const passStart = Date.now();
    const passwordValid = await verifyPassword(input.password, user.password_hash);
    if (!passwordValid) {
        await repository.updateLoginAttempts(user.id, user.login_attempts + 1);
        throw new AuthError("Invalid email or password", AuthErrorCodes.INVALID_CREDENTIALS, 401);
    }
    if (user.mfa_enabled) {
        const devices = await repository.findMFADevicesByUserId(user.id);
        const verifiedDevices = devices.filter((device) => device.verified && device.is_active);
        if (verifiedDevices.length === 0) {
            throw new AuthError("MFA setup is incomplete for this account", AuthErrorCodes.MFA_NOT_ENABLED, 400);
        }
        const primaryDevice = verifiedDevices.find((device) => device.is_primary) || verifiedDevices[0];
        if (!primaryDevice) {
            throw new AuthError("MFA setup is incomplete for this account", AuthErrorCodes.MFA_NOT_ENABLED, 400);
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
    // await logAudit({
    //   user_id: user.id,
    //   org_id: null,
    //   action: "user.login",
    //   resource_type: "user",
    //   resource_id: user.id,
    //   ip_address: ipAddress,
    //   user_agent: userAgent,
    //   request_id: requestId,
    //   metadata: { session_id: session.sessionId, mfa_required: false },
    // });
    return {
        mfa_required: false,
        access_token: session.accessToken,
        refresh_token: session.refreshToken,
        expires_at: session.expiresAt,
        token_type: "Bearer",
        session_id: session.sessionId,
    };
}
export async function verifyLoginMFAChallenge(input, ipAddress, userAgent, clientDeviceType, requestId) {
    // MFA login completion consumes the Redis challenge, validates the selected
    // device or backup code, and only then creates the user session.
    const rawChallenge = await redis.get(`auth_login_challenge:${input.challenge_id}`);
    if (!rawChallenge) {
        throw new AuthError("Challenge expired or invalid", AuthErrorCodes.MFA_CHALLENGE_EXPIRED, 400);
    }
    const challenge = JSON.parse(rawChallenge);
    if (challenge.attempts >= 3) {
        await redis.del(`auth_login_challenge:${input.challenge_id}`);
        throw new AuthError("Too many failed attempts", AuthErrorCodes.MFA_INVALID, 400);
    }
    const user = await repository.findUserById(challenge.userId);
    if (!user) {
        await redis.del(`auth_login_challenge:${input.challenge_id}`);
        throw new AuthError("User not found", AuthErrorCodes.USER_NOT_FOUND, 404);
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
        await redis.setex(`auth_login_challenge:${input.challenge_id}`, MFA_LOGIN_CHALLENGE_TTL_SECONDS, JSON.stringify(challenge));
        throw new AuthError("Invalid MFA code", AuthErrorCodes.MFA_INVALID, 400);
    }
    await redis.del(`auth_login_challenge:${input.challenge_id}`);
    await repository.withTransaction(async (client) => {
        await client.query(`UPDATE user_mfa_devices
       SET last_used_at = NOW(), last_used_ip = $2, updated_at = NOW()
       WHERE id = $1`, [device.id, ipAddress]);
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
export async function resendVerification(input, ipAddress, requestId) {
    const normalizedEmail = normalizeEmail(input.email);
    const emailHash = createHash("sha256").update(normalizedEmail).digest("hex");
    const rateAllowed = await checkRateLimit(`email_verification:${emailHash}:${ipAddress}`, RATE_LIMITS.EMAIL_VERIFICATION.points, RATE_LIMITS.EMAIL_VERIFICATION.duration);
    if (!rateAllowed) {
        throw new AuthError("Too many verification email requests", AuthErrorCodes.RATE_LIMITED, 429);
    }
    const user = await repository.findUserByEmail(normalizedEmail);
    if (!user || user.deleted_at || user.status !== "active" || user.email_verified) {
        return { message: GENERIC_VERIFICATION_MESSAGE };
    }
    const verificationToken = generateSecureToken();
    await repository.createEmailVerification({
        user_id: user.id,
        email: normalizedEmail,
        token_hash: hashEmailFlowToken("email_verification", verificationToken),
        expires_at: new Date(Date.now() + EMAIL_VERIFICATION_TTL_SECONDS * 1000),
    });
    await sendVerificationEmail(user, verificationToken);
    await logAudit({
        user_id: user.id,
        org_id: null,
        action: "user.updated",
        resource_type: "user",
        resource_id: user.id,
        ip_address: ipAddress,
        request_id: requestId,
        metadata: { action: "email_verification_resent" },
    });
    return { message: GENERIC_VERIFICATION_MESSAGE };
}
export async function verifyEmail(input, ipAddress, requestId) {
    const tokenHash = hashEmailFlowToken("email_verification", input.token);
    let verifiedUserId = null;
    await repository.withTransaction(async (client) => {
        const verification = await repository.consumeEmailVerificationToken(tokenHash, client);
        if (!verification) {
            const existing = await repository.findEmailVerificationByTokenHash(tokenHash, client);
            if (existing?.verified_at) {
                const user = await repository.findUserById(existing.user_id, client);
                if (user?.email_verified) {
                    verifiedUserId = user.id;
                    return;
                }
            }
            throw new AuthError("Invalid or expired verification token", AuthErrorCodes.EMAIL_VERIFICATION_INVALID, 400);
        }
        const user = await repository.findUserById(verification.user_id, client);
        if (!user || user.deleted_at || normalizeEmail(user.email) !== normalizeEmail(verification.email)) {
            throw new AuthError("Invalid or expired verification token", AuthErrorCodes.EMAIL_VERIFICATION_INVALID, 400);
        }
        if (!user.email_verified) {
            await repository.markEmailAsVerified(user.id, client);
        }
        verifiedUserId = user.id;
    });
    if (verifiedUserId) {
        await logAudit({
            user_id: verifiedUserId,
            org_id: null,
            action: "user.updated",
            resource_type: "user",
            resource_id: verifiedUserId,
            ip_address: ipAddress,
            request_id: requestId,
            metadata: { action: "email_verified" },
        });
    }
    return { message: "Email verified successfully" };
}
export async function requestPasswordReset(input, ipAddress, requestId) {
    const normalizedEmail = normalizeEmail(input.email);
    const emailHash = createHash("sha256").update(normalizedEmail).digest("hex");
    const rateAllowed = await checkRateLimit(`password_reset:${emailHash}:${ipAddress}`, RATE_LIMITS.PASSWORD_RESET.points, RATE_LIMITS.PASSWORD_RESET.duration);
    if (!rateAllowed) {
        throw new AuthError("Too many password reset requests", AuthErrorCodes.RATE_LIMITED, 429);
    }
    const user = await repository.findUserByEmail(normalizedEmail);
    if (!user || user.deleted_at || user.status !== "active") {
        return { message: GENERIC_PASSWORD_RESET_MESSAGE };
    }
    const resetToken = generateSecureToken();
    const resetTokenHash = hashEmailFlowToken("password_reset", resetToken);
    const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_SECONDS * 1000);
    await repository.createEmailVerification({
        user_id: user.id,
        email: normalizedEmail,
        token_hash: resetTokenHash,
        expires_at: expiresAt,
    });
    await sendPasswordResetEmail(user, resetToken);
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
    return { message: GENERIC_PASSWORD_RESET_MESSAGE };
}
export async function resetPasswordWithToken(input, ipAddress, requestId) {
    const tokenHash = hashEmailFlowToken("password_reset", input.token);
    let resetUserId = null;
    await repository.withTransaction(async (client) => {
        const reset = await repository.consumeEmailVerificationToken(tokenHash, client);
        if (!reset) {
            throw new AuthError("Invalid or expired reset token", AuthErrorCodes.PASSWORD_RESET_INVALID, 400);
        }
        const user = await repository.findUserById(reset.user_id, client);
        if (!user || user.deleted_at || user.status !== "active") {
            throw new AuthError("Invalid or expired reset token", AuthErrorCodes.PASSWORD_RESET_INVALID, 400);
        }
        if (normalizeEmail(user.email) !== normalizeEmail(reset.email)) {
            throw new AuthError("Invalid or expired reset token", AuthErrorCodes.PASSWORD_RESET_INVALID, 400);
        }
        await ensurePasswordNotReused(user, input.new_password);
        const passwordHash = await hashPassword(input.new_password);
        const passwordHistory = buildPasswordHistory(user.password_history, user.password_hash);
        const updated = await repository.updateUserPassword(user.id, passwordHash, passwordHistory, client);
        if (!updated) {
            throw new AuthError("Password reset failed", AuthErrorCodes.USER_NOT_FOUND, 500);
        }
        resetUserId = user.id;
    });
    if (!resetUserId) {
        throw new AuthError("Password reset failed", AuthErrorCodes.PASSWORD_RESET_INVALID, 400);
    }
    await revokeUserSessions(resetUserId, "Password reset");
    // await logAudit({
    //   user_id: resetUserId,
    //   org_id: null,
    //   action: "user.password_changed",
    //   resource_type: "user",
    //   resource_id: resetUserId,
    //   ip_address: ipAddress,
    //   request_id: requestId,
    //   metadata: { action: "password_reset" },
    // });
}
export async function changePassword(userId, input, mfaVerified, ipAddress, requestId) {
    const user = await repository.findUserById(userId);
    if (!user) {
        throw new AuthError("User not found", AuthErrorCodes.USER_NOT_FOUND, 404);
    }
    if (user.mfa_enabled && !mfaVerified) {
        throw new AuthError("MFA verification required", AuthErrorCodes.MFA_REQUIRED, 403);
    }
    if (!user.password_hash) {
        throw new AuthError("Password change is not available for this account", AuthErrorCodes.PASSWORD_REQUIRED, 400);
    }
    const currentPasswordValid = await verifyPassword(input.current_password, user.password_hash);
    if (!currentPasswordValid) {
        throw new AuthError("Current password is incorrect", AuthErrorCodes.PASSWORD_INCORRECT, 401);
    }
    await ensurePasswordNotReused(user, input.new_password);
    const passwordHash = await hashPassword(input.new_password);
    const passwordHistory = buildPasswordHistory(user.password_history, user.password_hash);
    const updated = await repository.updateUserPassword(user.id, passwordHash, passwordHistory);
    if (!updated) {
        throw new AuthError("Password update failed", AuthErrorCodes.USER_NOT_FOUND, 500);
    }
    await revokeUserSessions(user.id, "Password changed");
    // await logAudit({
    //   user_id: user.id,
    //   org_id: null,
    //   action: "user.password_changed",
    //   resource_type: "user",
    //   resource_id: user.id,
    //   ip_address: ipAddress,
    //   request_id: requestId,
    //   metadata: { action: "change_password" },
    // });
}
export async function verifyBackupCode(userId, input) {
    const user = await repository.findUserById(userId);
    if (!user) {
        throw new AuthError("User not found", AuthErrorCodes.USER_NOT_FOUND, 404);
    }
    return consumeBackupCode(userId, input.code);
}
export async function getUserById(targetUserId, requesterId, isAdmin) {
    if (!isAdmin && targetUserId !== requesterId) {
        throw new AuthError("Insufficient permissions", AuthErrorCodes.INSUFFICIENT_PERMISSIONS, 403);
    }
    const user = await repository.findUserById(targetUserId);
    if (!user) {
        throw new AuthError("User not found", AuthErrorCodes.USER_NOT_FOUND, 404);
    }
    return toUserProfile(user, isAdmin);
}
export async function listAllUsers(options, isAdmin) {
    if (!isAdmin) {
        throw new AuthError("Admin access required", AuthErrorCodes.INSUFFICIENT_PERMISSIONS, 403);
    }
    const { users, total } = await repository.listUsers(options);
    return {
        users: users.map((u) => toUserProfile(u, true)),
        total,
    };
}
export async function restoreDeletedUser(targetUserId, adminId, isAdmin, ipAddress, requestId) {
    if (!isAdmin) {
        throw new AuthError("Admin access required", AuthErrorCodes.INSUFFICIENT_PERMISSIONS, 403);
    }
    const restored = await repository.restoreUser(targetUserId);
    if (!restored) {
        throw new AuthError("User not found or not deleted", AuthErrorCodes.USER_NOT_FOUND, 404);
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
export async function suspendUser(targetUserId, reason, adminId, isAdmin, ipAddress, requestId) {
    if (!isAdmin) {
        throw new AuthError("Admin access required", AuthErrorCodes.INSUFFICIENT_PERMISSIONS, 403);
    }
    if (!reason || reason.length < 10) {
        throw new AuthError("Suspension reason required (min 10 chars)", "INVALID_INPUT", 400);
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
export async function setupMFA(userId, input, ipAddress) {
    // Setup creates an unverified MFA device first. The device becomes active only
    // after verifyMFASetup proves the user can generate a valid TOTP code.
    // Rate limit
    // const rateKey = `mfa_setup:${userId}`;
    // const allowed = await checkRateLimit(
    //   rateKey,
    //   RATE_LIMITS.MFA_SETUP.points,
    //   RATE_LIMITS.MFA_SETUP.duration,
    // );
    // if (!allowed) {
    //   throw new AuthError(
    //     "Too many MFA setup attempts",
    //     AuthErrorCodes.RATE_LIMITED,
    //     429,
    //   );
    // }
    const user = await repository.findUserById(userId);
    if (!user) {
        throw new AuthError("User not found", AuthErrorCodes.USER_NOT_FOUND, 404);
    }
    // Check if MFA already enabled for this type
    const existingDevices = await repository.findMFADevicesByUserId(userId);
    const hasType = existingDevices.some((d) => d.device_type === input.type && d.is_active);
    if (hasType) {
        throw new AuthError(`${input.type} MFA already enabled`, AuthErrorCodes.MFA_ALREADY_ENABLED, 409);
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
        await redis.setex(`mfa_backup_temp:${device.id}`, 600, // 10 min to complete setup
        JSON.stringify(hashed));
        const qrCodeUrl = await QRCode.toDataURL(totp.toString());
        return {
            secret: secret.base32, // Show once
            qrCodeUrl,
            backupCodes, // Show once
        };
    }
    if (input.type === "sms") {
        if (!input.phone_number) {
            throw new AuthError("Phone number required for SMS MFA", "VALIDATION_ERROR", 400);
        }
        // TODO: Implement SMS via Twilio/Authy
        throw new AuthError("SMS MFA not yet implemented", "NOT_IMPLEMENTED", 501);
    }
    if (input.type === "email") {
        throw new AuthError("Email MFA is not implemented yet. Use TOTP MFA.", "NOT_IMPLEMENTED", 501);
    }
    throw new AuthError("Invalid MFA type", "VALIDATION_ERROR", 400);
}
export async function verifyMFASetup(userId, input) {
    // Verification promotes the device, stores backup-code hashes, enables MFA on
    // the user, and clears temporary Redis setup state.
    const rateKey = `mfa_verify:${userId}`;
    const allowed = await checkRateLimit(rateKey, RATE_LIMITS.MFA_VERIFY.points, RATE_LIMITS.MFA_VERIFY.duration);
    if (!allowed) {
        throw new AuthError("Too many verification attempts", AuthErrorCodes.RATE_LIMITED, 429);
    }
    const device = await repository.findMFADeviceById(input.device_id, userId);
    if (!device || device.verified) {
        throw new AuthError("Invalid or already verified device", AuthErrorCodes.MFA_INVALID, 400);
    }
    // Verify TOTP code
    const secret = decrypt(device.secret_encrypted, config.ENCRYPTION_KEY);
    const totp = new OTPAuth.TOTP({
        issuer: "YourAppName",
        algorithm: "SHA256",
        digits: 6,
        period: 30,
        secret: OTPAuth.Secret.fromBase32(secret),
    });
    const delta = totp.validate({ token: input.code, window: 1 });
    if (delta === null) {
        throw new AuthError("Invalid verification code", AuthErrorCodes.MFA_INVALID, 400);
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
    const user = await repository.findUserById(userId);
    if (user) {
        await sendMFAStatusEmail(user, true);
    }
}
export async function createMFAChallenge(userId) {
    const devices = await repository.findMFADevicesByUserId(userId);
    const verifiedDevices = devices.filter((d) => d.verified && d.is_active);
    if (verifiedDevices.length === 0) {
        throw new AuthError("No verified MFA devices", AuthErrorCodes.MFA_NOT_ENABLED, 400);
    }
    // Select primary device or first available
    const primaryCandidate = verifiedDevices.find((d) => d.is_primary) || verifiedDevices[0];
    if (!primaryCandidate) {
        throw new AuthError("No verified MFA devices", AuthErrorCodes.MFA_NOT_ENABLED, 400);
    }
    const primary = primaryCandidate;
    const challengeId = generateId();
    const challenge = {
        challengeId,
        deviceId: primary.id,
        deviceType: primary.device_type,
        expiresAt: new Date(Date.now() + SESSION_CONFIG.MFA_CHALLENGE_TTL * 1000),
    };
    // Store challenge in Redis
    await redis.setex(`mfa_challenge:${challengeId}`, SESSION_CONFIG.MFA_CHALLENGE_TTL, JSON.stringify({
        userId,
        deviceId: primary.id,
        attempts: 0,
    }));
    return challenge;
}
export async function verifyMFAChallenge(challengeId, input) {
    const challengeData = await redis.get(`mfa_challenge:${challengeId}`);
    if (!challengeData) {
        throw new AuthError("Challenge expired or invalid", AuthErrorCodes.MFA_INVALID, 400);
    }
    const challenge = JSON.parse(challengeData);
    // Check attempts
    if (challenge.attempts >= 3) {
        await redis.del(`mfa_challenge:${challengeId}`);
        throw new AuthError("Too many failed attempts", AuthErrorCodes.MFA_INVALID, 400);
    }
    const device = await repository.findMFADeviceById(challenge.deviceId);
    if (!device || !device.verified || !device.is_active) {
        throw new AuthError("MFA device invalid", AuthErrorCodes.MFA_INVALID, 400);
    }
    // Verify code
    const secret = decrypt(device.secret_encrypted, config.ENCRYPTION_KEY);
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
        await redis.setex(`mfa_challenge:${challengeId}`, SESSION_CONFIG.MFA_CHALLENGE_TTL, JSON.stringify(challenge));
        throw new AuthError("Invalid code", AuthErrorCodes.MFA_INVALID, 400);
    }
    // Success - cleanup and return
    await redis.del(`mfa_challenge:${challengeId}`);
    // Update device last used
    await repository.withTransaction(async (client) => {
        await client.query(`UPDATE user_mfa_devices SET last_used_at = NOW(), last_used_ip = $2 WHERE id = $1`, [device.id, "ip_from_request"]);
    });
    return { userId: challenge.userId, deviceId: device.id };
}
export async function listMFADevices(userId) {
    return repository.findMFADevicesByUserId(userId, true);
}
export async function setPrimaryMFADevice(userId, deviceId) {
    const device = await repository.findMFADeviceById(deviceId, userId);
    if (!device || !device.verified || !device.is_active) {
        throw new AuthError("Invalid device", AuthErrorCodes.MFA_INVALID, 400);
    }
    await repository.updateMFADevicePrimary(userId, deviceId);
}
export async function removeMFADevice(userId, deviceId, mfaCode, ipAddress, requestId) {
    const devices = await repository.findMFADevicesByUserId(userId);
    const targetDevice = devices.find((d) => d.id === deviceId);
    if (!targetDevice) {
        throw new AuthError("Device not found", AuthErrorCodes.MFA_INVALID, 404);
    }
    // If removing last device, require MFA verification
    const activeVerified = devices.filter((d) => d.verified && d.is_active && d.id !== deviceId);
    if (activeVerified.length === 0) {
        if (!mfaCode) {
            throw new AuthError("MFA code required to remove last device", AuthErrorCodes.MFA_REQUIRED, 400);
        }
        // Verify the code against this device before allowing removal
        const secret = decrypt(targetDevice.secret_encrypted, config.ENCRYPTION_KEY);
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
export async function generateNewBackupCodes(userId, mfaCode) {
    // Verify MFA first
    const devices = await repository.findMFADevicesByUserId(userId);
    const primaryCandidate = devices.find((d) => d.is_primary && d.verified);
    if (!primaryCandidate) {
        throw new AuthError("No primary MFA device", AuthErrorCodes.MFA_NOT_ENABLED, 400);
    }
    const primary = primaryCandidate;
    const secret = decrypt(primary.secret_encrypted, config.ENCRYPTION_KEY);
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
                await client.query(`UPDATE user_mfa_devices SET backup_codes_hash = $2, updated_at = NOW() WHERE id = $1`, [device.id, JSON.stringify(hashed)]);
            }
        }
        await client.query(`UPDATE users SET mfa_backup_codes_generated_at = NOW() WHERE id = $1`, [userId]);
    });
    return plain; // Show once
}
export async function toggleMFA(userId, input, ipAddress, requestId) {
    const user = await repository.findUserById(userId);
    if (!user) {
        throw new AuthError("User not found", AuthErrorCodes.USER_NOT_FOUND, 404);
    }
    validateUserActive(user);
    if (input.enabled && user.mfa_enabled) {
        return { enabled: true };
    }
    if (!input.enabled && !user.mfa_enabled) {
        return { enabled: false };
    }
    if (!input.mfa_code) {
        throw new AuthError("MFA code is required", AuthErrorCodes.MFA_REQUIRED, 400);
    }
    if (!input.enabled) {
        await disableMFA(userId, input.mfa_code, ipAddress, requestId);
        return { enabled: false };
    }
    const devices = await repository.findMFADevicesByUserId(userId);
    const primaryCandidate = devices.find((d) => d.is_primary && d.verified && d.is_active) ||
        devices.find((d) => d.verified && d.is_active);
    if (!primaryCandidate) {
        throw new AuthError("Verified MFA device required before enabling MFA", AuthErrorCodes.MFA_NOT_ENABLED, 400);
    }
    if (!verifyTotpDeviceCode(primaryCandidate, input.mfa_code)) {
        throw new AuthError("Invalid MFA code", AuthErrorCodes.MFA_INVALID, 400);
    }
    await repository.updateUserMFAEnabled(userId, true);
    await logAudit({
        user_id: userId,
        org_id: null,
        action: "user.mfa_enabled",
        resource_type: "user",
        resource_id: userId,
        ip_address: ipAddress,
        request_id: requestId || "unknown",
        metadata: { reason: "user_toggled" },
    });
    await sendMFAStatusEmail(user, true);
    return { enabled: true };
}
export async function disableMFA(userId, mfaCode, ipAddress, requestId) {
    const user = await repository.findUserById(userId);
    if (!user) {
        throw new AuthError("User not found", AuthErrorCodes.USER_NOT_FOUND, 404);
    }
    const devices = await repository.findMFADevicesByUserId(userId);
    const primaryCandidate = devices.find((d) => d.is_primary && d.verified);
    if (!primaryCandidate) {
        throw new AuthError("MFA not enabled", AuthErrorCodes.MFA_NOT_ENABLED, 400);
    }
    const primary = primaryCandidate;
    if (!verifyTotpDeviceCode(primary, mfaCode)) {
        throw new AuthError("Invalid MFA code", AuthErrorCodes.MFA_INVALID, 400);
    }
    // Disable all devices
    await repository.withTransaction(async (client) => {
        for (const device of devices) {
            await client.query(`UPDATE user_mfa_devices SET is_active = FALSE, disabled_at = NOW(), disabled_reason = 'User disabled MFA' WHERE id = $1`, [device.id]);
        }
        await client.query(`UPDATE users SET mfa_enabled = FALSE, mfa_enforced_at = NULL WHERE id = $1`, [userId]);
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
    await sendMFAStatusEmail(user, false);
}
// ============================================
// SESSION SERVICES
// ============================================
export async function listUserSessions(userId, currentSessionId) {
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
export async function revokeSession(userId, sessionId, currentSessionId) {
    // Prevent revoking current session through this endpoint (use logout instead)
    if (sessionId === currentSessionId) {
        throw new AuthError("Cannot revoke current session via this endpoint", "INVALID_OPERATION", 400);
    }
    const session = await repository.findSessionById(sessionId, userId);
    if (!session) {
        throw new AuthError("Session not found", AuthErrorCodes.SESSION_INVALID, 404);
    }
    await repository.revokeSession(sessionId, "User revoked session");
}
export async function revokeAllOtherSessions(userId, currentSessionId) {
    return repository.revokeAllOtherSessions(userId, currentSessionId);
}
export async function refreshAccessToken(refreshToken, ipAddress, userAgent) {
    // Refresh uses token rotation: verify JWT claims, match the stored token hash,
    // enforce absolute expiry, then replace the refresh hash and issue new tokens.
    // 1. Verify the refresh token JWT signature with JWT_REFRESH_SECRET
    let decoded;
    try {
        const jwt = (await import("jsonwebtoken")).default;
        decoded = jwt.verify(refreshToken, env.JWT_REFRESH_SECRET, {
            algorithms: ["HS256"],
        });
    }
    catch {
        throw new AuthError("Invalid refresh token", AuthErrorCodes.SESSION_INVALID, 401);
    }
    if (decoded.type !== "refresh") {
        throw new AuthError("Invalid token type", AuthErrorCodes.SESSION_INVALID, 401);
    }
    // 2. Look up session by refresh token hash
    const tokenHash = hashAuthToken(refreshToken);
    const session = await repository.findSessionByRefreshToken(tokenHash);
    if (!session) {
        throw new AuthError("Invalid session", AuthErrorCodes.SESSION_INVALID, 401);
    }
    // Ensure the JWT claims match the session
    if (session.user_id !== decoded.sub || session.id !== decoded.jti) {
        throw new AuthError("Token-session mismatch", AuthErrorCodes.SESSION_INVALID, 401);
    }
    // Check expiration
    if (new Date() > new Date(session.absolute_expires_at)) {
        await repository.revokeSession(session.id, "Absolute session expiry reached");
        throw new AuthError("Session expired", AuthErrorCodes.SESSION_EXPIRED, 401);
    }
    if (new Date() > new Date(session.expires_at)) {
        if (new Date() > new Date(session.absolute_expires_at)) {
            throw new AuthError("Session expired", AuthErrorCodes.SESSION_EXPIRED, 401);
        }
    }
    const user = await repository.findUserById(session.user_id);
    if (!user || user.deleted_at || user.status !== "active") {
        await repository.revokeSession(session.id, "User inactive");
        throw new AuthError("User inactive", AuthErrorCodes.USER_SUSPENDED, 401);
    }
    // Generate new signed JWT refresh token (token rotation)
    const newRefreshToken = generateRefreshToken(session.user_id, session.id);
    const newRefreshHash = hashAuthToken(newRefreshToken);
    const accessTokenJti = session.id;
    // Calculate new expiry (extend sliding window, respect absolute)
    const newExpiresAt = new Date(Date.now() + SESSION_CONFIG.REFRESH_TOKEN_TTL * 1000);
    const finalExpiresAt = newExpiresAt > new Date(session.absolute_expires_at)
        ? new Date(session.absolute_expires_at)
        : newExpiresAt;
    // Update session with new refresh token hash
    await repository.withTransaction(async (client) => {
        await client.query(`UPDATE user_sessions 
       SET refresh_token_hash = $2, access_token_jti = $3, expires_at = $4, last_active_at = NOW()
       WHERE id = $1`, [session.id, newRefreshHash, accessTokenJti, finalExpiresAt]);
    });
    // Generate JWT access token
    const mfaVerified = Boolean(session.mfa_verified_at) || !user.mfa_enabled;
    const accessToken = generateAccessToken(session.user_id, accessTokenJti, mfaVerified);
    return {
        accessToken,
        refreshToken: newRefreshToken,
        expiresAt: finalExpiresAt,
    };
}
export async function logout(sessionId) {
    await repository.revokeSession(sessionId, "User logout");
    await blacklistAccessToken(sessionId);
}
//# sourceMappingURL=service.js.map