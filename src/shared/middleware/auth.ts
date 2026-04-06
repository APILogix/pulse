import  type { FastifyRequest, FastifyReply } from 'fastify';
import jwt from 'jsonwebtoken';
import { env as config } from '../../config/env.js';
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

export async function authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: 'Missing or invalid token' } });
    }

    const token = authHeader.substring(7);
    const decoded = jwt.verify(token, config.JWT_SECRET) as JWTPayload;
    
    if (decoded.type !== 'access') {
      return reply.status(401).send({ error: { code: 'INVALID_TOKEN_TYPE', message: 'Invalid token type' } });
    }

    // Check if token is revoked (in Redis blacklist)
    const isRevoked = await redis.get(`token_revoke:${decoded.jti}`);
    if (isRevoked) {
      return reply.status(401).send({ error: { code: 'TOKEN_REVOKED', message: 'Token has been revoked' } });
    }

    // Get user from cache or DB
    const userKey = `user:${decoded.sub}`;
    let userData = await redis.get(userKey);
    
    if (!userData) {
      // Fetch from DB and cache
      const { findUserById } = await import('../../modules/auth/repository.js');
      const user = await findUserById(decoded.sub);
      if (!user || user.deleted_at) {
        return reply.status(401).send({ error: { code: 'USER_NOT_FOUND', message: 'User not found' } });
      }
      userData = JSON.stringify({
        id: user.id,
        email: user.email,
        status: user.status,
        isAdmin: false, // Determine from roles/permissions
      });
      await redis.setex(userKey, 300, userData); // Cache 5 min
    }

    const user = JSON.parse(userData);
    
    if (user.status === 'suspended') {
      return reply.status(403).send({ error: { code: 'ACCOUNT_SUSPENDED', message: 'Account suspended' } });
    }

    // Attach user to request
    request.user = {
      id: decoded.sub,
      email: user.email,
      isAdmin: user.isAdmin,
      sessionId: decoded.jti,
      mfaVerified: decoded.mfa_verified,
    };
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      return reply.status(401).send({ error: { code: 'TOKEN_EXPIRED', message: 'Token expired' } });
    }
    return reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: 'Invalid token' } });
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