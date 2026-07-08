import { createLoginMFAChallenge } from './session.service.js';
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
import { emailVerificationTemplate, mfaCodeTemplate, mfaDisableConfirmTemplate, mfaStatusTemplate, passwordResetTemplate, } from '../../../../shared/email/templates.js';
import { logAudit } from '../../../../shared/middleware/audit-logger.js';
import { buildSessionDeviceLabel } from '../../../../shared/utils/request.js';
import { decrypt, encrypt, hashPassword, verifyPassword, } from '../../../../shared/utils/encryption.js';
import { generateId } from '../../../../shared/utils/id.js';
import { blacklistAccessToken, loginMfaChallengeCache, mfaBackupTempCache, recordStepUpFreshness, revokeAllUserTokens as cacheRevokeAllUserTokens, stepUpChallengeCache, } from '../../infrastructure/cache/auth.cache.js';
import { assertLoginAllowedByOrgPolicy, assertRefreshAllowedByOrgPolicy, assertMfaEnrollmentAllowed, } from '../../domain/policies.js';
import * as repository from '../../infrastructure/repositories/index.js';
import { AuthError, AuthErrorCodes, } from '../../domain/types.js';
import { ABSOLUTE_SESSION_TTL_SECONDS, ACCESS_TOKEN_TTL_SECONDS, buildPasswordHistory, EMAIL_VERIFICATION_TTL_SECONDS, MFA_DISABLE_TOKEN_TTL_SECONDS, MFA_LOGIN_CHALLENGE_TTL_SECONDS, normalizeEmail, PASSWORD_RESET_TTL_SECONDS, REFRESH_GRACE_WINDOW_MS, REFRESH_TOKEN_TTL_SECONDS, REMEMBER_ME_REFRESH_TTL_SECONDS, STEP_UP_CHALLENGE_TTL_SECONDS } from '../../domain/constants.js';
import { buildDeviceFingerprint, generateEmailFlowToken, hashEmailFlowToken, hashToken as hashAuthToken, timingSafeFakePasswordCompare } from '../../infrastructure/crypto/hash.js';
import { generateAccessToken, generateRefreshToken, verifyRefreshToken } from '../../infrastructure/crypto/jwt.js';
import { issueSessionForUser, logout } from './session.service.js';
import { sendVerificationEmail, generateEmailMfaOtp, hashEmailMfaOtp, createEmailMfaOtp, consumeEmailMfaOtp, sendEmailMfaOtpEmail } from './email.service.js';
import { emailToHash, buildMfaDisplayHint, verifyTotpDeviceCode, consumeBackupCode } from './shared-helpers.js';
// ============================================================================
// LOGIN
// ============================================================================
export async function loginWithEmailPassword(input, ipAddress, userAgent, clientDeviceType, requestId) {
    const normalizedEmail = normalizeEmail(input.email);
    const emailHash = emailToHash(normalizedEmail);
    const user = await repository.findUserByEmailHash(emailHash);
    // Defeat enumeration: equalize timing for missing user / no password / deleted.
    if (!user) {
        await timingSafeFakePasswordCompare(input.password);
        throw new AuthError('Invalid email or password', AuthErrorCodes.INVALID_CREDENTIALS, 401);
    }
    if (user.deleted_at || user.status === 'deleted' || !user.password_hash) {
        await timingSafeFakePasswordCompare(input.password);
        throw new AuthError('Invalid email or password', AuthErrorCodes.INVALID_CREDENTIALS, 401);
    }
    if (user.status === 'suspended') {
        throw new AuthError('Account suspended. Contact support.', AuthErrorCodes.USER_SUSPENDED, 403);
    }
    if (user.locked_until && user.locked_until > new Date()) {
        // BUG-008 FIX: equalize timing and use generic message so attackers
        // cannot distinguish between "account locked" and "wrong password".
        await timingSafeFakePasswordCompare(input.password);
        throw new AuthError('Invalid email or password', AuthErrorCodes.INVALID_CREDENTIALS, 401);
    }
    const passwordValid = await verifyPassword(input.password, user.password_hash);
    if (!passwordValid) {
        const result = await repository.recordFailedLogin(user.id, ipAddress);
        if (result.locked_until) {
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
        throw new AuthError('Invalid email or password', AuthErrorCodes.INVALID_CREDENTIALS, 401);
    }
    // BUG-007 FIX: Re-check account lock status AFTER password verification
    // to prevent TOCTOU where a concurrent failed attempt locks the account
    // during the bcrypt comparison window. Equalize timing before rejecting.
    const userAfterPasswordCheck = await repository.findUserByEmailHash(emailHash);
    if (userAfterPasswordCheck?.locked_until && userAfterPasswordCheck.locked_until > new Date()) {
        await timingSafeFakePasswordCompare(input.password);
        throw new AuthError('Invalid email or password', AuthErrorCodes.INVALID_CREDENTIALS, 401);
    }
    // Password is correct. To avoid post-password enumeration of verification
    // state, we do NOT distinguish unverified accounts here. Instead we
    // silently re-issue a verification email and respond with the same
    // INVALID_CREDENTIALS code as a wrong password. The frontend can guide
    // the user via /auth/resend-verification (which is also enumeration-safe).
    if (!user.email_verified) {
        const verificationToken = generateEmailFlowToken();
        await repository.createEmailVerification({
            user_id: user.id,
            email: normalizedEmail,
            token_hash: hashEmailFlowToken('email_verification', verificationToken),
            purpose: 'email_verification',
            expires_at: new Date(Date.now() + EMAIL_VERIFICATION_TTL_SECONDS * 1000),
        });
        // Fire-and-forget to equalize timing with wrong-password path.
        sendVerificationEmail(user, verificationToken).catch((err) => {
            logger.warn({ err, userId: user.id }, 'Auto-resend verification email failed during login');
        });
        logAudit({
            user_id: user.id,
            org_id: null,
            action: 'user.login_unverified',
            resource_type: 'user',
            resource_id: user.id,
            ip_address: ipAddress,
            request_id: requestId,
        });
        throw new AuthError('Invalid email or password', AuthErrorCodes.INVALID_CREDENTIALS, 401);
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
                await trustCurrentDevice(user.id, ipAddress, userAgent, input.device_name, requestId).catch(() => undefined);
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
            logger.error({ userId: user.id }, 'mfa_enabled=true but no verified active devices');
            throw new AuthError('MFA setup is incomplete for this account', AuthErrorCodes.MFA_NOT_ENABLED, 400);
        }
        const primary = verifiedDevices.find((d) => d.is_primary) || verifiedDevices[0];
        // For email MFA, generate and send an OTP before issuing the challenge.
        // hardware_key uses POST /auth/login/mfa/webauthn/* — no OTP email.
        if (primary.device_type === 'email') {
            const otp = await generateEmailMfaOtp();
            const otpHash = hashEmailMfaOtp(otp);
            await createEmailMfaOtp(user.id, primary.id, otpHash);
            await sendEmailMfaOtpEmail(user, otp, primary.device_name, 'login');
        }
        const availableMethods = verifiedDevices.map((d) => ({
            id: d.id,
            type: d.device_type,
            name: d.device_name || (d.device_type === 'totp' ? 'Authenticator App' : 'Email OTP'),
            display_hint: d.display_hint ||
                buildMfaDisplayHint(d.device_type, d.device_name, { email: user.email }),
            is_primary: d.is_primary,
            last_used_at: d.last_used_at,
        }));
        const hasBackupCodes = user.mfa_backup_codes_generated_at != null ||
            verifiedDevices.some((d) => Array.isArray(d.backup_codes_hash) && d.backup_codes_hash.length > 0);
        if (hasBackupCodes) {
            availableMethods.push({
                id: 'backup_codes',
                type: 'backup_codes',
                name: 'Backup Codes',
                display_hint: 'Use an emergency recovery code',
                is_primary: false,
                last_used_at: null,
            });
        }
        const challenge = createLoginMFAChallenge({
            userId: user.id,
            device: primary,
            ipAddress,
            userAgent,
            deviceName: input.device_name,
            clientDeviceType,
            rememberMe: input.remember_me === true,
            trustDevice: input.trust_device === true,
            availableMethods,
        });
        return {
            mfa_required: true,
            challenge_id: challenge.challengeId,
            expires_at: challenge.expiresAt,
            device_type: challenge.deviceType,
            available_methods: availableMethods,
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
export async function switchLoginMfaMethod(challengeId, deviceId) {
    const challenge = loginMfaChallengeCache.get(challengeId);
    if (!challenge) {
        throw new AuthError('Challenge expired or invalid', AuthErrorCodes.MFA_CHALLENGE_EXPIRED, 400);
    }
    const device = await repository.findMFADeviceById(deviceId);
    if (!device || device.user_id !== challenge.userId || !device.verified || !device.is_active) {
        throw new AuthError('Invalid or unverified MFA device', AuthErrorCodes.MFA_INVALID, 400);
    }
    challenge.deviceId = device.id;
    challenge.deviceType = device.device_type;
    loginMfaChallengeCache.set(challengeId, challenge);
    if (device.device_type === 'email') {
        const user = await repository.findUserById(challenge.userId);
        if (user) {
            const otp = await generateEmailMfaOtp();
            const otpHash = hashEmailMfaOtp(otp);
            await createEmailMfaOtp(user.id, device.id, otpHash);
            await sendEmailMfaOtpEmail(user, otp, device.device_name, 'login');
        }
    }
    return { message: 'MFA method switched successfully' };
}
export async function verifyLoginMFAChallenge(input, ipAddress, userAgent, clientDeviceType, requestId) {
    const challenge = loginMfaChallengeCache.get(input.challenge_id);
    if (!challenge) {
        throw new AuthError('Challenge expired or invalid', AuthErrorCodes.MFA_CHALLENGE_EXPIRED, 400);
    }
    if (challenge.attempts >= 3) {
        loginMfaChallengeCache.delete(input.challenge_id);
        throw new AuthError('Too many failed attempts', AuthErrorCodes.MFA_INVALID, 400);
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
        throw new AuthError('Use POST /auth/login/mfa/webauthn/options and /verify for passkey MFA', AuthErrorCodes.MFA_INVALID, 400, { device_type: 'hardware_key' });
    }
    if (device.device_type === 'email') {
        // Email MFA: check the OTP stored in email_mfa_otps.
        const codeHash = hashEmailMfaOtp(input.code);
        verified = await consumeEmailMfaOtp(device.id, codeHash);
    }
    else {
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
    if (challenge.trustDevice) {
        await trustCurrentDevice(user.id, ipAddress, userAgent, challenge.deviceName, requestId).catch((err) => {
            logger.warn({ err, userId: user.id }, 'Failed to trust device after MFA login');
        });
    }
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
        metadata: {
            session_id: session.sessionId,
            mfa_required: true,
            trusted_device_added: challenge.trustDevice,
        },
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
export async function verifyLoginBackupCode(input, ipAddress, userAgent, clientDeviceType, requestId) {
    const challenge = loginMfaChallengeCache.get(input.challenge_id);
    if (!challenge) {
        throw new AuthError('Challenge expired or invalid', AuthErrorCodes.MFA_CHALLENGE_EXPIRED, 400);
    }
    if (challenge.attempts >= 3) {
        loginMfaChallengeCache.delete(input.challenge_id);
        throw new AuthError('Too many failed attempts', AuthErrorCodes.MFA_INVALID, 400);
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
        throw new AuthError('Invalid backup code', AuthErrorCodes.MFA_INVALID, 400);
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
    if (challenge.trustDevice) {
        await trustCurrentDevice(user.id, ipAddress, userAgent, challenge.deviceName, requestId).catch((err) => {
            logger.warn({ err, userId: user.id }, 'Failed to trust device after backup-code login');
        });
    }
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
        metadata: {
            session_id: session.sessionId,
            trusted_device_added: challenge.trustDevice,
        },
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
//# sourceMappingURL=login.service.js.map