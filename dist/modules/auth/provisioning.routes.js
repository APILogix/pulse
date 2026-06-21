import { authenticate } from '../../shared/middleware/auth.js';
import { getClientInfo } from '../../shared/utils/request.js';
import { registerScimRoutes } from '../scim/scim.routes.js';
import { handleAuthError } from './routes.js';
import { isLinkableProvider } from './identity-link.config.js';
import { getRefreshCookieOptions, REFRESH_COOKIE_NAME, } from './utils.js';
import { ssoCallbackRateLimit, loginRateLimit } from './rate-limits.js';
import { SocialLoginSchema, SsoCallbackQuerySchema } from './types.js';
import * as socialLogin from './social-login.service.js';
import * as samlSlo from './saml-slo.service.js';
function setRefreshCookie(reply, refreshToken, expiresAt) {
    reply.setCookie(REFRESH_COOKIE_NAME, refreshToken, {
        ...getRefreshCookieOptions(),
        expires: expiresAt,
    });
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
            const result = await socialLogin.startSocialLogin(provider, body, ci.ip, ci.userAgent, request.id);
            return reply.send({ data: result });
        }
        catch (error) {
            return handleAuthError(error, reply, request);
        }
    });
    fastify.get('/login/social/callback', { preHandler: [ssoCallbackRateLimit] }, async (request, reply) => {
        try {
            const query = SsoCallbackQuerySchema.parse(request.query);
            if (query.error) {
                return reply.status(400).send({
                    error: {
                        code: 'SOCIAL_LOGIN_FAILED',
                        message: query.error_description || query.error,
                    },
                });
            }
            const ci = getClientInfo(request);
            const callbackUrl = request.url.startsWith('http')
                ? request.url
                : `${request.protocol}://${request.hostname}${request.url}`;
            const tokens = await socialLogin.completeSocialLogin(callbackUrl, ci.ip, ci.userAgent, request.id);
            setRefreshCookie(reply, tokens.refresh_token, tokens.expires_at);
            return reply.send({ data: tokens });
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