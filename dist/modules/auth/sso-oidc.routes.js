import { authenticate, requireStepUp, } from '../../shared/middleware/auth.js';
import { getClientInfo } from '../../shared/utils/request.js';
import { handleAuthError } from './routes.js';
import { buildConfiguredCallbackUrl, getApiOidcCallbackUrl, } from './oauth-callback.config.js';
import { loginMfaRateLimit, ssoCallbackRateLimit, ssoLoginRateLimit, webauthnRateLimit, } from './rate-limits.js';
import * as sso from './sso.service.js';
import * as trusted from './trusted-device.service.js';
import * as webauthn from './webauthn.service.js';
import { getRefreshCookieOptions, REFRESH_COOKIE_NAME, } from './utils.js';
import { SsoCallbackQuerySchema, SsoLoginSchema, TrustDeviceSchema, WebAuthnLoginMfaOptionsSchema, WebAuthnLoginMfaVerifySchema, WebAuthnRegisterOptionsSchema, WebAuthnRegisterVerifySchema, } from './types.js';
function setRefreshCookie(reply, refreshToken, expiresAt) {
    reply.setCookie(REFRESH_COOKIE_NAME, refreshToken, {
        ...getRefreshCookieOptions(),
        expires: expiresAt,
    });
}
export default async function ssoOidcRoutes(fastify) {
    // POST /auth/sso/login
    fastify.post('/sso/login', { preHandler: [ssoLoginRateLimit] }, async (request, reply) => {
        try {
            const body = SsoLoginSchema.parse(request.body);
            const ci = getClientInfo(request);
            const result = await sso.startSsoLogin(body, ci.ip, ci.userAgent, request.id);
            return reply.send({ data: result });
        }
        catch (error) {
            return handleAuthError(error, reply, request);
        }
    });
    // GET /auth/sso/callback — OIDC redirect; sets refresh cookie + returns tokens
    fastify.get('/sso/callback', { preHandler: [ssoCallbackRateLimit] }, async (request, reply) => {
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
            const callbackUrl = buildConfiguredCallbackUrl(getApiOidcCallbackUrl(), request.url);
            const tokens = await sso.completeSsoCallback(callbackUrl, ci.ip, ci.userAgent, request.id);
            setRefreshCookie(reply, tokens.refresh_token, tokens.expires_at);
            return reply.send({ data: tokens });
        }
        catch (error) {
            return handleAuthError(error, reply, request);
        }
    });
    // WebAuthn registration (authenticated)
    fastify.post('/mfa/webauthn/register/options', { preHandler: [authenticate, webauthnRateLimit] }, async (request, reply) => {
        try {
            const r = request;
            const body = WebAuthnRegisterOptionsSchema.parse(request.body);
            const result = await webauthn.createWebAuthnRegistrationOptions(r.user.id, body.device_name);
            return reply.send({ data: result });
        }
        catch (error) {
            return handleAuthError(error, reply, request);
        }
    });
    fastify.post('/mfa/webauthn/register/verify', { preHandler: [authenticate, requireStepUp, webauthnRateLimit] }, async (request, reply) => {
        try {
            const r = request;
            const body = WebAuthnRegisterVerifySchema.parse(request.body);
            const ci = getClientInfo(request);
            const result = await webauthn.verifyWebAuthnRegistration(r.user.id, body, ci.ip, request.id);
            return reply.send({ data: result });
        }
        catch (error) {
            return handleAuthError(error, reply, request);
        }
    });
    // Login MFA via passkey
    fastify.post('/login/mfa/webauthn/options', { preHandler: [loginMfaRateLimit] }, async (request, reply) => {
        try {
            const body = WebAuthnLoginMfaOptionsSchema.parse(request.body);
            const result = await webauthn.createLoginMfaWebAuthnOptions(body.challenge_id);
            return reply.send({ data: result });
        }
        catch (error) {
            return handleAuthError(error, reply, request);
        }
    });
    fastify.post('/login/mfa/webauthn/verify', { preHandler: [loginMfaRateLimit] }, async (request, reply) => {
        try {
            const body = WebAuthnLoginMfaVerifySchema.parse(request.body);
            const ci = getClientInfo(request);
            const tokens = await webauthn.verifyLoginMfaWebAuthn(body, ci.ip, ci.userAgent, 'web', request.id);
            setRefreshCookie(reply, tokens.refresh_token, tokens.expires_at);
            return reply.send({ data: tokens });
        }
        catch (error) {
            return handleAuthError(error, reply, request);
        }
    });
    // Trusted devices
    fastify.get('/trusted-devices', { preHandler: [authenticate] }, async (request, reply) => {
        try {
            const r = request;
            const devices = await trusted.listTrustedDevices(r.user.id);
            return reply.send({ data: devices });
        }
        catch (error) {
            return handleAuthError(error, reply, request);
        }
    });
    fastify.post('/trusted-devices', { preHandler: [authenticate, requireStepUp] }, async (request, reply) => {
        try {
            const r = request;
            const body = TrustDeviceSchema.parse(request.body ?? {});
            const ci = getClientInfo(request);
            const result = await trusted.trustCurrentDevice(r.user.id, ci.ip, ci.userAgent, body.device_name, request.id);
            return reply.send({ data: result });
        }
        catch (error) {
            return handleAuthError(error, reply, request);
        }
    });
    fastify.delete('/trusted-devices/:id', { preHandler: [authenticate] }, async (request, reply) => {
        try {
            const r = request;
            const { id } = request.params;
            const ci = getClientInfo(request);
            await trusted.revokeTrustedDevice(r.user.id, id, ci.ip, request.id);
            return reply.status(204).send();
        }
        catch (error) {
            return handleAuthError(error, reply, request);
        }
    });
}
//# sourceMappingURL=sso-oidc.routes.js.map