/**
 * Auth Routes — Fastify HTTP layer.
 *
 * Responsibilities:
 *   - Validate request payloads with Zod schemas in types.ts.
 *   - Pull client metadata via getClientInfo (trust-proxy aware, no XFF
 *     spoofing — see shared/utils/request.ts).
 *   - Delegate all business decisions to service.ts.
 *   - Map AuthError -> HTTP responses without leaking internals.
 *
 * Refresh-token transport:
 *   - The refresh JWT lives in an httpOnly, signed, SameSite=None cookie.
 *   - Production/staging use `__Host-refresh_token` with Path=/, which forces
 *     Secure + no Domain attribute and blocks sibling-subdomain overwrite.
 *   - Development falls back to `refresh_token` because browsers reject
 *     `__Host-` cookies over plain HTTP.
 *
 * Rate limiting:
 *   - Scoped in-process LRU limits (rate-limits.ts) on sensitive auth routes.
 *   - Global Fastify rate limiter (app.ts) still applies as a backstop.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

import {
  authenticate,
  requireAdmin,
  requireStepUp,
} from '../../../../shared/middleware/auth.js';
import { getClientInfo } from '../../../../shared/utils/request.js';

import * as service from '../../application/services/index.js';
import {
  AuthError,
  AdminLockUserSchema,
  AuthErrorCodes,
  BackupCodeLoginSchema,
  ChangePasswordSchema,
  CreateUserSchema,
  DeleteUserSchema,
  ForgotPasswordSchema,
  ListUsersQuerySchema,
  LoginMFAVerifySchema,
  LoginSchema,
  MFADeviceRemoveSchema,
  MFADisableRequestSchema,
  MFASetupSchema,
  MFAToggleSchema,
  MFAVerifySchema,
  MFAVerifySetupSchema,
  EmailMfaResendSchema,
  RegenerateBackupCodesSchema,
  ResendVerificationSchema,
  ResetPasswordSchema,
  SuspendUserSchema,
  UpdateUserSchema,
  VerifyEmailConfirmSchema,
  VerifyEmailQuerySchema,
} from '../../domain/types.js';
import identityRoutes from './identity.routes.js';
import ssoOidcRoutes from './sso-oidc.routes.js';
import { OrganizationRepository } from '../../../organization/repository.js';
import * as authRepo from '../../infrastructure/repositories/index.js';
import accountAdministrationRoutes from './account-administration.routes.js';
import samlIdentityRoutes from './saml-identity.routes.js';
import provisioningRoutes from './provisioning.routes.js';
import {
  forgotPasswordRateLimit,
  loginMfaRateLimit,
  loginRateLimit,
  mfaEmailResendRateLimit,
  refreshSessionRateLimit,
  registerRateLimit,
  resendVerificationRateLimit,
  resetPasswordRateLimit,
  tokenConfirmRateLimit,
  verifyEmailRateLimit,
} from '../middleware/rate-limits.js';
import {
  getRefreshCookieNames,
  getRefreshCookieOptions,
  getRefreshCookieValue,
  REFRESH_COOKIE_NAME,
} from '../cookies.js';

interface RequestWithUser extends FastifyRequest {
  user: {
    id: string;
    email: string;
    isAdmin: boolean;
    sessionId: string;
    mfaVerified: boolean;
    stepUpFresh: boolean;
  };
}

function clearRefreshCookies(reply: FastifyReply): void {
  const options = getRefreshCookieOptions();
  for (const name of getRefreshCookieNames()) {
    reply.clearCookie(name, options);
  }
}


// ============================================================================
// ERROR HANDLER
// ============================================================================

export function handleAuthError(
  error: unknown,
  reply: FastifyReply,
  request: FastifyRequest,
): FastifyReply {
  if (error instanceof AuthError) {
    return reply.status(error.statusCode).send({
      error: {
        code: error.code,
        message: error.message,
        details: error.details,
      },
    });
  }

  const err = error as { name?: string; issues?: unknown };
  if (err?.name === 'ZodError') {
    return reply.status(400).send({
      error: {
        code: AuthErrorCodes.VALIDATION_ERROR,
        message: 'Invalid request payload',
        details: { issues: err.issues },
      },
    });
  }

  request.log.error({ err: error }, 'Unexpected auth error');
  return reply.status(500).send({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    },
  });
}

async function sendAuthSession(
  reply: FastifyReply,
  payload: {
    access_token: string;
    refresh_token: string;
    expires_at: Date;
    token_type: string;
    session_id: string;
    user_id?: string;
  },
): Promise<FastifyReply> {
  const maxAgeSeconds = Math.max(
    0,
    Math.ceil((payload.expires_at.getTime() - Date.now()) / 1000),
  );
  reply.setCookie(
    REFRESH_COOKIE_NAME,
    payload.refresh_token,
    getRefreshCookieOptions(maxAgeSeconds),
  );

  if (payload.user_id) {
    const user = await authRepo.findUserById(payload.user_id);
    const orgRepo = new OrganizationRepository();
    const orgContext = await orgRepo.getUserContextForLogin(payload.user_id);

    return reply.send({
      data: {
        access_token: payload.access_token,
        expires_at: payload.expires_at,
        token_type: payload.token_type,
        session_id: payload.session_id,
        user: user ? {
          id: user.id,
          email: user.email,
          name: user.full_name,
        } : undefined,
        default_org_slug: orgContext.default_org_slug,
        organizations: orgContext.organizations,
      },
    });
  }

  return reply.send({
    data: {
      access_token: payload.access_token,
      expires_at: payload.expires_at,
      token_type: payload.token_type,
      session_id: payload.session_id,
      user_id: payload.user_id,
    },
  });
}

function preventSensitiveResponseCaching(reply: FastifyReply): void {
  reply.header('Cache-Control', 'no-store, max-age=0');
  reply.header('Pragma', 'no-cache');
}


// ============================================================================
// USER ROUTES
// ============================================================================

export async function userRoutes(fastify: FastifyInstance) {
  // POST /auth/register
  // Always returns the same generic 201 message regardless of whether the
  // email is already registered. The service silently no-ops on collisions
  // and audits the probe.
  const register = async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = CreateUserSchema.parse(request.body);
      const { ip } = getClientInfo(request);
      await service.createUserFromEmail(body, ip, request.id);
      return reply.status(201).send({
        message:
          'Account creation request received. If the email is unused, you will receive a verification email shortly.',
      });
    } catch (error: any) {
      return handleAuthError(error, reply, request);
    }
  };

  fastify.post('/register', { preHandler: [registerRateLimit] }, register);
  fastify.post('/users', { preHandler: [registerRateLimit] }, register);

  // GET /auth/users/me
  fastify.get(
    '/users/me',
    { preHandler: [authenticate] },
    async (request, reply) => {
      try {
        const r = request as RequestWithUser;
        const profile = await service.getCurrentUser(r.user.id);
        return reply.send({ data: profile });
      } catch (error: any) {
        return handleAuthError(error, reply, request);
      }
    },
  );

  // GET /auth/users/me/security-summary
  fastify.get(
    '/users/me/security-summary',
    { preHandler: [authenticate] },
    async (request, reply) => {
      try {
        const r = request as RequestWithUser;
        const summary = await service.getUserSecuritySummary(r.user.id);
        return reply.send({ data: summary });
      } catch (error: any) {
        return handleAuthError(error, reply, request);
      }
    },
  );

  // PATCH /auth/users/me
  fastify.patch(
    '/users/me',
    { preHandler: [authenticate] },
    async (request, reply) => {
      try {
        const r = request as RequestWithUser;
        const body = UpdateUserSchema.parse(r.body);
        const profile = await service.updateCurrentUser(r.user.id, body);
        return reply.send({ data: profile });
      } catch (error: any) {
        return handleAuthError(error, reply, request);
      }
    },
  );

  // DELETE /auth/users/me
  fastify.delete(
    '/users/me',
    { preHandler: [authenticate, requireStepUp] },
    async (request, reply) => {
      try {
        const r = request as RequestWithUser;
        const body = DeleteUserSchema.parse(r.body);
        const { ip } = getClientInfo(r);
        await service.deleteCurrentUser(r.user.id, body, ip, r.id);
        return reply.status(204).send();
      } catch (error: any) {
        return handleAuthError(error, reply, request);
      }
    },
  );

  // GET /auth/users/:id (admin)
  fastify.get(
    '/users/:id',
    { preHandler: [authenticate, requireAdmin] },
    async (request, reply) => {
      try {
        const r = request as RequestWithUser;
        const { id } = r.params as { id: string };
        const profile = await service.getUserById(
          id,
          r.user.id,
          r.user.isAdmin,
        );
        return reply.send({ data: profile });
      } catch (error: any) {
        return handleAuthError(error, reply, request);
      }
    },
  );

  // GET /auth/users (admin)
  fastify.get(
    '/users',
    { preHandler: [authenticate, requireAdmin] },
    async (request, reply) => {
      try {
        const r = request as RequestWithUser;
        const filters = ListUsersQuerySchema.parse(r.query);
        const { users, total } = await service.listAllUsers(
          filters,
          r.user.isAdmin,
        );
        return reply.send({
          data: users,
          meta: { total, limit: filters.limit, offset: filters.offset },
        });
      } catch (error: any) {
        return handleAuthError(error, reply, request);
      }
    },
  );

  // POST /auth/users/:id/restore (admin)
  fastify.post(
    '/users/:id/restore',
    { preHandler: [authenticate, requireAdmin] },
    async (request, reply) => {
      try {
        const r = request as RequestWithUser;
        const { id } = r.params as { id: string };
        const { ip } = getClientInfo(r);
        const profile = await service.restoreDeletedUser(
          id,
          r.user.id,
          r.user.isAdmin,
          ip,
          r.id,
        );
        return reply.send({ data: profile });
      } catch (error: any) {
        return handleAuthError(error, reply, request);
      }
    },
  );

  // POST /auth/users/:id/suspend (admin)
  fastify.post(
    '/users/:id/suspend',
    { preHandler: [authenticate, requireAdmin] },
    async (request, reply) => {
      try {
        const r = request as RequestWithUser;
        const { id } = r.params as { id: string };
        const body = SuspendUserSchema.parse(r.body);
        const { ip } = getClientInfo(r);
        const profile = await service.suspendUser(
          id,
          body.reason,
          r.user.id,
          r.user.isAdmin,
          ip,
          r.id,
        );
        return reply.send({ data: profile });
      } catch (error: any) {
        return handleAuthError(error, reply, request);
      }
    },
  );

  // POST /auth/users/:id/unsuspend (admin)
  fastify.post(
    '/users/:id/unsuspend',
    { preHandler: [authenticate, requireAdmin] },
    async (request, reply) => {
      try {
        const r = request as RequestWithUser;
        const { id } = r.params as { id: string };
        const { ip } = getClientInfo(r);
        const profile = await service.unsuspendUser(
          id,
          r.user.id,
          r.user.isAdmin,
          ip,
          r.id,
        );
        return reply.send({ data: profile });
      } catch (error: any) {
        return handleAuthError(error, reply, request);
      }
    },
  );

  // POST /auth/users/:id/lock (admin)
  fastify.post(
    '/users/:id/lock',
    { preHandler: [authenticate, requireAdmin] },
    async (request, reply) => {
      try {
        const r = request as RequestWithUser;
        const { id } = r.params as { id: string };
        const body = AdminLockUserSchema.parse(r.body);
        const { ip } = getClientInfo(r);
        const profile = await service.adminLockUserAccount(
          id,
          body,
          r.user.id,
          r.user.isAdmin,
          ip,
          r.id,
        );
        return reply.send({ data: profile });
      } catch (error: any) {
        return handleAuthError(error, reply, request);
      }
    },
  );

  // POST /auth/users/:id/unlock (admin)
  fastify.post(
    '/users/:id/unlock',
    { preHandler: [authenticate, requireAdmin] },
    async (request, reply) => {
      try {
        const r = request as RequestWithUser;
        const { id } = r.params as { id: string };
        const { ip } = getClientInfo(r);
        const profile = await service.adminUnlockUserAccount(
          id,
          r.user.id,
          r.user.isAdmin,
          ip,
          r.id,
        );
        return reply.send({ data: profile });
      } catch (error: any) {
        return handleAuthError(error, reply, request);
      }
    },
  );

  // DELETE /auth/users/:id/sessions (admin) — revoke all sessions for target user
  fastify.delete(
    '/users/:id/sessions',
    { preHandler: [authenticate, requireAdmin] },
    async (request, reply) => {
      try {
        const r = request as RequestWithUser;
        const { id } = r.params as { id: string };
        const { ip } = getClientInfo(r);
        const result = await service.adminRevokeAllUserSessions(
          id,
          r.user.id,
          r.user.isAdmin,
          ip,
          r.id,
        );
        return reply.send({ data: result });
      } catch (error: any) {
        return handleAuthError(error, reply, request);
      }
    },
  );
}
