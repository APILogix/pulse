import { randomUUID } from 'crypto';
import { logAudit } from '../../../../shared/middleware/audit-logger.js';
import { apiBaseUrl, getApiProviderAuthorizeUrl } from '../../infrastructure/config/oauth-callback.config.js';
import { identityLinkStateCache, socialLoginStateCache, } from '../../infrastructure/cache/auth.cache.js';
import { isLinkableProvider, isProviderConfigured, } from '../../infrastructure/config/identity-link.config.js';
import { assertLoginAllowedByOrgPolicy } from '../../domain/policies.js';
import * as repository from '../../infrastructure/repositories/index.js';
import { issueSessionForUser } from './index.js';
import { AuthError, AuthErrorCodes } from '../../domain/types.js';
import { normalizeEmail } from '../../domain/constants.js';
import { emailToHash } from './shared-helpers.js';
function readCallbackState(state) {
    const login = socialLoginStateCache.get(state);
    if (login) {
        return {
            kind: 'login',
            provider: login.provider,
            state,
            rememberMe: login.rememberMe,
            ipAddress: login.ipAddress,
            userAgent: login.userAgent,
            ...(login.deviceName !== undefined ? { deviceName: login.deviceName } : {}),
            ...(login.clientDeviceType !== undefined
                ? { clientDeviceType: login.clientDeviceType }
                : {}),
        };
    }
    const link = identityLinkStateCache.get(state);
    if (link) {
        return {
            kind: 'link',
            provider: link.provider,
            state,
            userId: link.userId,
        };
    }
    return null;
}
function assertProviderReady(provider) {
    if (!isLinkableProvider(provider)) {
        throw new AuthError('Provider must be google or github', AuthErrorCodes.VALIDATION_ERROR, 400);
    }
    if (!isProviderConfigured(provider)) {
        throw new AuthError('Social login is not available', AuthErrorCodes.IDENTITY_PROVIDER_NOT_CONFIGURED, 503);
    }
}
function buildAuthorizeUrl(provider, flow, state) {
    const url = new URL(getApiProviderAuthorizeUrl(provider, flow));
    url.searchParams.set('state', state);
    return url.toString();
}
export function frontendAuthCallbackUrl() {
    const base = (apiBaseUrl() || '').replace(/\/+$/, '');
    return `${base}/auth/callback`;
}
export function frontendIdentityProvidersUrl() {
    const base = (apiBaseUrl() || '').replace(/\/+$/, '');
    return `${base}/settings/security`;
}
export async function startSocialLogin(provider, input, ipAddress, userAgent, requestId) {
    assertProviderReady(provider);
    const state = randomUUID();
    socialLoginStateCache.set(state, {
        provider,
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
        resource_id: null,
        ip_address: ipAddress,
        request_id: requestId,
        user_agent: userAgent,
        metadata: { provider },
    });
    return {
        authorization_url: buildAuthorizeUrl(provider, 'login', state),
        state,
    };
}
export async function startIdentityLink(userId, provider, ipAddress, requestId) {
    assertProviderReady(provider);
    const user = await repository.findUserById(userId);
    if (!user || user.deleted_at || user.status !== 'active') {
        throw new AuthError('Your account is no longer available. Sign in again to continue.', AuthErrorCodes.USER_NOT_FOUND, 404);
    }
    const existing = await repository.findLinkedIdentityByUserProvider(userId, provider);
    if (existing) {
        throw new AuthError('Provider already linked to this account', AuthErrorCodes.IDENTITY_ALREADY_LINKED, 409);
    }
    const state = randomUUID();
    identityLinkStateCache.set(state, { userId, provider });
    logAudit({
        user_id: userId,
        org_id: null,
        action: 'user.identity_link_started',
        resource_type: 'identity_provider',
        resource_id: null,
        ip_address: ipAddress,
        request_id: requestId,
        metadata: { provider },
    });
    return {
        authorization_url: buildAuthorizeUrl(provider, 'link', state),
        state,
    };
}
export function consumeCallbackState(state) {
    const flow = readCallbackState(state);
    if (flow) {
        socialLoginStateCache.delete(state);
        identityLinkStateCache.delete(state);
        return flow;
    }
    throw new AuthError('Login session expired; try again', AuthErrorCodes.SOCIAL_LOGIN_FAILED, 400);
}
export function resolveCallbackState(state) {
    const flow = readCallbackState(state);
    if (flow) {
        return flow;
    }
    throw new AuthError('Login session expired; try again', AuthErrorCodes.SOCIAL_LOGIN_FAILED, 400);
}
export async function completeSocialLogin(profile, flow, ipAddress, userAgent, requestId) {
    const link = await repository.findLinkedIdentityByProviderSubject(profile.provider, profile.subject);
    if (!link) {
        if (!profile.email) {
            throw new AuthError('The provider did not return a verified email address. Cannot create an account.', AuthErrorCodes.SOCIAL_LOGIN_FAILED, 400);
        }
        const normalizedEmail = normalizeEmail(profile.email);
        const existingUser = await repository.findUserByEmailHash(emailToHash(normalizedEmail));
        if (existingUser) {
            throw new AuthError('An account already exists with this email. Sign in with your password first, then link this provider from Account Settings.', AuthErrorCodes.IDENTITY_ALREADY_LINKED, 409);
        }
        const created = await repository.withTransaction(async (client) => {
            const user = await repository.createUser({
                id: randomUUID(),
                email: normalizedEmail,
                full_name: profile.displayName || normalizedEmail.split('@')[0] || 'User',
                password: null,
                email_verified: true,
                avatar_url: profile.avatarUrl,
            }, client);
            await repository.createLinkedIdentity({
                user_id: user.id,
                provider: flow.provider,
                provider_subject: profile.subject,
                provider_email: normalizedEmail,
                profile_metadata: {
                    display_name: profile.displayName,
                    ...profile.profileMetadata,
                },
            }, client);
            return user;
        });
        const session = await issueSessionForUser({
            user: created,
            ipAddress: flow.ipAddress || ipAddress,
            userAgent: flow.userAgent || userAgent,
            deviceName: flow.deviceName,
            deviceType: flow.clientDeviceType || 'web',
            mfaVerified: true,
            rememberMe: flow.rememberMe === true,
            ssoContext: { loginMethod: `social_${flow.provider}` },
        });
        await repository.recordLogin(created.id, ipAddress, userAgent);
        logAudit({
            user_id: created.id,
            org_id: null,
            action: 'user.created',
            resource_type: 'user',
            resource_id: created.id,
            ip_address: ipAddress,
            user_agent: userAgent,
            request_id: requestId,
            metadata: { source: 'social_login', provider: flow.provider, email_verified: true },
        });
        return {
            access_token: session.accessToken,
            refresh_token: session.refreshToken,
            expires_at: session.expiresAt,
            token_type: 'Bearer',
            session_id: session.sessionId,
            user_id: created.id,
        };
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
        rememberMe: flow.rememberMe === true,
        ssoContext: { loginMethod: `social_${profile.provider}` },
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
        metadata: { provider: profile.provider, session_id: session.sessionId },
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
export async function completeIdentityLink(profile, flow, ipAddress, requestId) {
    const userId = flow.userId;
    if (!userId) {
        throw new AuthError('Invalid identity link session', AuthErrorCodes.IDENTITY_LINK_FAILED, 400);
    }
    const user = await repository.findUserById(userId);
    if (!user || user.deleted_at || user.status !== 'active') {
        throw new AuthError('User not found', AuthErrorCodes.USER_NOT_FOUND, 404);
    }
    // Linking must bind the provider identity to the account that is already
    // signed in.  Without this check, a user could link a different provider
    // email to the current account, which is both surprising and unsafe for
    // account-recovery expectations.
    if (!profile.email || normalizeEmail(profile.email) !== normalizeEmail(user.email)) {
        throw new AuthError('The provider account email must match the email of the signed-in account', AuthErrorCodes.IDENTITY_LINK_FAILED, 409);
    }
    const existingBySubject = await repository.findLinkedIdentityByProviderSubject(profile.provider, profile.subject);
    if (existingBySubject && existingBySubject.user_id !== userId) {
        throw new AuthError('Identity already linked to another account', AuthErrorCodes.IDENTITY_ALREADY_LINKED, 409);
    }
    const existingByProvider = await repository.findLinkedIdentityByUserProvider(userId, profile.provider);
    if (existingByProvider) {
        if (existingByProvider.provider_subject !== profile.subject) {
            throw new AuthError('Provider already linked to a different identity', AuthErrorCodes.IDENTITY_ALREADY_LINKED, 409);
        }
        await repository.updateLinkedIdentityLastUsed(existingByProvider.id);
        return {
            id: existingByProvider.id,
            provider: existingByProvider.provider,
            linked_at: existingByProvider.linked_at,
        };
    }
    // Keep the identity row, last-used timestamp, and imported avatar atomic.
    // If any write fails, none of the provider data is persisted.
    const created = await repository.withTransaction(async (client) => {
        const identity = await repository.createLinkedIdentity({
            user_id: userId,
            provider: profile.provider,
            provider_subject: profile.subject,
            provider_email: profile.email,
            profile_metadata: {
                display_name: profile.displayName,
                ...profile.profileMetadata,
            },
        }, client);
        await repository.updateLinkedIdentityLastUsed(identity.id, client);
        if (profile.avatarUrl) {
            await repository.updateUser(userId, userId, { avatar_url: profile.avatarUrl }, client);
        }
        return identity;
    });
    logAudit({
        user_id: userId,
        org_id: null,
        action: 'user.identity_linked',
        resource_type: 'identity_provider',
        resource_id: created.id,
        ip_address: ipAddress,
        request_id: requestId,
        metadata: { provider: profile.provider },
    });
    return {
        id: created.id,
        provider: created.provider,
        linked_at: created.linked_at,
    };
}
export async function listIdentityProviders(userId) {
    const links = await repository.listLinkedIdentities(userId);
    return links.map((link) => ({
        id: link.id,
        provider: link.provider,
        provider_email: link.provider_email,
        linked_at: link.linked_at,
        last_used_at: link.last_used_at,
    }));
}
export async function unlinkIdentityProvider(userId, linkId, ipAddress, requestId) {
    const user = await repository.findUserById(userId);
    if (!user || user.deleted_at) {
        throw new AuthError('User not found', AuthErrorCodes.USER_NOT_FOUND, 404);
    }
    const links = await repository.listLinkedIdentities(userId);
    const target = links.find((link) => link.id === linkId);
    if (!target) {
        throw new AuthError('Linked identity not found', AuthErrorCodes.IDENTITY_LINK_FAILED, 404);
    }
    if (!user.password_hash && links.length <= 1) {
        throw new AuthError('Cannot remove the last login method from a passwordless account', AuthErrorCodes.INVALID_OPERATION, 400);
    }
    const deleted = await repository.deleteLinkedIdentity(userId, linkId);
    if (!deleted) {
        throw new AuthError('Linked identity not found', AuthErrorCodes.IDENTITY_LINK_FAILED, 404);
    }
    logAudit({
        user_id: userId,
        org_id: null,
        action: 'user.identity_unlinked',
        resource_type: 'identity_provider',
        resource_id: linkId,
        ip_address: ipAddress,
        request_id: requestId,
        metadata: { provider: target.provider },
    });
}
//# sourceMappingURL=identity-provider.service.js.map