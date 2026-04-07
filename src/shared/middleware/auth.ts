import type { FastifyRequest, FastifyReply } from 'fastify';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env.js';
import { redis } from '../../config/redis.js';

interface JWTPayload {
  sub: string; // user id
  jti: string; // session id
  mfa_verified: boolean;
  type: string;
  iat: number;
  exp: number;
}

declare module 'fastify' {
  interface FastifyRequest {
    user: {
      id: string;
      email: string;
      isAdmin: boolean;
      sessionId: string;
      mfaVerified: boolean;
    };
  }
}

export async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const log = request.log; // Fastify logger (pino)

  try {
    // =========================
    // 1. GET ACCESS TOKEN
    // =========================
    const authHeader = request.headers.authorization;

    if (!authHeader?.startsWith('Bearer ')) {
      log.warn({ reqId: request.id }, 'Missing or malformed Authorization header');
      return reply.status(401).send({
        error: { code: 'UNAUTHORIZED', message: 'Missing access token' },
      });
    }

    const accessToken = authHeader.substring(7);

    // =========================
    // 2. VERIFY ACCESS TOKEN
    // =========================
    let decoded: JWTPayload;

    try {
      decoded = jwt.verify(accessToken, env.JWT_SECRET, {
        algorithms: ['HS256'],
      }) as JWTPayload;

      log.debug(
        { reqId: request.id, userId: decoded.sub, sessionId: decoded.jti },
        'Access token verified'
      );
    } catch (err) {
      const isExpired = err instanceof jwt.TokenExpiredError;

      log.warn(
        { reqId: request.id, error: err },
        isExpired ? 'Access token expired' : 'Invalid access token'
      );

      return reply.status(401).send({
        error: {
          code: 'INVALID_TOKEN',
          message: isExpired ? 'Access token expired' : 'Invalid access token',
        },
      });
    }

    if (decoded.type !== 'access') {
      log.warn(
        { reqId: request.id, type: decoded.type },
        'Invalid token type'
      );
      return reply.status(401).send({
        error: { code: 'INVALID_TOKEN_TYPE', message: 'Expected access token' },
      });
    }

    // =========================
    // 3. VALIDATE SESSION
    // =========================
    const { findSessionById, findUserById } = await import(
      '../../modules/auth/repository.js'
    );

    const session = await findSessionById(decoded.jti);

    if (!session) {
      log.warn(
        { reqId: request.id, sessionId: decoded.jti },
        'Session not found'
      );
      return reply.status(401).send({
        error: { code: 'SESSION_INVALID', message: 'Session not found' },
      });
    }

    if (session.status !== 'active') {
      log.warn(
        { reqId: request.id, sessionId: decoded.jti, status: session.status },
        'Session inactive'
      );
      return reply.status(401).send({
        error: { code: 'SESSION_INVALID', message: 'Session inactive' },
      });
    }

    if (new Date(session.expires_at) < new Date()) {
      log.warn(
        { reqId: request.id, sessionId: decoded.jti },
        'Session expired'
      );
      return reply.status(401).send({
        error: { code: 'SESSION_EXPIRED', message: 'Session expired' },
      });
    }

    // 🔥 IMPORTANT CHECK (you were missing earlier)
    if (session.user_id !== decoded.sub) {
      log.error(
        {
          reqId: request.id,
          tokenUser: decoded.sub,
          sessionUser: session.user_id,
        },
        'Session-user mismatch'
      );
      return reply.status(401).send({
        error: { code: 'SESSION_MISMATCH', message: 'Invalid session mapping' },
      });
    }

    // =========================
    // 4. FETCH USER
    // =========================
    const user = await findUserById(decoded.sub);

    if (!user || user.deleted_at) {
      log.warn(
        { reqId: request.id, userId: decoded.sub },
        'User not found or deleted'
      );
      return reply.status(401).send({
        error: { code: 'USER_NOT_FOUND', message: 'User not found' },
      });
    }

    if (user.status === 'suspended') {
      log.warn(
        { reqId: request.id, userId: user.id },
        'Suspended account access attempt'
      );
      return reply.status(403).send({
        error: { code: 'ACCOUNT_SUSPENDED', message: 'Account suspended' },
      });
    }

    // =========================
    // 5. ATTACH USER
    // =========================
    request.user = {
      id: user.id,
      email: user.email,
      isAdmin: Boolean((user as any).is_admin),
      sessionId: decoded.jti,
      mfaVerified: decoded.mfa_verified ?? false,
    };

    log.info(
      { reqId: request.id, userId: user.id },
      'Authentication successful'
    );

  } catch (error) {
    request.log.error(
      { reqId: request.id, error },
      'Authentication failed unexpectedly'
    );

    return reply.status(401).send({
      error: { code: 'UNAUTHORIZED', message: 'Authentication failed' },
    });
  }
}

export async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!request.user.isAdmin) {
    return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Admin access required' } });
  }
}

export async function requireMFA(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!request.user.mfaVerified) {
    return reply.status(403).send({
      error: {
        code: 'MFA_REQUIRED',
        message: 'MFA verification required',
        challenge_required: true,
      }
    });
  }
}