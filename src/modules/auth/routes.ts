/**
 * Auth Routes - Fastify route handlers
 * Enterprise security headers, rate limiting, validation
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import * as service from './service.js';
import * as repository from './repository.js';
import {
  CreateUserSchema,
  LoginSchema,
  LoginMFAVerifySchema,
  UpdateUserSchema,
  DeleteUserSchema,
  ChangePasswordSchema,
  ForgotPasswordSchema,
  ResetPasswordSchema,
  MFASetupSchema,
  MFAVerifySetupSchema,
  MFAVerifySchema,
  BackupCodeVerificationSchema,
  AuthError,
  AuthErrorCodes,
} from './types.js';

import { authenticate, requireAdmin, requireMFA } from '../../shared/middleware/auth.js';
import { rateLimit } from '../../shared/middleware/rate-limit.js';
import { getClientInfo } from '../../shared/utils/request.js';

// ============================================
// REQUEST TYPES
// ============================================

interface RequestWithUser extends FastifyRequest {
  user: {
    id: string;
    email: string;
    isAdmin: boolean;
    sessionId: string;
    mfaVerified: boolean;
  };
}

// ============================================
// ERROR HANDLER
// ============================================

function handleAuthError(error: unknown, reply: FastifyReply) {
  if (error instanceof AuthError) {
    return reply.status(error.statusCode).send({
      error: {
        code: error.code,
        message: error.message,
        details: error.details,
      },
    });
  }
  
  // Log unexpected errors
  console.error('Unexpected auth error:', error);
  return reply.status(500).send({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    },
  });
}

function sendAuthSession(
  reply: FastifyReply,
  payload: {
    access_token: string;
    refresh_token: string;
    expires_at: Date;
    token_type: string;
    session_id: string;
    user_id?: string;
  },
) {
  return reply.send({
    data: {
      access_token: payload.access_token,
      refresh_token: payload.refresh_token,
      expires_at: payload.expires_at,
      token_type: payload.token_type,
      session_id: payload.session_id,
      user_id: payload.user_id,
    },
  });
}

// ============================================
// CREDENTIAL ROUTES
// ============================================

async function credentialRoutes(fastify: FastifyInstance) {
  // POST /auth/login - Password login
  fastify.post(
    '/login',
    {
      preHandler: [rateLimit({ max: 10, window: 300 })],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const body = LoginSchema.parse(request.body);
        const clientInfo = getClientInfo(request);

        const result = await service.loginWithEmailPassword(
          body,
          clientInfo.ip,
          clientInfo.userAgent,
          clientInfo.device.type,
          request.id,
        );

        if (result.mfa_required) {
          return reply.status(202).send({
            data: {
              mfa_required: true,
              challenge_id: result.challenge_id,
              expires_at: result.expires_at,
              device_type: result.device_type,
              user_id: result.user_id,
            },
          });
        }

        return sendAuthSession(reply, result);
      } catch (error) {
        return handleAuthError(error, reply);
      }
    },
  );

  // POST /auth/login/mfa - Complete MFA challenge for login
  fastify.post(
    '/login/mfa',
    {
      preHandler: [rateLimit({ max: 5, window: 300 })],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const body = LoginMFAVerifySchema.parse(request.body);
        const clientInfo = getClientInfo(request);

        const result = await service.verifyLoginMFAChallenge(
          body,
          clientInfo.ip,
          clientInfo.userAgent,
          clientInfo.device.type,
          request.id,
        );

        return sendAuthSession(reply, result);
      } catch (error) {
        return handleAuthError(error, reply);
      }
    },
  );

  // POST /auth/password/forgot - Request password reset
  fastify.post(
    '/password/forgot',
    {
      preHandler: [rateLimit({ max: 5, window: 900 })],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const body = ForgotPasswordSchema.parse(request.body);
        const clientInfo = getClientInfo(request);
        const result = await service.requestPasswordReset(
          body,
          clientInfo.ip,
          request.id,
        );

        return reply.send({ data: result });
      } catch (error) {
        return handleAuthError(error, reply);
      }
    },
  );

  // POST /auth/password/reset - Reset password using a token
  fastify.post(
    '/password/reset',
    {
      preHandler: [rateLimit({ max: 5, window: 900 })],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const body = ResetPasswordSchema.parse(request.body);
        const clientInfo = getClientInfo(request);
        await service.resetPasswordWithToken(
          body,
          clientInfo.ip,
          request.id,
        );

        return reply.send({ message: 'Password reset successfully' });
      } catch (error) {
        return handleAuthError(error, reply);
      }
    },
  );

  // POST /auth/password/change - Change current password
  fastify.post(
    '/password/change',
    {
      preHandler: [authenticate, rateLimit({ max: 5, window: 900 })],
    },
    async (request: RequestWithUser, reply: FastifyReply) => {
      try {
        const body = ChangePasswordSchema.parse(request.body);
        const clientInfo = getClientInfo(request);
        await service.changePassword(
          request.user.id,
          body,
          request.user.mfaVerified,
          clientInfo.ip,
          request.id,
        );

        return reply.send({ message: 'Password changed successfully' });
      } catch (error) {
        return handleAuthError(error, reply);
      }
    },
  );
}

// ============================================
// USER ROUTES
// ============================================

async function userRoutes(fastify: FastifyInstance) {
  // POST /auth/users - Create user 
  fastify.post(
    '/users',
    {
      config: { rawBody: true }, // Need raw body for signature verification
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const body = CreateUserSchema.parse(request.body);
        
        const { ip } = getClientInfo(request);
        
        const user = await service.createUserFromEmail(body, ip, request.id);
        
        return reply.status(201).send({
          message: 'Account created successfully'
        });
      } catch (error) {
        return handleAuthError(error, reply);
      }
    }
  );

  // GET /auth/users/me - Get current user
  fastify.get(
    '/users/me',
    {
      preHandler: [authenticate],
    },
    async (request: RequestWithUser, reply: FastifyReply) => {
      try {
        const profile = await service.getCurrentUser(request.user.id);
        return reply.send({ data: profile });
      } catch (error) {
        return handleAuthError(error, reply);
      }
    }
  );

  // PATCH /auth/users/me - Update current user
  fastify.patch(
    '/users/me',
    {
      preHandler: [authenticate, rateLimit({ max: 10, window: 60 })],
    },
    async (request: RequestWithUser, reply: FastifyReply) => {
      try {
        const body = UpdateUserSchema.parse(request.body);
        const profile = await service.updateCurrentUser(request.user.id, body);
        return reply.send({ data: profile });
      } catch (error) {
        return handleAuthError(error, reply);
      }
    }
  );

  // DELETE /auth/users/me - Soft delete current user
  fastify.delete(
    '/users/me',
    {
      preHandler: [authenticate, rateLimit({ max: 3, window: 300 })], // Strict limit
    },
    async (request: RequestWithUser, reply: FastifyReply) => {
      try {
        const body = DeleteUserSchema.parse(request.body);
        const { ip } = getClientInfo(request);
        
        await service.deleteCurrentUser(request.user.id, body, ip, request.id);

        return reply.status(204).send();
      } catch (error) {
        return handleAuthError(error, reply);
      }
    }
  );

  // GET /auth/users/:id - Get user by ID (admin only)
  fastify.get(
    '/users/:id',
    {
      preHandler: [authenticate, requireAdmin],
    },
    async (request: RequestWithUser, reply: FastifyReply) => {
      try {
        const params = request.params as { id: string };
        const profile = await service.getUserById(
          params.id,
          request.user.id,
          request.user.isAdmin
        );
        return reply.send({ data: profile });
      } catch (error) {
        return handleAuthError(error, reply);
      }
    }
  );

  // GET /auth/users - List users (admin only)
  fastify.get(
    '/users',
    {
      preHandler: [authenticate, requireAdmin],
    },
    async (request: RequestWithUser, reply: FastifyReply) => {
      try {
        const query = request.query as { status?: string; limit?: number; offset?: number; search?: string };
        const filters: {
          status?: any;
          limit?: number;
          offset?: number;
          search?: string;
        } = {
          status: query.status as any,
          limit: Math.min(query.limit || 20, 100),
          offset: query.offset || 0,
        };
        if (query.search !== undefined) {
          filters.search = query.search;
        }

        const { users, total } = await service.listAllUsers(
          filters,
          request.user.isAdmin
        );
        
        return reply.send({
          data: users,
          meta: {
            total,
            limit: query.limit || 20,
            offset: query.offset || 0,
          },
        });
      } catch (error) {
        return handleAuthError(error, reply);
      }
    }
  );

  // POST /auth/users/:id/restore - Restore deleted user
  fastify.post(
    '/users/:id/restore',
    {
      preHandler: [authenticate, requireAdmin, rateLimit({ max: 20, window: 60 })],
    },
    async (request: RequestWithUser, reply: FastifyReply) => {
      try {
        const params = request.params as { id: string };
        const { ip } = getClientInfo(request);
        const profile = await service.restoreDeletedUser(
          params.id,
          request.user.id,
          request.user.isAdmin,
          ip,
          request.id
        );
        return reply.send({ data: profile });
      } catch (error) {
        return handleAuthError(error, reply);
      }
    }
  );

  // POST /auth/users/:id/suspend - Suspend user
  fastify.post(
    '/users/:id/suspend',
    {
      preHandler: [authenticate, requireAdmin, rateLimit({ max: 20, window: 60 })],
    },
    async (request: RequestWithUser, reply: FastifyReply) => {
      try {
        const params = request.params as { id: string };
        const body = request.body as { reason: string };
        const { ip } = getClientInfo(request);
        const profile = await service.suspendUser(
          params.id,
          body.reason,
          request.user.id,
          request.user.isAdmin,
          ip,
          request.id
        );
        return reply.send({ data: profile });
      } catch (error) {
        return handleAuthError(error, reply);
      }
    }
  );
}

// ============================================
// MFA ROUTES
// ============================================

async function mfaRoutes(fastify: FastifyInstance) {
  // POST /auth/mfa/setup - Initialize MFA setup
  fastify.post(
    '/mfa/setup',
    {
      preHandler: [authenticate, rateLimit({ max: 3, window: 3600 })],
    },
    async (request: RequestWithUser, reply: FastifyReply) => {
      try {
        const body = MFASetupSchema.parse(request.body);
        const { ip } = getClientInfo(request);
        
        const setup = await service.setupMFA(request.user.id, body, ip);
        
        return reply.status(201).send({
          data: {
            secret: setup.secret,
            qr_code_url: setup.qrCodeUrl,
            backup_codes: setup.backupCodes,
            warning: 'Save these backup codes - they will only be shown once!',
          },
        });
      } catch (error) {
        return handleAuthError(error, reply);
      }
    }
  );

  // POST /auth/mfa/verify-setup - Verify and activate MFA
  fastify.post(
    '/mfa/verify-setup',
    {
      preHandler: [authenticate, rateLimit({ max: 5, window: 300 })],
    },
    async (request: RequestWithUser, reply: FastifyReply) => {
      try {
        const body = MFAVerifySetupSchema.parse(request.body);
        await service.verifyMFASetup(request.user.id, body);
        return reply.send({ message: 'MFA enabled successfully' });
      } catch (error) {
        return handleAuthError(error, reply);
      }
    }
  );

  // POST /auth/mfa/challenge - Request MFA challenge
  fastify.post(
    '/mfa/challenge',
    {
      preHandler: [authenticate],
    },
    async (request: RequestWithUser, reply: FastifyReply) => {
      try {
        const challenge = await service.createMFAChallenge(request.user.id);
        return reply.send({
          data: {
            challenge_id: challenge.challengeId,
            device_id: challenge.deviceId,
            device_type: challenge.deviceType,
            expires_at: challenge.expiresAt,
          },
        });
      } catch (error) {
        return handleAuthError(error, reply);
      }
    }
  );

  // POST /auth/mfa/verify - Verify MFA code
  fastify.post(
    '/mfa/verify',
    {
      preHandler: [rateLimit({ max: 5, window: 300 })],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const body = MFAVerifySchema.parse(request.body);
        const result = await service.verifyMFAChallenge(body.challenge_id, body);
        
        // Issue tokens or complete login flow
        return reply.send({
          data: {
            user_id: result.userId,
            mfa_verified: true,
          },
        });
      } catch (error) {
        return handleAuthError(error, reply);
      }
    }
  );

  // GET /auth/mfa/devices - List MFA devices
  fastify.get(
    '/mfa/devices',
    {
      preHandler: [authenticate],
    },
    async (request: RequestWithUser, reply: FastifyReply) => {
      try {
        const devices = await service.listMFADevices(request.user.id);
        return reply.send({
          data: devices.map(d => ({
            id: d.id,
            type: d.device_type,
            name: d.device_name,
            verified: d.verified,
            is_primary: d.is_primary,
            last_used_at: d.last_used_at,
            created_at: d.created_at,
          })),
        });
      } catch (error) {
        return handleAuthError(error, reply);
      }
    }
  );

  // DELETE /auth/mfa/devices/:id - Remove MFA device
  fastify.delete(
    '/mfa/devices/:id',
    {
      preHandler: [authenticate, rateLimit({ max: 5, window: 300 })],
    },
    async (request: RequestWithUser, reply: FastifyReply) => {
      try {
        const params = request.params as { id: string };
        const body = (request.body || {}) as { mfa_code?: string };
        const { ip } = getClientInfo(request);
        await service.removeMFADevice(
          params.id,
          request.user.id,
          body.mfa_code,
          ip,
          request.id,
        );
        return reply.status(204).send();
      } catch (error) {
        return handleAuthError(error, reply);
      }
    }
  );

  // PATCH /auth/mfa/devices/:id/primary - Set primary device
  fastify.patch(
    '/mfa/devices/:id/primary',
    {
      preHandler: [authenticate],
    },
    async (request: RequestWithUser, reply: FastifyReply) => {
      try {
        const params = request.params as { id: string };
        await service.setPrimaryMFADevice(request.user.id, params.id);
        return reply.send({ message: 'Primary device updated' });
      } catch (error) {
        return handleAuthError(error, reply);
      }
    }
  );

  // POST /auth/mfa/backup-codes - Generate new backup codes
  fastify.post(
    '/mfa/backup-codes',
    {
      preHandler: [authenticate, rateLimit({ max: 3, window: 86400 })], // Once per day
    },
    async (request: RequestWithUser, reply: FastifyReply) => {
      try {
        const body = request.body as { mfa_code: string };
        const codes = await service.generateNewBackupCodes(request.user.id, body.mfa_code);
        return reply.send({
          data: {
            backup_codes: codes,
            warning: 'Save these immediately - they will only be shown once!',
          },
        });
      } catch (error) {
        return handleAuthError(error, reply);
      }
    }
  );

  // POST /auth/mfa/backup-codes/verify - Verify backup code
  fastify.post(
    '/mfa/backup-codes/verify',
    {
      preHandler: [rateLimit({ max: 5, window: 300 })],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const body = BackupCodeVerificationSchema.parse(request.body);
        const valid = await service.verifyBackupCode(body.user_id, body);
        
        if (!valid) {
          return reply.status(401).send({
            error: { code: 'INVALID_CODE', message: 'Invalid or used backup code' },
          });
        }
        
        return reply.send({ valid: true });
      } catch (error) {
        return handleAuthError(error, reply);
      }
    }
  );

  // POST /auth/mfa/disable - Disable MFA
  fastify.post(
    '/mfa/disable',
    {
      preHandler: [authenticate, rateLimit({ max: 3, window: 3600 })],
    },
    async (request: RequestWithUser, reply: FastifyReply) => {
      try {
        const body = request.body as { mfa_code: string };
        const { ip } = getClientInfo(request);
        await service.disableMFA(request.user.id, body.mfa_code, ip, request.id);
        return reply.send({ message: 'MFA disabled successfully' });
      } catch (error) {
        return handleAuthError(error, reply);
      }
    }
  );
}

// ============================================
// SESSION ROUTES
// ============================================

async function sessionRoutes(fastify: FastifyInstance) {
  // GET /auth/sessions - List active sessions
  fastify.get(
    '/sessions',
    {
      preHandler: [authenticate],
    },
    async (request: RequestWithUser, reply: FastifyReply) => {
      try {
        const sessions = await service.listUserSessions(request.user.id, request.user.sessionId);
        return reply.send({ data: sessions });
      } catch (error) {
        return handleAuthError(error, reply);
      }
    }
  );

  // DELETE /auth/sessions/:id - Revoke specific session
  fastify.delete(
    '/sessions/:id',
    {
      preHandler: [authenticate],
    },
    async (request: RequestWithUser, reply: FastifyReply) => {
      try {
        const params = request.params as { id: string };
        await service.revokeSession(request.user.id, params.id, request.user.sessionId);
        return reply.status(204).send();
      } catch (error) {
        return handleAuthError(error, reply);
      }
    }
  );

  // DELETE /auth/sessions/others - Revoke all other sessions
  fastify.delete(
    '/sessions/others',
    {
      preHandler: [authenticate],
    },
    async (request: RequestWithUser, reply: FastifyReply) => {
      try {
        const count = await service.revokeAllOtherSessions(request.user.id, request.user.sessionId);
        return reply.send({ message: `Revoked ${count} other sessions` });
      } catch (error) {
        return handleAuthError(error, reply);
      }
    }
  );

  // POST /auth/sessions/refresh - Refresh access token
  fastify.post(
    '/sessions/refresh',
    {
      preHandler: [rateLimit({ max: 10, window: 60 })],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const { ip, userAgent } = getClientInfo(request);
        const body = request.body as { refresh_token: string };
        const result = await service.refreshAccessToken(body.refresh_token, ip, userAgent);

        return reply.send({
          data: {
            access_token: result.accessToken,
            refresh_token: result.refreshToken,
            expires_at: result.expiresAt,
            token_type: 'Bearer',
          },
        });
      } catch (error) {
        return handleAuthError(error, reply);
      }
    }
  );

  // POST /auth/logout - Logout current session
  fastify.post(
    '/logout',
    {
      preHandler: [authenticate],
    },
    async (request: RequestWithUser, reply: FastifyReply) => {
      try {
        await service.logout(request.user.sessionId);
        return reply.status(204).send();
      } catch (error) {
        return handleAuthError(error, reply);
      }
    }
  );
}

// ============================================
// MAIN EXPORT
// ============================================

export default async function authRoutes(fastify: FastifyInstance) {
  // Health check for auth module
  fastify.get('/health', async () => ({ status: 'ok', module: 'auth' }));
  
  await fastify.register(credentialRoutes, { prefix: '' });
  await fastify.register(userRoutes, { prefix: '' });
  await fastify.register(mfaRoutes, { prefix: '' });
  await fastify.register(sessionRoutes, { prefix: '' });
}
