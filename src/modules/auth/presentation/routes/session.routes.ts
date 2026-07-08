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
// SESSION ROUTES
// ============================================================================

export async function sessionRoutes(fastify: FastifyInstance) {
  // Route safety:
  // - Keep static segments above param routes.
  // - Constrain :id to UUID so it can never match `others` or other keywords.
  const UUID_PATH_SEGMENT = ':id([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})';

  // GET /auth/sessions
  fastify.get(
    '/sessions',
    { preHandler: [authenticate] },
    async (request, reply) => {
      try {
        const r = request as RequestWithUser;
        const sessions = await service.listUserSessions(
          r.user.id,
          r.user.sessionId,
        );
        return reply.send({ data: sessions });
      } catch (error: any) {
        return handleAuthError(error, reply, request);
      }
    },
  );

  // GET /auth/sessions/:id — session detail
  fastify.get(
    `/sessions/${UUID_PATH_SEGMENT}`,
    { preHandler: [authenticate] },
    async (request, reply) => {
      try {
        const r = request as RequestWithUser;
        const { id } = request.params as { id: string };
        const session = await service.getUserSessionDetail(
          r.user.id,
          id,
          r.user.sessionId,
        );
        return reply.send({ data: session });
      } catch (error: any) {
        return handleAuthError(error, reply, request);
      }
    },
  );

  fastify.delete(
    '/sessions',
    { preHandler: [authenticate] },
    async (request, reply) => {
      try {
        const r = request as RequestWithUser;
        const count = await service.revokeAllSessionsForUser(
          r.user.id,
        );
        clearRefreshCookies(reply);
        return reply.send({ data: { revoked: count } });
      } catch (error: any) {
        return handleAuthError(error, reply, request);
      }
    },
  );

  // DELETE /auth/sessions/others — revoke every OTHER active session.
  // Keep this static route above `/sessions/:id` deletes.
  fastify.delete(
    '/sessions/others',
    { preHandler: [authenticate] },
    async (request, reply) => {
      try {
        const r = request as RequestWithUser;
        const count = await service.revokeAllOtherSessions(
          r.user.id,
          r.user.sessionId,
        );
        return reply.send({ data: { revoked: count } });
      } catch (error: any) {
        return handleAuthError(error, reply, request);
      }
    },
  );

  // DELETE /auth/sessions/:id — revoke a specific (non-current) session.
  fastify.delete(
    `/sessions/${UUID_PATH_SEGMENT}`,
    { preHandler: [authenticate] },
    async (request, reply) => {
      try {
        const r = request as RequestWithUser;
        const { id } = r.params as { id: string };
        await service.revokeSession(r.user.id, id, r.user.sessionId);
        return reply.status(204).send();
      } catch (error: any) {
        return handleAuthError(error, reply, request);
      }
    },
  );

  // POST /auth/sessions/refresh — rotate refresh token.
  fastify.post('/sessions/refresh', { preHandler: [refreshSessionRateLimit] }, async (request, reply) => {
    try {
      const ci = getClientInfo(request);

      const raw = getRefreshCookieValue(request.cookies);
      if (!raw) {
        return reply.status(401).send({
          error: {
            code: 'MISSING_REFRESH_TOKEN',
            message: 'Refresh token cookie not found',
          },
        });
      }
      const unsigned = request.unsignCookie(raw);
      if (!unsigned.valid || !unsigned.value) {
        clearRefreshCookies(reply);
        return reply.status(401).send({
          error: {
            code: 'INVALID_REFRESH_TOKEN',
            message: 'Refresh token signature invalid',
          },
        });
      }

      const result = await service.refreshAccessToken(
        unsigned.value,
        ci.ip,
        ci.userAgent,
        request.id,
      );

      const refreshMaxAgeSeconds = Math.max(
        0,
        Math.ceil((result.expiresAt.getTime() - Date.now()) / 1000),
      );
      reply.setCookie(
        REFRESH_COOKIE_NAME,
        result.refreshToken,
        getRefreshCookieOptions(refreshMaxAgeSeconds),
      );
      return reply.send({
        data: {
          access_token: result.accessToken,
          expires_at: result.expiresAt,
          session_id: result.sessionId,
          token_type: 'Bearer',
          current_org_id: result.currentOrgId,
        },
      });
    } catch (error: any) {
      if (
        error instanceof AuthError &&
        (error.code === AuthErrorCodes.REFRESH_TOKEN_REUSED ||
          error.code === AuthErrorCodes.SESSION_EXPIRED ||
          error.code === AuthErrorCodes.SESSION_INVALID)
      ) {
        clearRefreshCookies(reply);
      }
      return handleAuthError(error, reply, request);
    }
  });

  // POST /auth/logout
  fastify.post(
    '/logout',
    { preHandler: [authenticate] },
    async (request, reply) => {
      try {
        const r = request as RequestWithUser;
        const { ip } = getClientInfo(r);
        const result = await service.logout(
          r.user.id,
          r.user.sessionId,
          ip,
          r.id,
        );
        clearRefreshCookies(reply);
        return reply.send({ data: result });
      } catch (error: any) {
        return handleAuthError(error, reply, request);
      }
    },
  );
}
