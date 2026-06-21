import { authenticate } from '../../shared/middleware/auth.js';
import { getClientInfo } from '../../shared/utils/request.js';
import { handleAuthError } from './routes.js';
import { isLinkableProvider } from './identity-link.config.js';
import { getRefreshCookieOptions, REFRESH_COOKIE_NAME, } from './utils.js';
import { ssoCallbackRateLimit, loginRateLimit } from './rate-limits.js';
import { SocialLoginSchema, SsoCallbackQuerySchema } from './types.js';
import * as socialLogin from './social-login.service.js';
import * as samlSlo from './saml-slo.service.js';
import * as scim from '../scim/scim.service.js';
import { authenticateScim } from '../scim/scim.middleware.js';
function setRefreshCookie(reply, refreshToken, expiresAt) {
    reply.setCookie(REFRESH_COOKIE_NAME, refreshToken, {
        ...getRefreshCookieOptions(),
        expires: expiresAt,
    });
}
export default async function phase7Routes(fastify) {
    // POST /auth/login/social/:provider — passwordless login via linked identity
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
    // GET /auth/login/social/callback — OAuth redirect completion
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
    // POST /auth/saml/logout — SP-initiated SAML SLO URL (session still active)
    fastify.post('/saml/logout', { preHandler: [authenticate] }, async (request, reply) => {
        try {
            const r = request;
            const ci = getClientInfo(request);
            const result = await samlSlo.startSamlSingleLogout(r.user.id, r.user.sessionId, ci.ip, request.id);
            return reply.send({ data: result });
        }
        catch (error) {
            return handleAuthError(error, reply, request);
        }
    });
    // POST /auth/saml/slo — SAML Single Logout endpoint (IdP/SP POST binding)
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
    // SCIM 2.0 — mounted under /auth/scim/v2/:orgId for same API host
    const scimOpts = { preHandler: [authenticateScim] };
    fastify.get('/scim/v2/:orgId/ServiceProviderConfig', scimOpts, async (request, reply) => {
        return reply.send(scim.serviceProviderConfig());
    });
    fastify.get('/scim/v2/:orgId/ResourceTypes', scimOpts, async (request, reply) => {
        return reply.send(scim.resourceTypes());
    });
    fastify.get('/scim/v2/:orgId/Schemas', scimOpts, async (request, reply) => {
        return reply.send(scim.schemas());
    });
    fastify.get('/scim/v2/:orgId/Users', scimOpts, async (request, reply) => {
        try {
            const { orgId } = request.params;
            const query = request.query;
            const list = await scim.listUsers(orgId, {
                startIndex: query.startIndex ? parseInt(query.startIndex, 10) : 1,
                count: query.count ? parseInt(query.count, 10) : 100,
                ...(query.filter !== undefined ? { filter: query.filter } : {}),
            });
            return reply.send(list);
        }
        catch (error) {
            return scim.handleScimError(error, reply);
        }
    });
    fastify.get('/scim/v2/:orgId/Users/:id', scimOpts, async (request, reply) => {
        try {
            const { orgId, id } = request.params;
            const user = await scim.getUser(orgId, id);
            return reply.send(user);
        }
        catch (error) {
            return scim.handleScimError(error, reply);
        }
    });
    fastify.post('/scim/v2/:orgId/Users', scimOpts, async (request, reply) => {
        try {
            const { orgId } = request.params;
            const created = await scim.createUser(orgId, request.body);
            return reply.status(201).send(created);
        }
        catch (error) {
            return scim.handleScimError(error, reply);
        }
    });
    fastify.patch('/scim/v2/:orgId/Users/:id', scimOpts, async (request, reply) => {
        try {
            const { orgId, id } = request.params;
            const updated = await scim.patchUser(orgId, id, request.body);
            return reply.send(updated);
        }
        catch (error) {
            return scim.handleScimError(error, reply);
        }
    });
    fastify.delete('/scim/v2/:orgId/Users/:id', scimOpts, async (request, reply) => {
        try {
            const { orgId, id } = request.params;
            await scim.deleteUser(orgId, id);
            return reply.status(204).send();
        }
        catch (error) {
            return scim.handleScimError(error, reply);
        }
    });
}
//# sourceMappingURL=phase7.routes.js.map