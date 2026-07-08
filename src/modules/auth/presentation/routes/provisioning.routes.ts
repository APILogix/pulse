/**
 * Identity lifecycle: SAML single logout, social login, SCIM (via shared registrar).
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';

import { authenticate } from '../../../../shared/middleware/auth.js';
import { getClientInfo } from '../../../../shared/utils/request.js';
import { registerScimRoutes } from '../../../scim/scim.routes.js';

import { handleAuthError } from './index.js';
import { isLinkableProvider } from '../../infrastructure/config/identity-link.config.js';
import { getRefreshCookieOptions, REFRESH_COOKIE_NAME } from '../../presentation/cookies.js';
import { env } from '../../../../config/env.js';
import { ssoCallbackRateLimit, loginRateLimit } from '../../presentation/middleware/rate-limits.js';
import { AuthError, AuthErrorCodes, SocialLoginSchema } from '../../domain/types.js';
import * as samlSlo from '../../application/services/saml-slo.service.js';
import * as identityProviders from '../../application/services/identity-provider.service.js';
import type { LinkableProvider } from '../../infrastructure/config/identity-link.config.js';
import { socialPassport } from '../../application/services/passport-social.service.js';

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
  reply: import('fastify').FastifyReply,
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

function frontendIdentityProvidersUrl(): string {
  const base = (env.FRONTEND_URL || env.APP_URL).replace(/\/+$/, '');
  return `${base}/settings/security`;
}

function buildFrontendErrorRedirect(
  path: string,
  code: string,
  message: string,
): string {
  const url = new URL(path);
  url.searchParams.set('error', code);
  url.searchParams.set('message', message);
  return url.toString();
}

function getProviderScope(provider: LinkableProvider): string[] {
  return provider === 'google'
    ? ['openid', 'email', 'profile']
    : ['read:user', 'user:email'];
}

async function runPassportAuthenticate(
  fastify: FastifyInstance,
  strategy: LinkableProvider,
  request: FastifyRequest,
  reply: import('fastify').FastifyReply,
  options: Record<string, unknown>,
  callback?: (
    request: FastifyRequest,
    reply: import('fastify').FastifyReply,
    err: Error | null,
    user?: unknown,
    info?: unknown,
    status?: number | number[],
  ) => Promise<void> | void,
): Promise<void> {
  const handler = socialPassport.authenticate(
    strategy,
    options as never,
    callback as never,
  );
  await handler.call(fastify, request, reply);
}

export default async function provisioningRoutes(fastify: FastifyInstance) {
  fastify.post(
    '/login/social/:provider',
    { preHandler: [loginRateLimit] },
    async (request, reply) => {
      try {
        const { provider } = request.params as { provider: string };
        if (!isLinkableProvider(provider)) {
          return reply.status(400).send({
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Provider must be google, github, or microsoft',
            },
          });
        }
        const body = SocialLoginSchema.parse(request.body ?? {});
        const ci = getClientInfo(request);
        const result = await identityProviders.startSocialLogin(
          provider,
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

  fastify.get(
    '/login/social/:provider/authorize',
    { preHandler: [loginRateLimit] },
    async (request, reply) => {
      try {
        const { provider } = request.params as { provider: string };
        const { state } = request.query as { state?: string };
        if (!isLinkableProvider(provider)) {
          return reply.status(400).send({
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Provider must be google or github',
            },
          });
        }
        const flow = identityProviders.resolveCallbackState(state ?? '');
        if (flow.kind !== 'login' || flow.provider !== provider) {
          throw new AuthError(
            'Invalid social login state',
            AuthErrorCodes.SOCIAL_LOGIN_FAILED,
            400,
          );
        }
        return await runPassportAuthenticate(
          fastify,
          provider,
          request,
          reply,
          {
            session: false,
            scope: getProviderScope(provider),
            state,
          },
        );
      } catch (error: any) {
        return handleAuthError(error, reply, request);
      }
    },
  );

  fastify.get(
    '/login/social/callback',
    { preHandler: [ssoCallbackRateLimit] },
    async (request, reply) => {
      try {
        const query = request.query as {
          state?: string;
          error?: string;
          error_description?: string;
        };
        if (!query.state) {
          return reply.status(400).send({
            error: {
              code: 'SOCIAL_LOGIN_FAILED',
              message: 'Missing login state',
            },
          });
        }
        const flow = identityProviders.consumeCallbackState(query.state);
        if (query.error) {
          const target =
            flow.kind === 'login'
              ? frontendAuthCallbackUrl()
              : frontendIdentityProvidersUrl();
          return reply.redirect(
            buildFrontendErrorRedirect(
              target,
              query.error,
              query.error_description || query.error,
            ),
          );
        }
        const ci = getClientInfo(request);
        await runPassportAuthenticate(
          fastify,
          flow.provider,
          request,
          reply,
          { session: false },
          async (_req, callbackReply, err, profile) => {
            if (err || !profile) {
              const target =
                flow.kind === 'login'
                  ? frontendAuthCallbackUrl()
                  : frontendIdentityProvidersUrl();
              if (err) {
                request.log.warn({ err, provider: flow.provider }, 'Social auth callback failed');
              }
              return callbackReply.redirect(
                buildFrontendErrorRedirect(
                  target,
                  'SOCIAL_LOGIN_FAILED',
                  'Unable to verify identity provider response',
                ),
              );
            }

            if (flow.kind === 'login') {
              const tokens = await identityProviders.completeSocialLogin(
                profile as import('../../application/services/passport-social.service.js').PassportSocialProfile,
                flow,
                ci.ip,
                ci.userAgent,
                request.id,
              );
              setRefreshCookie(callbackReply, tokens.refresh_token, tokens.expires_at);
              return callbackReply.redirect(frontendAuthCallbackUrl());
            }

            await identityProviders.completeIdentityLink(
              profile as import('../../application/services/passport-social.service.js').PassportSocialProfile,
              flow,
              ci.ip,
              request.id,
            );
            return callbackReply.redirect(frontendIdentityProvidersUrl());
          },
        );
        return reply;
      } catch (error: any) {
        return handleAuthError(error, reply, request);
      }
    },
  );

  fastify.post(
    '/identity-providers/:provider/link',
    { preHandler: [authenticate] },
    async (request, reply) => {
      try {
        const r = request as RequestWithUser;
        const { provider } = request.params as { provider: string };
        const ci = getClientInfo(request);
        const result = await identityProviders.startIdentityLink(
          r.user.id,
          provider,
          ci.ip,
          request.id,
        );
        return reply.send({ data: result });
      } catch (error: any) {
        return handleAuthError(error, reply, request);
      }
    },
  );

  fastify.get(
    '/identity-providers/:provider/authorize',
    async (request, reply) => {
      try {
        const { provider } = request.params as { provider: string };
        const { state } = request.query as { state?: string };
        if (!isLinkableProvider(provider)) {
          return reply.status(400).send({
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Provider must be google or github',
            },
          });
        }
        const flow = identityProviders.resolveCallbackState(state ?? '');
        if (flow.kind !== 'link' || flow.provider !== provider) {
          throw new AuthError(
            'Invalid identity link state',
            AuthErrorCodes.IDENTITY_LINK_FAILED,
            400,
          );
        }
        return await runPassportAuthenticate(
          fastify,
          provider,
          request,
          reply,
          {
            session: false,
            scope: getProviderScope(provider),
            state,
          },
        );
      } catch (error: any) {
        return handleAuthError(error, reply, request);
      }
    },
  );

  fastify.get(
    '/identity-providers',
    { preHandler: [authenticate] },
    async (request, reply) => {
      try {
        const r = request as RequestWithUser;
        const result = await identityProviders.listIdentityProviders(r.user.id);
        return reply.send({ data: result });
      } catch (error: any) {
        return handleAuthError(error, reply, request);
      }
    },
  );

  fastify.delete(
    '/identity-providers/:linkId',
    { preHandler: [authenticate] },
    async (request, reply) => {
      try {
        const r = request as RequestWithUser;
        const { linkId } = request.params as { linkId: string };
        const ci = getClientInfo(request);
        await identityProviders.unlinkIdentityProvider(
          r.user.id,
          linkId,
          ci.ip,
          request.id,
        );
        return reply.status(204).send();
      } catch (error: any) {
        return handleAuthError(error, reply, request);
      }
    },
  );

  fastify.post(
    '/saml/logout',
    { preHandler: [authenticate] },
    async (request, reply) => {
      try {
        const r = request as import('fastify').FastifyRequest & {
          user: { id: string; sessionId: string };
        };
        const ci = getClientInfo(request);
        const result = await samlSlo.completeSamlLogoutForUser(
          r.user.id,
          r.user.sessionId,
          ci.ip,
          request.id,
        );
        return reply.send({ data: result });
      } catch (error: any) {
        return handleAuthError(error, reply, request);
      }
    },
  );

  fastify.post(
    '/saml/slo',
    {
      preHandler: [ssoCallbackRateLimit],
      config: { rawBody: true },
    },
    async (request, reply) => {
      try {
        const body = request.body as {
          SAMLRequest?: string;
          SAMLResponse?: string;
          RelayState?: string;
        };
        const ci = getClientInfo(request);
        const result = await samlSlo.handleSamlSingleLogout(
          body ?? {},
          ci.ip,
          request.id,
        );
        if (result.redirect_url) {
          return reply.redirect(result.redirect_url);
        }
        return reply.send({ data: { logged_out: result.logged_out } });
      } catch (error: any) {
        return handleAuthError(error, reply, request);
      }
    },
  );

  await fastify.register(registerScimRoutes, { prefix: '/scim/v2' });
}
