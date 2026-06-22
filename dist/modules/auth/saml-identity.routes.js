import { authenticate, requireStepUp, } from '../../shared/middleware/auth.js';
import { getClientInfo } from '../../shared/utils/request.js';
import { handleAuthError } from './routes.js';
import * as identityLink from './identity-link.service.js';
import { isLinkableProvider } from './identity-link.config.js';
import { buildConfiguredCallbackUrl, getApiIdentityLinkCallbackUrl, } from './oauth-callback.config.js';
import * as saml from './saml.service.js';
import { getRefreshCookieOptions, REFRESH_COOKIE_NAME, } from './utils.js';
import { ssoCallbackRateLimit, webauthnRateLimit, } from './rate-limits.js';
import { SsoCallbackQuerySchema } from './types.js';
function setRefreshCookie(reply, refreshToken, expiresAt) {
    reply.setCookie(REFRESH_COOKIE_NAME, refreshToken, {
        ...getRefreshCookieOptions(),
        expires: expiresAt,
    });
}
export default async function samlIdentityRoutes(fastify) {
    // GET /auth/saml/metadata — SP metadata for IdP configuration
    fastify.get('/saml/metadata', async (_request, reply) => {
        const xml = saml.generateSpMetadata();
        return reply.type('application/xml').send(xml);
    });
    // POST /auth/saml/acs — SAML Assertion Consumer Service (IdP POST binding)
    fastify.post('/saml/acs', {
        preHandler: [ssoCallbackRateLimit],
        config: { rawBody: true },
    }, async (request, reply) => {
        try {
            const body = request.body;
            if (!body?.SAMLResponse) {
                return reply.status(400).send({
                    error: {
                        code: 'SAML_RESPONSE_INVALID',
                        message: 'Missing SAMLResponse',
                    },
                });
            }
            const ci = getClientInfo(request);
            const tokens = await saml.completeSamlAcs({
                SAMLResponse: body.SAMLResponse,
                ...(body.RelayState !== undefined ? { RelayState: body.RelayState } : {}),
            }, ci.ip, ci.userAgent, request.id);
            setRefreshCookie(reply, tokens.refresh_token, tokens.expires_at);
            return reply.send({ data: tokens });
        }
        catch (error) {
            return handleAuthError(error, reply, request);
        }
    });
    // GET /auth/identity-providers — linked social accounts
    fastify.get('/identity-providers', { preHandler: [authenticate] }, async (request, reply) => {
        try {
            const r = request;
            const links = await identityLink.listUserLinkedIdentities(r.user.id);
            return reply.send({ data: links });
        }
        catch (error) {
            return handleAuthError(error, reply, request);
        }
    });
    // POST /auth/identity-providers/:provider/link — start OAuth link (step-up required)
    fastify.post('/identity-providers/:provider/link', { preHandler: [authenticate, requireStepUp, webauthnRateLimit] }, async (request, reply) => {
        try {
            const r = request;
            const { provider } = request.params;
            if (!isLinkableProvider(provider)) {
                return reply.status(400).send({
                    error: {
                        code: 'VALIDATION_ERROR',
                        message: 'Provider must be google, github, or microsoft',
                    },
                });
            }
            const ci = getClientInfo(request);
            const result = await identityLink.startIdentityLink(r.user.id, provider, ci.ip, request.id);
            return reply.send({ data: result });
        }
        catch (error) {
            return handleAuthError(error, reply, request);
        }
    });
    // GET /auth/identity-providers/callback — OAuth redirect completion
    fastify.get('/identity-providers/callback', { preHandler: [ssoCallbackRateLimit] }, async (request, reply) => {
        try {
            const query = SsoCallbackQuerySchema.parse(request.query);
            if (query.error) {
                return reply.status(400).send({
                    error: {
                        code: 'IDENTITY_LINK_FAILED',
                        message: query.error_description || query.error,
                    },
                });
            }
            const ci = getClientInfo(request);
            const callbackUrl = buildConfiguredCallbackUrl(getApiIdentityLinkCallbackUrl(), request.url);
            const result = await identityLink.completeIdentityLink(callbackUrl, ci.ip, request.id);
            return reply.send({ data: result });
        }
        catch (error) {
            return handleAuthError(error, reply, request);
        }
    });
    // DELETE /auth/identity-providers/:id — unlink (step-up required)
    fastify.delete('/identity-providers/:id', { preHandler: [authenticate, requireStepUp] }, async (request, reply) => {
        try {
            const r = request;
            const { id } = request.params;
            const ci = getClientInfo(request);
            await identityLink.unlinkIdentity(r.user.id, id, ci.ip, request.id);
            return reply.status(204).send();
        }
        catch (error) {
            return handleAuthError(error, reply, request);
        }
    });
}
//# sourceMappingURL=saml-identity.routes.js.map