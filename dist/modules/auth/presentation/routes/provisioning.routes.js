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
import { socialPassport } from '../../application/services/passport-social.service.js';
function setRefreshCookie(reply, refreshToken, expiresAt) {
    reply.setCookie(REFRESH_COOKIE_NAME, refreshToken, {
        ...getRefreshCookieOptions(),
        expires: expiresAt,
    });
}
function frontendAuthCallbackUrl() {
    const base = (env.FRONTEND_URL || env.APP_URL).replace(/\/+$/, '');
    return `${base}/auth/callback`;
}
function frontendIdentityProvidersUrl() {
    const base = (env.FRONTEND_URL || env.APP_URL).replace(/\/+$/, '');
    return `${base}/settings/security`;
}
function buildFrontendErrorRedirect(path, code, message) {
    const url = new URL(path);
    url.searchParams.set('error', code);
    url.searchParams.set('message', message);
    return url.toString();
}
function getProviderScope(provider) {
    return provider === 'google'
        ? ['openid', 'email', 'profile']
        : ['read:user', 'user:email'];
}
async function runPassportAuthenticate(fastify, strategy, request, reply, options, callback) {
    const handler = socialPassport.authenticate(strategy, options, callback);
    await handler.call(fastify, request, reply);
}
export default async function provisioningRoutes(fastify) {
    fastify.post('/login/social/:provider', { preHandler: [loginRateLimit] }, async (request, reply) => {
        try {
            const { provider } = request.params;
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
            const result = await identityProviders.startSocialLogin(provider, body, ci.ip, ci.userAgent, request.id);
            return reply.send({ data: result });
        }
        catch (error) {
            return handleAuthError(error, reply, request);
        }
    });
    fastify.get('/login/social/:provider/authorize', { preHandler: [loginRateLimit] }, async (request, reply) => {
        try {
            const { provider } = request.params;
            const { state } = request.query;
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
                throw new AuthError('Invalid social login state', AuthErrorCodes.SOCIAL_LOGIN_FAILED, 400);
            }
            return await runPassportAuthenticate(fastify, provider, request, reply, {
                session: false,
                scope: getProviderScope(provider),
                state,
            });
        }
        catch (error) {
            return handleAuthError(error, reply, request);
        }
    });
    fastify.get('/login/social/callback', { preHandler: [ssoCallbackRateLimit] }, async (request, reply) => {
        try {
            const query = request.query;
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
                const target = flow.kind === 'login'
                    ? frontendAuthCallbackUrl()
                    : frontendIdentityProvidersUrl();
                return reply.redirect(buildFrontendErrorRedirect(target, query.error, query.error_description || query.error));
            }
            const ci = getClientInfo(request);
            await runPassportAuthenticate(fastify, flow.provider, request, reply, { session: false }, async (_req, callbackReply, err, profile) => {
                if (err || !profile) {
                    const target = flow.kind === 'login'
                        ? frontendAuthCallbackUrl()
                        : frontendIdentityProvidersUrl();
                    if (err) {
                        request.log.warn({ err, provider: flow.provider }, 'Social auth callback failed');
                    }
                    return callbackReply.redirect(buildFrontendErrorRedirect(target, 'SOCIAL_LOGIN_FAILED', 'Unable to verify identity provider response'));
                }
                if (flow.kind === 'login') {
                    const tokens = await identityProviders.completeSocialLogin(profile, flow, ci.ip, ci.userAgent, request.id);
                    setRefreshCookie(callbackReply, tokens.refresh_token, tokens.expires_at);
                    return callbackReply.redirect(frontendAuthCallbackUrl());
                }
                await identityProviders.completeIdentityLink(profile, flow, ci.ip, request.id);
                return callbackReply.redirect(frontendIdentityProvidersUrl());
            });
            return reply;
        }
        catch (error) {
            return handleAuthError(error, reply, request);
        }
    });
    fastify.post('/identity-providers/:provider/link', { preHandler: [authenticate] }, async (request, reply) => {
        try {
            const r = request;
            const { provider } = request.params;
            const ci = getClientInfo(request);
            const result = await identityProviders.startIdentityLink(r.user.id, provider, ci.ip, request.id);
            return reply.send({ data: result });
        }
        catch (error) {
            return handleAuthError(error, reply, request);
        }
    });
    fastify.get('/identity-providers/:provider/authorize', async (request, reply) => {
        try {
            const { provider } = request.params;
            const { state } = request.query;
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
                throw new AuthError('Invalid identity link state', AuthErrorCodes.IDENTITY_LINK_FAILED, 400);
            }
            return await runPassportAuthenticate(fastify, provider, request, reply, {
                session: false,
                scope: getProviderScope(provider),
                state,
            });
        }
        catch (error) {
            return handleAuthError(error, reply, request);
        }
    });
    fastify.get('/identity-providers', { preHandler: [authenticate] }, async (request, reply) => {
        try {
            const r = request;
            const result = await identityProviders.listIdentityProviders(r.user.id);
            return reply.send({ data: result });
        }
        catch (error) {
            return handleAuthError(error, reply, request);
        }
    });
    fastify.delete('/identity-providers/:linkId', { preHandler: [authenticate] }, async (request, reply) => {
        try {
            const r = request;
            const { linkId } = request.params;
            const ci = getClientInfo(request);
            await identityProviders.unlinkIdentityProvider(r.user.id, linkId, ci.ip, request.id);
            return reply.status(204).send();
        }
        catch (error) {
            return handleAuthError(error, reply, request);
        }
    });
    fastify.post('/saml/logout', { preHandler: [authenticate] }, async (request, reply) => {
        try {
            const r = request;
            const ci = getClientInfo(request);
            const result = await samlSlo.completeSamlLogoutForUser(r.user.id, r.user.sessionId, ci.ip, request.id);
            return reply.send({ data: result });
        }
        catch (error) {
            return handleAuthError(error, reply, request);
        }
    });
    fastify.post('/saml/slo', {
        preHandler: [ssoCallbackRateLimit],
        config: { rawBody: true },
    }, async (request, reply) => {
        try {
            const body = request.body;
            const ci = getClientInfo(request);
            const result = await samlSlo.handleSamlSingleLogout(body ?? {}, ci.ip, request.id);
            if (result.redirect_url) {
                return reply.redirect(result.redirect_url);
            }
            return reply.send({ data: { logged_out: result.logged_out } });
        }
        catch (error) {
            return handleAuthError(error, reply, request);
        }
    });
    await fastify.register(registerScimRoutes, { prefix: '/scim/v2' });
}
//# sourceMappingURL=provisioning.routes.js.map