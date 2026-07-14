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
// MFA ROUTES
// ============================================================================

export async function mfaRoutes(fastify: FastifyInstance) {
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

        if (setup.device_type === 'email') {
          // Email MFA: no QR code or secret — just backup codes and a
          // "check your email" prompt. The OTP was already sent by the service.
          return reply.status(201).send({
            data: {
              device_id: setup.device_id,
              device_type: 'email',
              
              warning: 'Save these backup codes - they will only be shown once!',
            },
          });
        }

        // TOTP
        return reply.status(201).send({
          data: {
            device_id: setup.device_id,
            device_type: 'totp',
            secret: (setup as { secret: string }).secret,
            qr_code_url: (setup as { qrCodeUrl: string }).qrCodeUrl,
            
            warning: 'Save these backup codes - they will only be shown once!',
          },
        });
      } catch (error: any) {
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
      } catch (error: any) {
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
      } catch (error: any) {
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
      } catch (error: any) {
        return handleAuthError(error, reply, request);
      }
    },
  );

  // POST /auth/mfa/email/resend — resend email OTP for setup or step-up.
  // Authenticated users only. Generates a fresh OTP and emails it.
  fastify.post(
    '/mfa/email/resend',
    { preHandler: [authenticate, mfaEmailResendRateLimit] },
    async (request, reply) => {
      try {
        const r = request as RequestWithUser;
        const body = EmailMfaResendSchema.parse(r.body);
        await service.resendEmailMfaOtp(r.user.id, body.device_id);
        return reply.send({ data: { message: 'Verification code sent' } });
      } catch (error: any) {
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
          data: devices.map((d: any) => ({
            id: d.id,
            type: d.device_type,
            name: d.device_name,
            display_hint: d.display_hint,
            verified: d.is_verified,
            is_primary: d.is_primary,
            last_used_at: d.last_used_at,
            created_at: d.created_at,
          })),
        });
      } catch (error: any) {
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
      } catch (error: any) {
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
      } catch (error: any) {
        return handleAuthError(error, reply, request);
      }
    },
  );

  // POST /auth/mfa/backup-codes — regenerate
  fastify.post(
    '/mfa/backup-codes',
    { preHandler: [authenticate, requireStepUp] },
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
      } catch (error: any) {
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
      } catch (error: any) {
        return handleAuthError(error, reply, request);
      }
    },
  );

  // POST /auth/mfa/disable/request — step 1 of MFA disable.
  // Requires authenticated session + valid TOTP. Sends an email with a
  // one-time confirmation link. MFA stays enabled until the link is used.
  fastify.post(
    '/mfa/disable',
    { preHandler: [authenticate, requireStepUp] },
    async (request, reply) => {
      try {
        const r = request as RequestWithUser;
        const body = MFADisableRequestSchema.parse(r.body || {});
        const { ip } = getClientInfo(r);
        const result = await service.disableMFA(
          r.user.id,
          body,
          ip,
          r.id,
        );
        return reply.send({ data: result });
      } catch (error: any) {
        return handleAuthError(error, reply, request);
      }
    },
  );

  fastify.post(
    '/mfa/disable/request',
    { preHandler: [authenticate, requireStepUp] },
    async (request, reply) => {
      try {
        const r = request as RequestWithUser;
        const body = MFADisableRequestSchema.parse(r.body || {});
        const { ip } = getClientInfo(r);
        const result = await service.disableMFA(
          r.user.id,
          body,
          ip,
          r.id,
        );
        return reply.send({ data: result });
      } catch (error: any) {
        return handleAuthError(error, reply, request);
      }
    },
  );

  // POST /auth/mfa/disable/confirm — step 2 of MFA disable.
  // Consumes the email-confirmation token and actually disables MFA.
  fastify.post(
    '/mfa/disable/confirm',
    { preHandler: [tokenConfirmRateLimit] },
    async (request, reply) => {
    try {
      return reply.status(410).send({
        error: {
          code: AuthErrorCodes.INVALID_OPERATION,
          message: 'MFA disable confirmation links are no longer supported. Use POST /auth/mfa/disable.',
        },
      });
    } catch (error: any) {
      return handleAuthError(error, reply, request);
    }
  },
  );
}

