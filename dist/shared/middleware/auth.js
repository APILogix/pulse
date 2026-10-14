import jwt from 'jsonwebtoken';
import { getUserRevokeCutoff, hasFreshStepUp, isAccessTokenBlacklisted, } from '../../modules/auth/infrastructure/cache/auth.cache.js';
import { findSessionAndUserById } from '../../modules/auth/infrastructure/repositories/index.js';
import { AuthErrorCodes } from '../../modules/auth/domain/types.js';
import { verifyAccessToken } from '../../modules/auth/infrastructure/crypto/jwt.js';
function unauthorized(reply, code, message, status = 401) {
    return reply.status(status).send({
        error: { code, message },
    });
}
export async function authenticate(request, reply) {
    const log = request.log;
    // 1. Authorization header
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        log.warn({ reqId: request.id }, 'Missing or malformed Authorization header');
        return unauthorized(reply, 'UNAUTHORIZED', 'Missing access token');
    }
    const accessToken = authHeader.substring(7).trim();
    if (!accessToken) {
        return unauthorized(reply, 'UNAUTHORIZED', 'Missing access token');
    }
    // 2. JWT verification
    let decoded;
    try {
        decoded = verifyAccessToken(accessToken);
    }
    catch (err) {
        const isExpired = err instanceof jwt.TokenExpiredError;
        log.warn({ reqId: request.id, err: isExpired ? 'expired' : 'invalid' }, isExpired ? 'Access token expired' : 'Invalid access token');
        return unauthorized(reply, 'INVALID_TOKEN', isExpired ? 'Access token expired' : 'Invalid access token');
    }
    if (decoded.type !== 'access') {
        log.warn({ reqId: request.id, type: decoded.type }, 'Invalid token type');
        return unauthorized(reply, 'INVALID_TOKEN_TYPE', 'Expected access token');
    }
    try {
        // 3. Token-level revocation (in-process LRU)
        if (isAccessTokenBlacklisted(decoded.jti)) {
            log.warn({ reqId: request.id, sessionId: decoded.jti }, 'Token revoked');
            return unauthorized(reply, 'SESSION_INVALID', 'Session revoked');
        }
        // 4. User-wide revocation. The cutoff is epoch millis; the JWT's `iat`
        //    is in seconds. Tokens issued at-or-before the cutoff are dead.
        const cutoff = getUserRevokeCutoff(decoded.sub);
        if (cutoff !== null && decoded.iat * 1000 <= cutoff) {
            log.warn({ reqId: request.id, userId: decoded.sub, cutoff }, 'User-wide revocation matched');
            return unauthorized(reply, 'SESSION_INVALID', 'Credentials no longer valid');
        }
        // 5-7. Database lookup (single joined query for session + user)
        const record = await findSessionAndUserById(decoded.jti);
        if (!record) {
            log.warn({ reqId: request.id, sessionId: decoded.jti }, 'Session not found');
            return unauthorized(reply, 'SESSION_INVALID', 'Session not found');
        }
        if (record.session_status !== 'active') {
            log.warn({ reqId: request.id, sessionId: decoded.jti, status: record.session_status }, 'Session inactive');
            return unauthorized(reply, 'SESSION_INVALID', 'Session inactive');
        }
        if (new Date(record.session_expires_at) < new Date()) {
            log.warn({ reqId: request.id, sessionId: decoded.jti }, 'Session expired');
            return unauthorized(reply, 'SESSION_EXPIRED', 'Session expired');
        }
        if (record.session_user_id !== decoded.sub) {
            log.error({
                reqId: request.id,
                tokenUser: decoded.sub,
                sessionUser: record.session_user_id,
            }, 'Session-user mismatch');
            return unauthorized(reply, 'SESSION_MISMATCH', 'Invalid session mapping');
        }
        if (!record.user_id || record.user_deleted_at) {
            log.warn({ reqId: request.id, userId: decoded.sub }, 'User not found or deleted');
            return unauthorized(reply, AuthErrorCodes.USER_NOT_FOUND, 'User not found');
        }
        if (record.user_status === 'suspended') {
            log.warn({ reqId: request.id, userId: record.user_id }, 'Suspended account access attempt');
            return unauthorized(reply, AuthErrorCodes.USER_SUSPENDED, 'Account suspended', 403);
        }
        request.user = {
            id: record.user_id,
            email: record.user_email,
            isAdmin: record.user_is_admin === true,
            currentOrgId: record.user_current_org_id ?? null,
            sessionId: decoded.jti,
            mfaVerified: decoded.mfa_verified === true,
            stepUpFresh: hasFreshStepUp(decoded.jti),
        };
    }
    catch (error) {
        log.error({ reqId: request.id, err: error }, 'Authentication failed unexpectedly');
        return unauthorized(reply, 'UNAUTHORIZED', 'Authentication failed');
    }
}
/**
 * Hard-checks the platform-admin flag derived from `users.is_admin`. This is
 * a global flag and does NOT imply org-level admin rights. Org-level admin
 * is enforced inside the organization module.
 */
export async function requireAdmin(request, reply) {
    if (!request.user?.isAdmin) {
        return reply.status(403).send({
            error: {
                code: AuthErrorCodes.INSUFFICIENT_PERMISSIONS,
                message: 'Admin access required',
            },
        });
    }
}
/**
 * Reject requests where the access token's `mfa_verified` claim is false.
 * Used by routes that need MFA at session level.
 */
export async function requireMFA(request, reply) {
    if (!request.user?.mfaVerified) {
        return reply.status(403).send({
            error: {
                code: AuthErrorCodes.MFA_REQUIRED,
                message: 'MFA verification required',
                challenge_required: true,
            },
        });
    }
}
/**
 * Reject requests that have not completed a fresh step-up MFA challenge in
 * the last STEP_UP_FRESHNESS_TTL_SECONDS. Used by sensitive in-session
 * actions such as password change.
 *
 * This is independent from `requireMFA`: a session can be `mfaVerified=true`
 * because MFA was performed at login, but step-up freshness is only set
 * when the user proves possession of MFA AGAIN via /auth/mfa/verify.
 */
export async function requireStepUp(request, reply) {
    if (!request.user?.stepUpFresh) {
        return reply.status(403).send({
            error: {
                code: AuthErrorCodes.STEP_UP_REQUIRED,
                message: 'Step-up MFA verification required',
                challenge_required: true,
            },
        });
    }
}
//# sourceMappingURL=auth.js.map