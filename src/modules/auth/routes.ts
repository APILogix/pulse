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
 *   - The refresh JWT lives in an httpOnly, signed, SameSite=Strict cookie
 *     named `__Host-refresh_token` with Path=/. This forces the browser to
 *     require Secure + no Domain attribute, blocking sibling-subdomain
 *     overwrite attacks.
 *
 * Rate limiting:
 *   - Per-route rate limiting has been removed at the team's direction. The
 *     global Fastify rate limiter (configured in app.ts) still applies. If
 *     you reintroduce per-route limits, do it via a preHandler shared with
 *     the rest of the platform.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

import {
  authenticate,
  requireAdmin,
  requireStepUp,
} from '../../shared/middleware/auth.js';
import { getClientInfo } from '../../shared/utils/request.js';

import * as service from './service.js';
import {
  AuthError,
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
  MFADisableConfirmSchema,
  MFADisableRequestSchema,
  MFASetupSchema,
  MFAToggleSchema,
  MFAVerifySchema,
  MFAVerifySetupSchema,
  RegenerateBackupCodesSchema,
  ResendVerificationSchema,
  ResetPasswordSchema,
  SuspendUserSchema,
  UpdateUserSchema,
  VerifyEmailQuerySchema,
} from './types.js';
import { getRefreshCookieOptions, REFRESH_COOKIE_NAME } from './utils.js';

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

// ============================================================================
// ERROR HANDLER
// ============================================================================

function handleAuthError(
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
): FastifyReply {
  reply.setCookie(
    REFRESH_COOKIE_NAME,
    payload.refresh_token,
    getRefreshCookieOptions(),
  );
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

// ============================================================================
// CREDENTIAL ROUTES
// ============================================================================

async function credentialRoutes(fastify: FastifyInstance) {
  // POST /auth/login
  fastify.post('/login', async (request, reply) => {
    try {
      const body = LoginSchema.parse(request.body);
      const ci = getClientInfo(request);
      const result = await service.loginWithEmailPassword(
        body,
        ci.ip,
        ci.userAgent,
        ci.device.type,
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
      return handleAuthError(error, reply, request);
    }
  });

  // POST /auth/login/mfa
  fastify.post('/login/mfa', async (request, reply) => {
    try {
      const body = LoginMFAVerifySchema.parse(request.body);
      const ci = getClientInfo(request);
      const result = await service.verifyLoginMFAChallenge(
        body,
        ci.ip,
        ci.userAgent,
        ci.device.type,
        request.id,
      );
      return sendAuthSession(reply, result);
    } catch (error) {
      return handleAuthError(error, reply, request);
    }
  });

  // POST /auth/login/backup-code
  fastify.post('/login/backup-code', async (request, reply) => {
    try {
      const body = BackupCodeLoginSchema.parse(request.body);
      const ci = getClientInfo(request);
      const result = await service.verifyLoginBackupCode(
        body,
        ci.ip,
        ci.userAgent,
        ci.device.type,
        request.id,
      );
      return sendAuthSession(reply, result);
    } catch (error) {
      return handleAuthError(error, reply, request);
    }
  });
}

// ============================================================================
// PASSWORD / EMAIL ROUTES
// ============================================================================

async function passwordRoutes(fastify: FastifyInstance) {
  const forgotPassword = async (
    request: FastifyRequest,
    reply: FastifyReply,
  ) => {
    try {
      const body = ForgotPasswordSchema.parse(request.body);
      const ci = getClientInfo(request);
      const result = await service.requestPasswordReset(
        body,
        ci.ip,
        request.id,
      );
      return reply.send({ data: result });
    } catch (error) {
      return handleAuthError(error, reply, request);
    }
  };

  const resetPassword = async (
    request: FastifyRequest,
    reply: FastifyReply,
  ) => {
    try {
      const body = ResetPasswordSchema.parse(request.body);
      const ci = getClientInfo(request);
      await service.resetPasswordWithToken(body, ci.ip, request.id);
      return reply.send({ message: 'Password reset successfully' });
    } catch (error) {
      return handleAuthError(error, reply, request);
    }
  };

  fastify.post('/forgot-password', forgotPassword);
  fastify.post('/password/forgot', forgotPassword);
  fastify.post('/reset-password', resetPassword);
  fastify.post('/password/reset', resetPassword);

  // POST /auth/resend-verification
  fastify.post('/resend-verification', async (request, reply) => {
    try {
      const body = ResendVerificationSchema.parse(request.body);
      const ci = getClientInfo(request);
      const result = await service.resendVerification(
        body,
        ci.ip,
        request.id,
      );
      return reply.send({ data: result });
    } catch (error) {
      return handleAuthError(error, reply, request);
    }
  });

  // GET /auth/verify-email
  fastify.get('/verify-email', async (request, reply) => {
    try {
      const query = VerifyEmailQuerySchema.parse(request.query);
      const ci = getClientInfo(request);
      const result = await service.verifyEmail(query, ci.ip, request.id);
      return reply.send({ data: result });
    } catch (error) {
      return handleAuthError(error, reply, request);
    }
  });

  // POST /auth/password/change
  // Requires: authenticated session AND fresh step-up MFA challenge.
  fastify.post(
    '/password/change',
    { preHandler: [authenticate, requireStepUp] },
    async (request, reply) => {
      try {
        const r = request as RequestWithUser;
        const body = ChangePasswordSchema.parse(r.body);
        const ci = getClientInfo(r);
        const session = await service.changePassword(
          r.user.id,
          r.user.sessionId,
          body,
          r.user.mfaVerified,
          ci.ip,
          ci.userAgent,
          r.id,
        );
        return sendAuthSession(reply, {
          ...session,
          token_type: 'Bearer',
        });
      } catch (error) {
        return handleAuthError(error, reply, request);
      }
    },
  );
}

// ============================================================================
// USER ROUTES
// ============================================================================

async function userRoutes(fastify: FastifyInstance) {
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
    } catch (error) {
      return handleAuthError(error, reply, request);
    }
  };

  fastify.post('/register', register);
  fastify.post('/users', register);

  // GET /auth/users/me
  fastify.get(
    '/users/me',
    { preHandler: [authenticate] },
    async (request, reply) => {
      try {
        const r = request as RequestWithUser;
        const profile = await service.getCurrentUser(r.user.id);
        return reply.send({ data: profile });
      } catch (error) {
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
      } catch (error) {
        return handleAuthError(error, reply, request);
      }
    },
  );

  // DELETE /auth/users/me
  fastify.delete(
    '/users/me',
    { preHandler: [authenticate] },
    async (request, reply) => {
      try {
        const r = request as RequestWithUser;
        const body = DeleteUserSchema.parse(r.body);
        const { ip } = getClientInfo(r);
        await service.deleteCurrentUser(r.user.id, body, ip, r.id);
        return reply.status(204).send();
      } catch (error) {
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
      } catch (error) {
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
      } catch (error) {
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
      } catch (error) {
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
      } catch (error) {
        return handleAuthError(error, reply, request);
      }
    },
  );
}

// ============================================================================
// MFA ROUTES
// ============================================================================

async function mfaRoutes(fastify: FastifyInstance) {
  // POST /auth/mfa/setup
  fastify.post(
    '/mfa/setup',
    { preHandler: [authenticate] },
    async (request, reply) => {
      try {
        const r = request as RequestWithUser;
        const body = MFASetupSchema.parse(r.body);
        const { ip } = getClientInfo(r);
        const setup = await service.setupMFA(r.user.id, body, ip);
        return reply.status(201).send({
          data: {
            device_id: setup.device_id,
            secret: setup.secret,
            qr_code_url: setup.qrCodeUrl,
            backup_codes: setup.backupCodes,
            warning: 'Save these backup codes - they will only be shown once!',
          },
        });
      } catch (error) {
        return handleAuthError(error, reply, request);
      }
    },
  );

  // POST /auth/mfa/verify-setup
  fastify.post(
    '/mfa/verify-setup',
    { preHandler: [authenticate] },
    async (request, reply) => {
      try {
        const r = request as RequestWithUser;
        const body = MFAVerifySetupSchema.parse(r.body);
        const { ip } = getClientInfo(r);
        await service.verifyMFASetup(r.user.id, body, ip, r.id);
        return reply.send({ message: 'MFA enabled successfully' });
      } catch (error) {
        return handleAuthError(error, reply, request);
      }
    },
  );

  // POST /auth/mfa/challenge — request a step-up MFA challenge
  fastify.post(
    '/mfa/challenge',
    { preHandler: [authenticate] },
    async (request, reply) => {
      try {
        const r = request as RequestWithUser;
        const challenge = await service.createMFAChallenge(r.user.id);
        return reply.send({
          data: {
            challenge_id: challenge.challengeId,
            device_id: challenge.deviceId,
            device_type: challenge.deviceType,
            expires_at: challenge.expiresAt,
          },
        });
      } catch (error) {
        return handleAuthError(error, reply, request);
      }
    },
  );

  // POST /auth/mfa/verify — complete a step-up MFA challenge
  fastify.post(
    '/mfa/verify',
    { preHandler: [authenticate] },
    async (request, reply) => {
      try {
        const r = request as RequestWithUser;
        const body = MFAVerifySchema.parse(r.body);
        const { ip } = getClientInfo(r);
        const result = await service.verifyMFAChallenge(
          body.challenge_id,
          body,
          r.user.sessionId,
          ip,
        );
        return reply.send({
          data: { user_id: result.userId, mfa_verified: true },
        });
      } catch (error) {
        return handleAuthError(error, reply, request);
      }
    },
  );

  // GET /auth/mfa/devices
  fastify.get(
    '/mfa/devices',
    { preHandler: [authenticate] },
    async (request, reply) => {
      try {
        const r = request as RequestWithUser;
        const devices = await service.listMFADevices(r.user.id);
        return reply.send({
          data: devices.map((d) => ({
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
        return handleAuthError(error, reply, request);
      }
    },
  );

  // DELETE /auth/mfa/devices/:id — requires fresh step-up MFA
  fastify.delete(
    '/mfa/devices/:id',
    { preHandler: [authenticate, requireStepUp] },
    async (request, reply) => {
      try {
        const r = request as RequestWithUser;
        const { id } = r.params as { id: string };
        const body = MFADeviceRemoveSchema.parse(r.body || {});
        const { ip } = getClientInfo(r);
        await service.removeMFADevice(
          r.user.id,
          id,
          body.current_password,
          ip,
          r.id,
        );
        return reply.status(204).send();
      } catch (error) {
        return handleAuthError(error, reply, request);
      }
    },
  );

  // PATCH /auth/mfa/devices/:id/primary — requires fresh step-up MFA
  fastify.patch(
    '/mfa/devices/:id/primary',
    { preHandler: [authenticate, requireStepUp] },
    async (request, reply) => {
      try {
        const r = request as RequestWithUser;
        const { id } = r.params as { id: string };
        await service.setPrimaryMFADevice(r.user.id, id);
        return reply.send({ message: 'Primary device updated' });
      } catch (error) {
        return handleAuthError(error, reply, request);
      }
    },
  );

  // POST /auth/mfa/backup-codes — regenerate
  fastify.post(
    '/mfa/backup-codes',
    { preHandler: [authenticate] },
    async (request, reply) => {
      try {
        const r = request as RequestWithUser;
        const body = RegenerateBackupCodesSchema.parse(r.body);
        const codes = await service.generateNewBackupCodes(r.user.id, body);
        return reply.send({
          data: {
            backup_codes: codes,
            warning: 'Save these immediately - they will only be shown once!',
          },
        });
      } catch (error) {
        return handleAuthError(error, reply, request);
      }
    },
  );

  // PATCH /auth/mfa/toggle — enabling only. Disabling uses the two-step
  // /mfa/disable/request + /mfa/disable/confirm flow below.
  fastify.patch(
    '/mfa/toggle',
    { preHandler: [authenticate] },
    async (request, reply) => {
      try {
        const r = request as RequestWithUser;
        const body = MFAToggleSchema.parse(r.body);
        const { ip } = getClientInfo(r);
        const result = await service.toggleMFA(r.user.id, body, ip, r.id);
        return reply.send({ data: { mfa_enabled: result.enabled } });
      } catch (error) {
        return handleAuthError(error, reply, request);
      }
    },
  );

  // POST /auth/mfa/disable/request — step 1 of MFA disable.
  // Requires authenticated session + valid TOTP. Sends an email with a
  // one-time confirmation link. MFA stays enabled until the link is used.
  fastify.post(
    '/mfa/disable/request',
    { preHandler: [authenticate] },
    async (request, reply) => {
      try {
        const r = request as RequestWithUser;
        const body = MFADisableRequestSchema.parse(r.body);
        const { ip } = getClientInfo(r);
        const result = await service.requestMfaDisable(
          r.user.id,
          body,
          ip,
          r.id,
        );
        return reply.send({ data: result });
      } catch (error) {
        return handleAuthError(error, reply, request);
      }
    },
  );

  // POST /auth/mfa/disable/confirm — step 2 of MFA disable.
  // Consumes the email-confirmation token and actually disables MFA.
  fastify.post('/mfa/disable/confirm', async (request, reply) => {
    try {
      const body = MFADisableConfirmSchema.parse(request.body);
      const ci = getClientInfo(request);
      await service.confirmMfaDisable(body, ci.ip, request.id);
      return reply.send({ message: 'MFA disabled successfully' });
    } catch (error) {
      return handleAuthError(error, reply, request);
    }
  });
}

// ============================================================================
// SESSION ROUTES
// ============================================================================

async function sessionRoutes(fastify: FastifyInstance) {
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
      } catch (error) {
        return handleAuthError(error, reply, request);
      }
    },
  );

  // DELETE /auth/sessions/others — revoke every OTHER active session.
  // (Listed BEFORE /sessions/:id so Fastify's matcher does not turn
  // "others" into the :id parameter.)
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
      } catch (error) {
        return handleAuthError(error, reply, request);
      }
    },
  );

  // DELETE /auth/sessions/:id — revoke a specific (non-current) session.
  fastify.delete(
    '/sessions/:id',
    { preHandler: [authenticate] },
    async (request, reply) => {
      try {
        const r = request as RequestWithUser;
        const { id } = r.params as { id: string };
        await service.revokeSession(r.user.id, id, r.user.sessionId);
        return reply.status(204).send();
      } catch (error) {
        return handleAuthError(error, reply, request);
      }
    },
  );

  // POST /auth/sessions/refresh — rotate refresh token.
  fastify.post('/sessions/refresh', async (request, reply) => {
    try {
      const ci = getClientInfo(request);

      const raw = request.cookies?.[REFRESH_COOKIE_NAME];
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
        reply.clearCookie(REFRESH_COOKIE_NAME, getRefreshCookieOptions());
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

      reply.setCookie(
        REFRESH_COOKIE_NAME,
        result.refreshToken,
        getRefreshCookieOptions(),
      );
      return reply.send({
        data: {
          access_token: result.accessToken,
          expires_at: result.expiresAt,
          session_id: result.sessionId,
          token_type: 'Bearer',
        },
      });
    } catch (error) {
      if (
        error instanceof AuthError &&
        (error.code === AuthErrorCodes.REFRESH_TOKEN_REUSED ||
          error.code === AuthErrorCodes.SESSION_EXPIRED ||
          error.code === AuthErrorCodes.SESSION_INVALID)
      ) {
        reply.clearCookie(REFRESH_COOKIE_NAME, getRefreshCookieOptions());
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
        await service.logout(r.user.id, r.user.sessionId, ip, r.id);
        reply.clearCookie(REFRESH_COOKIE_NAME, getRefreshCookieOptions());
        return reply.status(204).send();
      } catch (error) {
        return handleAuthError(error, reply, request);
      }
    },
  );
}

// ============================================================================
// MAIN EXPORT
// ============================================================================

export default async function authRoutes(fastify: FastifyInstance) {
  await fastify.register(credentialRoutes, { prefix: '' });
  await fastify.register(passwordRoutes, { prefix: '' });
  await fastify.register(userRoutes, { prefix: '' });
  await fastify.register(mfaRoutes, { prefix: '' });
  await fastify.register(sessionRoutes, { prefix: '' });
}
