/**
 * Enterprise SSO (OIDC), WebAuthn/passkeys, and trusted-device routes.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

import {
  authenticate,
  requireStepUp,
} from '../../../../shared/middleware/auth.js';
import { getClientInfo } from '../../../../shared/utils/request.js';

import { handleAuthError } from './index.js';
import {
  buildConfiguredCallbackUrl,
  getApiOidcCallbackUrl,
} from '../../infrastructure/config/oauth-callback.config.js';
import {
  loginMfaRateLimit,
  ssoCallbackRateLimit,
  ssoLoginRateLimit,
  webauthnRateLimit,
} from '../../presentation/middleware/rate-limits.js';
import * as sso from '../../application/services/sso.service.js';
import * as trusted from '../../application/services/trusted-device.service.js';
import * as webauthn from '../../application/services/webauthn.service.js';
import { getRefreshCookieOptions, REFRESH_COOKIE_NAME } from '../../presentation/cookies.js';
import { env } from '../../../../config/env.js';
import {
  SsoCallbackQuerySchema,
  SsoLoginSchema,
  TrustDeviceSchema,
  WebAuthnLoginMfaOptionsSchema,
  WebAuthnLoginMfaVerifySchema,
  WebAuthnRegisterOptionsSchema,
  WebAuthnRegisterVerifySchema,
} from '../../domain/types.js';

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

function setRefreshCookie(
  reply: FastifyReply,
  refreshToken: string,
  expiresAt: Date,
): void {
  reply.setCookie(REFRESH_COOKIE_NAME, refreshToken, {
    ...getRefreshCookieOptions(),
    expires: expiresAt,
  });
}

function frontendAuthCallbackUrl(): string {
  const base = (env.FRONTEND_URL || env.APP_URL).replace(/\/+$/, '');
  return `${base}/auth/callback`;
}

export default async function ssoOidcRoutes(fastify: FastifyInstance) {
  // POST /auth/sso/login
  fastify.post(
    '/sso/login',
    { preHandler: [ssoLoginRateLimit] },
    async (request, reply) => {
      try {
        const body = SsoLoginSchema.parse(request.body);
        const ci = getClientInfo(request);
        const result = await sso.startSsoLogin(
          body,
          ci.ip,
          ci.userAgent,
          request.id,
        );
        return reply.send({ data: result });
      } catch (error: any) {
        return handleAuthError(error, reply, request);
      }
    },
  );

  // GET /auth/sso/callback — OIDC redirect; sets refresh cookie + returns tokens
  fastify.get(
    '/sso/callback',
    { preHandler: [ssoCallbackRateLimit] },
    async (request, reply) => {
      try {
        const query = SsoCallbackQuerySchema.parse(request.query);
        if (query.error) {
          return reply.status(400).send({
            error: {
              code: 'OIDC_CALLBACK_INVALID',
              message: query.error_description || query.error,
            },
          });
        }
        const ci = getClientInfo(request);
        const callbackUrl = buildConfiguredCallbackUrl(
          getApiOidcCallbackUrl(),
          request.url,
        );
        const tokens = await sso.completeSsoCallback(
          callbackUrl,
          ci.ip,
          ci.userAgent,
          request.id,
        );
        setRefreshCookie(reply, tokens.refresh_token, tokens.expires_at);
        return reply.redirect(frontendAuthCallbackUrl());
      } catch (error: any) {
        return handleAuthError(error, reply, request);
      }
    },
  );

  // WebAuthn registration (authenticated)
  fastify.post(
    '/mfa/webauthn/register/options',
    { preHandler: [authenticate, webauthnRateLimit] },
    async (request, reply) => {
      try {
        const r = request as RequestWithUser;
        const body = WebAuthnRegisterOptionsSchema.parse(request.body);
        const result = await webauthn.createWebAuthnRegistrationOptions(
          r.user.id,
          body.device_name,
        );
        return reply.send({ data: result });
      } catch (error: any) {
        return handleAuthError(error, reply, request);
      }
    },
  );

  fastify.post(
    '/mfa/webauthn/register/verify',
    { preHandler: [authenticate, requireStepUp, webauthnRateLimit] },
    async (request, reply) => {
      try {
        const r = request as RequestWithUser;
        const body = WebAuthnRegisterVerifySchema.parse(request.body);
        const ci = getClientInfo(request);
        const result = await webauthn.verifyWebAuthnRegistration(
          r.user.id,
          body,
          ci.ip,
          request.id,
        );
        return reply.send({ data: result });
      } catch (error: any) {
        return handleAuthError(error, reply, request);
      }
    },
  );

  // Login MFA via passkey
  fastify.post(
    '/login/mfa/webauthn/options',
    { preHandler: [loginMfaRateLimit] },
    async (request, reply) => {
      try {
        const body = WebAuthnLoginMfaOptionsSchema.parse(request.body);
        const result = await webauthn.createLoginMfaWebAuthnOptions(
          body.challenge_id,
        );
        return reply.send({ data: result });
      } catch (error: any) {
        return handleAuthError(error, reply, request);
      }
    },
  );

  fastify.post(
    '/login/mfa/webauthn/verify',
    { preHandler: [loginMfaRateLimit] },
    async (request, reply) => {
      try {
        const body = WebAuthnLoginMfaVerifySchema.parse(request.body);
        const ci = getClientInfo(request);
        const tokens = await webauthn.verifyLoginMfaWebAuthn(
          body,
          ci.ip,
          ci.userAgent,
          'web',
          request.id,
        );
        setRefreshCookie(reply, tokens.refresh_token, tokens.expires_at);
        return reply.send({ data: tokens });
      } catch (error: any) {
        return handleAuthError(error, reply, request);
      }
    },
  );

  // Trusted devices
  fastify.get(
    '/trusted-devices',
    { preHandler: [authenticate] },
    async (request, reply) => {
      try {
        const r = request as RequestWithUser;
        const devices = await trusted.listTrustedDevices(r.user.id);
        return reply.send({ data: devices });
      } catch (error: any) {
        return handleAuthError(error, reply, request);
      }
    },
  );

  fastify.post(
    '/trusted-devices',
    { preHandler: [authenticate, requireStepUp] },
    async (request, reply) => {
      try {
        const r = request as RequestWithUser;
        const body = TrustDeviceSchema.parse(request.body ?? {});
        const ci = getClientInfo(request);
        const result = await trusted.trustCurrentDevice(
          r.user.id,
          ci.ip,
          ci.userAgent,
          body.device_name,
          request.id,
        );
        return reply.send({ data: result });
      } catch (error: any) {
        return handleAuthError(error, reply, request);
      }
    },
  );

  fastify.delete(
    '/trusted-devices/:id',
    { preHandler: [authenticate] },
    async (request, reply) => {
      try {
        const r = request as RequestWithUser;
        const { id } = request.params as { id: string };
        const ci = getClientInfo(request);
        await trusted.revokeTrustedDevice(
          r.user.id,
          id,
          ci.ip,
          request.id,
        );
        return reply.status(204).send();
      } catch (error: any) {
        return handleAuthError(error, reply, request);
      }
    },
  );
}
