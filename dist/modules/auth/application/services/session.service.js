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
import { SESSION_CONFIG, getSessionDeviceName, markAllUserTokensRevoked } from './shared-helpers.js';
export async function issueSessionForUser(options) {
    const refreshTtlSeconds = options.rememberMe
        ? REMEMBER_ME_REFRESH_TTL_SECONDS
        : REFRESH_TOKEN_TTL_SECONDS;
    // Enforce session quota BEFORE the new INSERT.
    const activeCount = await repository.countActiveSessionsByUser(options.user.id);
    if (activeCount >= SESSION_CONFIG.MAX_ACTIVE_SESSIONS) {
        await repository.revokeOldestSessions(options.user.id, SESSION_CONFIG.MAX_ACTIVE_SESSIONS - 1);
    }
    const now = Date.now();
    const sessionId = randomUUID();
    const expiresAt = new Date(now + refreshTtlSeconds * 1000);
    const absoluteExpiresAt = new Date(now + ABSOLUTE_SESSION_TTL_SECONDS * 1000);
    const refreshToken = generateRefreshToken(options.user.id, sessionId, refreshTtlSeconds);
    const refreshTokenHash = hashAuthToken(refreshToken);
    const accessToken = generateAccessToken(options.user.id, sessionId, options.mfaVerified);
    const sso = options.ssoContext;
    await repository.createSession({
        id: sessionId,
        user_id: options.user.id,
        refresh_token_hash: refreshTokenHash,
        access_token_jti: sessionId,
        device_fingerprint: buildDeviceFingerprint(options.ipAddress, options.userAgent),
        device_name: options.deviceName ||
            buildSessionDeviceLabel(options.userAgent, options.deviceType),
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
        ...(sso?.providerType !== undefined ? { sso_provider_type: sso.providerType } : {}),
        ...(sso?.loginMethod !== undefined ? { login_method: sso.loginMethod } : {}),
        ...(sso?.samlNameId !== undefined ? { saml_name_id: sso.samlNameId } : {}),
        ...(sso?.samlSessionIndex !== undefined
            ? { saml_session_index: sso.samlSessionIndex }
            : {}),
    });
    return { accessToken, refreshToken, expiresAt, sessionId };
}
export function createLoginMFAChallenge(options) {
    const challengeId = generateId();
    const expiresAt = new Date(Date.now() + MFA_LOGIN_CHALLENGE_TTL_SECONDS * 1000);
    const challenge = {
        userId: options.userId,
        deviceId: options.device.id,
        deviceName: options.deviceName || options.userAgent.slice(0, 255),
        deviceType: options.device.device_type,
        clientDeviceType: options.clientDeviceType || 'web',
        ipAddress: options.ipAddress,
        userAgent: options.userAgent,
        attempts: 0,
        rememberMe: options.rememberMe,
        trustDevice: options.trustDevice,
        ...(options.availableMethods ? { availableMethods: options.availableMethods } : {}),
    };
    loginMfaChallengeCache.set(challengeId, challenge);
    return { challengeId, expiresAt, deviceType: options.device.device_type };
}
// ============================================================================
// SESSIONS
// ============================================================================
export async function listUserSessions(userId, currentSessionId) {
    const sessions = await repository.listActiveSessionsByUser(userId);
    return sessions.map((s) => ({
        id: s.id,
        device_name: getSessionDeviceName(s),
        device_type: s.device_type,
        ip_address: s.ip_address,
        ip_geo_country: s.ip_geo_country,
        last_active_at: s.last_active_at,
        created_at: s.created_at,
        is_current: s.id === currentSessionId,
    }));
}
export async function revokeSession(userId, sessionId, currentSessionId) {
    if (sessionId === currentSessionId) {
        throw new AuthError('Cannot revoke current session via this endpoint; use /logout', AuthErrorCodes.INVALID_OPERATION, 400);
    }
    const session = await repository.findSessionById(sessionId, userId);
    if (!session) {
        throw new AuthError('Session not found', AuthErrorCodes.SESSION_INVALID, 404);
    }
    await repository.revokeSession(sessionId, 'User revoked session');
    blacklistAccessToken(sessionId);
}
/**
 * Revoke every session except the caller's. Surgically blacklists the
 * access tokens of OTHER sessions only — the caller's current access token
 * remains valid until it expires naturally.
 */
export async function revokeAllOtherSessions(userId, currentSessionId) {
    const otherIds = await repository.listOtherActiveSessionIds(userId, currentSessionId);
    for (const id of otherIds) {
        blacklistAccessToken(id);
    }
    return repository.revokeAllOtherSessions(userId, currentSessionId, 'User revoked all other sessions');
}
/**
 * Refresh-token rotation with reuse detection AND a 30-second retry-grace
 * window. The grace window is what protects legitimate clients on flaky
 * networks from being kicked out: when the same refresh token is presented
 * twice within the window, the second call is treated as a network retry,
 * not a replay attack.
 */
export async function refreshAccessToken(refreshToken, ipAddress, userAgent, requestId) {
    let decoded;
    try {
        decoded = verifyRefreshToken(refreshToken);
    }
    catch {
        throw new AuthError('Invalid refresh token', AuthErrorCodes.SESSION_INVALID, 401);
    }
    if (decoded.type !== 'refresh') {
        throw new AuthError('Invalid token type', AuthErrorCodes.SESSION_INVALID, 401);
    }
    const presentedHash = hashAuthToken(refreshToken);
    // Scoped lookup: only the session the JWT claims to belong to is allowed.
    const lookup = await repository.findSessionByAnyRefreshTokenHash(presentedHash, decoded.jti, decoded.sub);
    // BUG-013 FIX: All three paths return the same error message and code so
    // an attacker cannot distinguish "session not found" from
    // "session revoked due to token reuse". The matchedPrevious flag is
    // available in the evidence for SIEM without leaking to the client.
    if (!lookup) {
        throw new AuthError('Invalid session', AuthErrorCodes.SESSION_INVALID, 401);
    }
    const { session, matchedPrevious } = lookup;
    // Grace window: legitimate retry of a JUST-rotated refresh.
    if (matchedPrevious && session.status === 'active') {
        const rotatedAt = session.previous_refresh_rotated_at;
        if (rotatedAt &&
            Date.now() - new Date(rotatedAt).getTime() <= REFRESH_GRACE_WINDOW_MS) {
            // Treat as idempotent retry: do not rotate again. Re-issue an access
            // token for the existing (already-rotated) refresh hash. The client
            // must use the refresh token it received from the FIRST call going
            // forward.
            const user = await repository.findUserById(session.user_id);
            if (!user || user.deleted_at || user.status !== 'active') {
                await repository.revokeSession(session.id, 'User inactive');
                throw new AuthError('User inactive', AuthErrorCodes.USER_SUSPENDED, 401);
            }
            try {
                await assertRefreshAllowedByOrgPolicy(user, session.last_active_at);
            }
            catch (policyErr) {
                await repository.revokeSession(session.id, 'Organization policy violation');
                markAllUserTokensRevoked(user.id);
                throw policyErr;
            }
            const mfaVerified = Boolean(session.mfa_verified_at) || !user.mfa_enabled;
            const accessToken = generateAccessToken(session.user_id, session.id, mfaVerified);
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
                currentOrgId: user.current_org_id ?? null,
            };
        }
    }
    // True reuse / inactive session: revoke entire family.
    if (matchedPrevious || session.status !== 'active') {
        logger.warn({ userId: session.user_id, sessionId: session.id, ipAddress, userAgent }, 'Refresh-token reuse detected');
        await repository.revokeAllUserSessions(session.user_id, 'refresh_token_reuse_detected');
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
        // BUG-013 FIX: Use SESSION_TOKEN_REUSE so the error code specifically
        // indicates token-reuse (not just generic SESSION_INVALID).
        throw new AuthError('Session revoked due to token reuse. Please sign in again.', AuthErrorCodes.SESSION_TOKEN_REUSE, 401);
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
    // BUG-009/010 FIX: Validate IP and device fingerprint on refresh.
    // If the request comes from a different IP or device fingerprint,
    // treat it as a potential token theft and revoke the session.
    const currentFingerprint = buildDeviceFingerprint(ipAddress, userAgent);
    if (session.device_fingerprint && session.device_fingerprint !== currentFingerprint) {
        await repository.revokeSession(session.id, 'Device fingerprint mismatch on refresh');
        logger.warn({ userId: session.user_id, sessionId: session.id, ipAddress, userAgent }, 'Refresh token presented from different device; session revoked');
        throw new AuthError('Session invalidated. Please sign in again.', AuthErrorCodes.SESSION_INVALID, 401);
    }
    const user = await repository.findUserById(session.user_id);
    if (!user || user.deleted_at || user.status !== 'active') {
        await repository.revokeSession(session.id, 'User inactive');
        throw new AuthError('User inactive', AuthErrorCodes.USER_SUSPENDED, 401);
    }
    try {
        await assertRefreshAllowedByOrgPolicy(user, session.last_active_at);
    }
    catch (policyErr) {
        await repository.revokeSession(session.id, 'Organization policy violation');
        markAllUserTokensRevoked(user.id);
        throw policyErr;
    }
    // CAS rotation
    const newRefreshToken = generateRefreshToken(session.user_id, session.id);
    const newRefreshHash = hashAuthToken(newRefreshToken);
    const newExpiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000);
    const finalExpiresAt = newExpiresAt > new Date(session.absolute_expires_at)
        ? new Date(session.absolute_expires_at)
        : newExpiresAt;
    const rotated = await repository.rotateRefreshToken(session.id, presentedHash, newRefreshHash, finalExpiresAt);
    if (!rotated) {
        // CAS failed: a concurrent refresh already rotated. Outside the grace
        // window we treat this as reuse for safety.
        await repository.revokeAllUserSessions(session.user_id, 'refresh_token_concurrent_rotation');
        markAllUserTokensRevoked(session.user_id);
        throw new AuthError('Refresh token already rotated. Please sign in again.', AuthErrorCodes.SESSION_TOKEN_REUSE, // BUG-013: unified reuse code
        401);
    }
    const mfaVerified = Boolean(session.mfa_verified_at) || !user.mfa_enabled;
    const accessToken = generateAccessToken(session.user_id, session.id, mfaVerified);
    return {
        accessToken,
        refreshToken: newRefreshToken,
        expiresAt: finalExpiresAt,
        sessionId: session.id,
        currentOrgId: user.current_org_id ?? null,
    };
}
export async function logout(userId, sessionId, ipAddress, requestId) {
    const session = await repository.findSessionById(sessionId, userId);
    // Always revoke local session immediately; SAML IdP logout is best-effort.
    await repository.revokeSession(sessionId, 'User logout');
    blacklistAccessToken(sessionId);
    if (session?.saml_name_id && session.sso_provider_id) {
        const { completeSamlLogoutForUser } = await import('./saml-slo.service.js');
        const result = await completeSamlLogoutForUser(userId, sessionId, ipAddress, requestId);
        return { saml_logout_url: result.logout_url };
    }
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
export async function getUserSessionDetail(userId, sessionId, currentSessionId) {
    const session = await repository.findSessionById(sessionId, userId);
    if (!session || session.status !== 'active') {
        throw new AuthError('Session not found', AuthErrorCodes.SESSION_INVALID, 404);
    }
    return {
        id: session.id,
        device_name: getSessionDeviceName(session),
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
export async function revokeAllSessionsForUser(userId) {
    const sessions = await repository.listActiveSessionsByUser(userId);
    for (const s of sessions) {
        blacklistAccessToken(s.id);
    }
    await repository.revokeAllSessionsForUser(userId, 'User revoked all sessions');
    return sessions.length;
}
//# sourceMappingURL=session.service.js.map