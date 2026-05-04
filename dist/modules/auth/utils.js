/**
 * Auth utility functions.
 *
 * Flow:
 * - Token helpers sign short-lived access tokens and longer-lived refresh
 *   tokens with separate secrets.
 * - Cookie helpers keep refresh-token transport consistent across auth routes.
 * - Normalization/history helpers keep identity and password policy behavior
 *   centralized in one module.
 */
import { createHash, randomBytes } from 'crypto';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env.js';
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;
export const ABSOLUTE_SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
export const MFA_LOGIN_CHALLENGE_TTL_SECONDS = 5 * 60;
export const PASSWORD_RESET_TTL_SECONDS = 60 * 60;
export function hashToken(token) {
    // Persist token hashes instead of raw token values so database access cannot
    // recover bearer credentials.
    return createHash('sha256').update(token).digest('hex');
}
export function generateSecureToken(byteLength = 32) {
    return randomBytes(byteLength).toString('hex');
}
export function generateAccessToken(userId, sessionId, mfaVerified) {
    return jwt.sign({
        sub: userId,
        jti: sessionId,
        mfa_verified: mfaVerified,
        type: 'access',
    }, env.JWT_SECRET, {
        expiresIn: ACCESS_TOKEN_TTL_SECONDS,
        algorithm: 'HS256',
    });
}
export function generateRefreshToken(userId, sessionId) {
    return jwt.sign({
        sub: userId,
        jti: sessionId,
        type: 'refresh',
    }, env.JWT_REFRESH_SECRET, {
        expiresIn: REFRESH_TOKEN_TTL_SECONDS,
        algorithm: 'HS256',
    });
}
export function getRefreshCookieOptions() {
    // Refresh cookies are httpOnly and path-scoped to auth endpoints; production
    // also requires secure transport.
    return {
        httpOnly: true,
        secure: env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: REFRESH_TOKEN_TTL_SECONDS * 1000,
        path: '/auth',
    };
}
export function normalizeEmail(email) {
    return email.trim().toLowerCase();
}
export function buildPasswordHistory(currentHistory, currentPasswordHash) {
    // Keep only recent password hashes. The service uses password verification
    // against these hashes to prevent password reuse.
    const history = Array.isArray(currentHistory)
        ? currentHistory.filter((entry) => typeof entry === 'string')
        : [];
    const next = [currentPasswordHash, ...history].filter((entry) => Boolean(entry));
    return next.slice(0, 5);
}
//# sourceMappingURL=utils.js.map