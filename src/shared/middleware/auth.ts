/**
 * Authentication and authorization middleware.
 *
 * This middleware is the single gate every authenticated route passes
 * through. It MUST stay tight: every check runs in a fixed order, fails
 * closed, and never reveals more than `Unauthorized` to the caller.
 *
 * Order of checks (early-out on first failure):
 *   1. Authorization header is present and well-formed.
 *   2. JWT signature, algorithm, issuer, audience, and `type === 'access'`
 *      are all valid.
 *   3. Access-token JTI is not on the in-process blacklist (fast path).
 *   4. The user as a whole is not on the user-wide revocation list (set on
 *      password change, password reset, suspension, MFA disable).
 *   5. Persistent session row exists, is `active`, and not expired.
 *   6. Session belongs to the same user the JWT claims.
 *   7. User row exists, is not deleted, not suspended.
 *
 * Design notes:
 *   - The blacklist + user-revoke checks live in an in-process LRU cache
 *     (see `modules/auth/cache.ts`). The auth module is intentionally
 *     Redis-free per project decision; this means revocation is per-process.
 *   - Database session lookup remains the source of truth for revocation
 *     across processes. Even when the LRU misses (after a deploy), a session
 *     that was revoked still has `status != 'active'` and is rejected at
 *     step 5.
 */
import type { FastifyRequest, FastifyReply } from 'fastify';
import jwt from 'jsonwebtoken';

import {
  getUserRevokeCutoff,
  hasFreshStepUp,
  isAccessTokenBlacklisted,
} from '../../modules/auth/infrastructure/cache/auth.cache.js';
import { findSessionById, findUserById } from '../../modules/auth/infrastructure/repositories/index.js';
import { AuthErrorCodes, type User } from '../../modules/auth/domain/types.js';
import { verifyAccessToken } from '../../modules/auth/infrastructure/crypto/jwt.js';

declare module 'fastify' {
  interface FastifyRequest {
    user?: {
      id: string;
      email: string;
      isAdmin: boolean;
      currentOrgId?: string | null;
      sessionId: string;
      mfaVerified: boolean;
      stepUpFresh: boolean;
    };
  }
}

function unauthorized(
  reply: FastifyReply,
  code: string,
  message: string,
  status = 401,
): FastifyReply {
  return reply.status(status).send({
    error: { code, message },
  });
}

export async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const log = request.log;

  // 1. Authorization header
  const authHeader = request.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    log.warn({ reqId: request.id }, 'Missing or malformed Authorization header');
    return void unauthorized(reply, 'UNAUTHORIZED', 'Missing access token');
  }

  const accessToken = authHeader.substring(7).trim();
  if (!accessToken) {
    return void unauthorized(reply, 'UNAUTHORIZED', 'Missing access token');
  }

  // 2. JWT verification
  let decoded;
  try {
    decoded = verifyAccessToken(accessToken);
  } catch (err) {
    const isExpired = err instanceof jwt.TokenExpiredError;
    log.warn(
      { reqId: request.id, err: isExpired ? 'expired' : 'invalid' },
      isExpired ? 'Access token expired' : 'Invalid access token',
    );
    return void unauthorized(
      reply,
      'INVALID_TOKEN',
      isExpired ? 'Access token expired' : 'Invalid access token',
    );
  }

  if (decoded.type !== 'access') {
    log.warn({ reqId: request.id, type: decoded.type }, 'Invalid token type');
    return void unauthorized(reply, 'INVALID_TOKEN_TYPE', 'Expected access token');
  }

  try {
    // 3. Token-level revocation (in-process LRU)
    if (isAccessTokenBlacklisted(decoded.jti)) {
      log.warn({ reqId: request.id, sessionId: decoded.jti }, 'Token revoked');
      return void unauthorized(reply, 'SESSION_INVALID', 'Session revoked');
    }

    // 4. User-wide revocation. The cutoff is epoch millis; the JWT's `iat`
    //    is in seconds. Tokens issued at-or-before the cutoff are dead.
    const cutoff = getUserRevokeCutoff(decoded.sub);
    if (cutoff !== null && decoded.iat * 1000 <= cutoff) {
      log.warn(
        { reqId: request.id, userId: decoded.sub, cutoff },
        'User-wide revocation matched',
      );
      return void unauthorized(
        reply,
        'SESSION_INVALID',
        'Credentials no longer valid',
      );
    }

    // 5-7. Database lookups (only after the in-process fast paths)
    const session = await findSessionById(decoded.jti);
    if (!session) {
      log.warn({ reqId: request.id, sessionId: decoded.jti }, 'Session not found');
      return void unauthorized(reply, 'SESSION_INVALID', 'Session not found');
    }

    if (session.status !== 'active') {
      log.warn(
        { reqId: request.id, sessionId: decoded.jti, status: session.status },
        'Session inactive',
      );
      return void unauthorized(reply, 'SESSION_INVALID', 'Session inactive');
    }

    if (new Date(session.expires_at) < new Date()) {
      log.warn({ reqId: request.id, sessionId: decoded.jti }, 'Session expired');
      return void unauthorized(reply, 'SESSION_EXPIRED', 'Session expired');
    }

    if (session.user_id !== decoded.sub) {
      log.error(
        {
          reqId: request.id,
          tokenUser: decoded.sub,
          sessionUser: session.user_id,
        },
        'Session-user mismatch',
      );
      return void unauthorized(reply, 'SESSION_MISMATCH', 'Invalid session mapping');
    }

    const user: User | null = await findUserById(decoded.sub);
    if (!user || user.deleted_at) {
      log.warn({ reqId: request.id, userId: decoded.sub }, 'User not found or deleted');
      return void unauthorized(reply, AuthErrorCodes.USER_NOT_FOUND, 'User not found');
    }

    if (user.status === 'suspended') {
      log.warn({ reqId: request.id, userId: user.id }, 'Suspended account access attempt');
      return void unauthorized(
        reply,
        AuthErrorCodes.USER_SUSPENDED,
        'Account suspended',
        403,
      );
    }

    request.user = {
      id: user.id,
      email: user.email,
      isAdmin: user.is_admin === true,
      currentOrgId: user.current_org_id ?? null,
      sessionId: decoded.jti,
      mfaVerified: decoded.mfa_verified === true,
      stepUpFresh: hasFreshStepUp(decoded.jti),
    };
  } catch (error) {
    log.error({ reqId: request.id, err: error }, 'Authentication failed unexpectedly');
    return void unauthorized(reply, 'UNAUTHORIZED', 'Authentication failed');
  }
}

/**
 * Hard-checks the platform-admin flag derived from `users.is_admin`. This is
 * a global flag and does NOT imply org-level admin rights. Org-level admin
 * is enforced inside the organization module.
 */
export async function requireAdmin(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  if (!request.user?.isAdmin) {
    return void reply.status(403).send({
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
export async function requireMFA(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  if (!request.user?.mfaVerified) {
    return void reply.status(403).send({
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
export async function requireStepUp(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  if (!request.user?.stepUpFresh) {
    return void reply.status(403).send({
      error: {
        code: AuthErrorCodes.STEP_UP_REQUIRED,
        message: 'Step-up MFA verification required',
        challenge_required: true,
      },
    });
  }
}
