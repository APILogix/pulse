import type { FastifyRequest, FastifyReply } from 'fastify';
import jwt from 'jsonwebtoken';
import { env as config, env } from '../../config/env.js';
import { redis } from '../../config/redis.js';

interface JWTPayload {
  sub: string; // user id
  jti: string; // token id
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
  try {
    // =========================
    // 1. GET TOKEN (Bearer)
    // =========================
    const authHeader = request.headers.authorization;

    if (!authHeader?.startsWith('Bearer ')) {
      return reply.status(401).send({
        error: { code: 'UNAUTHORIZED', message: 'Missing token' },
      });
    }

    const refreshToken = authHeader.substring(7);

    // =========================
    // 2. VERIFY REFRESH TOKEN
    // =========================
    let decoded: JWTPayload;

    try {
      decoded = jwt.verify(
        refreshToken,
        env.JWT_REFRESH_SECRET
      ) as JWTPayload;
    } catch {
      return reply.status(401).send({
        error: { code: 'INVALID_TOKEN', message: 'Invalid refresh token' },
      });
    }

    if (decoded.type !== 'refresh') {
      return reply.status(401).send({
        error: { code: 'INVALID_TOKEN_TYPE', message: 'Expected refresh token' },
      });
    }

    // =========================
    // 3. VALIDATE SESSION (DB)
    // =========================
    const { findSessionById, findUserById } = await import(
      '../../modules/auth/repository.js'
    );

    const session = await findSessionById(decoded.jti);

    if (!session || session.status !== 'active') {
      return reply.status(401).send({
        error: { code: 'SESSION_INVALID', message: 'Session not found or inactive' },
      });
    }

    if (new Date(session.expires_at) < new Date()) {
      return reply.status(401).send({
        error: { code: 'SESSION_EXPIRED', message: 'Session expired' },
      });
    }

    // =========================
    // 4. FETCH USER
    // =========================
    const user = await findUserById(decoded.sub);

    if (!user || user.deleted_at) {
      return reply.status(401).send({
        error: { code: 'USER_NOT_FOUND', message: 'User not found' },
      });
    }

    if (user.status === 'suspended') {
      return reply.status(403).send({
        error: { code: 'ACCOUNT_SUSPENDED', message: 'Account suspended' },
      });
    }

    // =========================
    // 5. ATTACH USER TO REQUEST
    // =========================
    request.user = {
      id: user.id,
      email: user.email,
      sessionId: decoded.jti,
    };

  } catch (error) {
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