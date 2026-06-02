/**
 * Passwordless login via previously linked Google/GitHub/Microsoft identities.
 */
import { randomState } from 'openid-client';
import { logAudit } from '../../shared/middleware/audit-logger.js';
import { socialLoginStateCache } from './cache.js';
import { isLinkableProvider, isProviderConfigured, } from './identity-link.config.js';
import { getApiSocialLoginCallbackUrl } from './oauth-callback.config.js';
import { buildOAuthAuthorizationUrl, createPkcePair, exchangeOAuthCallback, } from './oauth-exchange.js';
import { assertLoginAllowedByOrgPolicy } from './policy.service.js';
import * as repository from './repository.js';
import { issueSessionForUser } from './service.js';
import { AuthError, AuthErrorCodes } from './types.js';
function getSocialLoginCallbackUrl() {
    return getApiSocialLoginCallbackUrl();
}
export async function startSocialLogin(provider, input, ipAddress, userAgent, requestId) {
    if (!isLinkableProvider(provider)) {
        throw new AuthError('Unsupported provider', AuthErrorCodes.VALIDATION_ERROR, 400);
    }
    if (!isProviderConfigured(provider)) {
        throw new AuthError('Social login is not available', AuthErrorCodes.IDENTITY_PROVIDER_NOT_CONFIGURED, 503);
    }
    const { codeVerifier } = createPkcePair();
    const state = randomState();
    const redirectUri = getSocialLoginCallbackUrl();
    const authorizationUrl = await buildOAuthAuthorizationUrl({
        provider,
        redirectUri,
        state,
        codeVerifier,
    });
    socialLoginStateCache.set(state, {
        provider,
        codeVerifier,
        redirectUri,
        rememberMe: input.remember_me === true,
        ipAddress,
        userAgent,
        ...(input.device_name !== undefined ? { deviceName: input.device_name } : {}),
        ...(input.device_type !== undefined ? { clientDeviceType: input.device_type } : {}),
    });
    logAudit({
        user_id: null,
        org_id: null,
        action: 'user.social_login_started',
        resource_type: 'identity_provider',
        resource_id: provider,
        ip_address: ipAddress,
        request_id: requestId,
        user_agent: userAgent,
    });
    return { authorization_url: authorizationUrl, state };
}
export async function completeSocialLogin(callbackUrl, ipAddress, userAgent, requestId) {
    const url = new URL(callbackUrl);
    const state = url.searchParams.get('state');
    if (!state) {
        throw new AuthError('Invalid login session', AuthErrorCodes.SOCIAL_LOGIN_FAILED, 400);
    }
    const flow = socialLoginStateCache.get(state);
    if (!flow) {
        throw new AuthError('Login session expired; try again', AuthErrorCodes.SOCIAL_LOGIN_FAILED, 400);
    }
    socialLoginStateCache.delete(state);
    const profile = await exchangeOAuthCallback(flow.provider, callbackUrl, flow.codeVerifier, flow.redirectUri);
    const link = await repository.findLinkedIdentityByProviderSubject(flow.provider, profile.subject);
    if (!link) {
        throw new AuthError('Invalid email or password', AuthErrorCodes.INVALID_CREDENTIALS, 401);
    }
    const user = await repository.findUserById(link.user_id);
    if (!user || user.deleted_at || user.status !== 'active') {
        throw new AuthError('Invalid email or password', AuthErrorCodes.INVALID_CREDENTIALS, 401);
    }
    await repository.updateLinkedIdentityLastUsed(link.id);
    await assertLoginAllowedByOrgPolicy(user);
    const session = await issueSessionForUser({
        user,
        ipAddress: flow.ipAddress || ipAddress,
        userAgent: flow.userAgent || userAgent,
        deviceName: flow.deviceName,
        deviceType: flow.clientDeviceType || 'web',
        mfaVerified: true,
        rememberMe: flow.rememberMe,
        ssoContext: { loginMethod: `social_${flow.provider}` },
    });
    await repository.recordLogin(user.id, ipAddress, userAgent);
    logAudit({
        user_id: user.id,
        org_id: null,
        action: 'user.login_social',
        resource_type: 'user',
        resource_id: user.id,
        ip_address: ipAddress,
        user_agent: userAgent,
        request_id: requestId,
        metadata: { provider: flow.provider, session_id: session.sessionId },
    });
    return {
        access_token: session.accessToken,
        refresh_token: session.refreshToken,
        expires_at: session.expiresAt,
        token_type: 'Bearer',
        session_id: session.sessionId,
        user_id: user.id,
    };
}
//# sourceMappingURL=social-login.service.js.map