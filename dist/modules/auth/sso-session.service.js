/**
 * Finalize SSO login: org policy check, session issuance, audit.
 */
import { logAudit } from '../../shared/middleware/audit-logger.js';
import * as repository from './repository.js';
import { assertLoginAllowedByOrgPolicy } from './policy.service.js';
import { issueSessionForUser } from './service.js';
export async function finalizeEnterpriseSsoLogin(options) {
    await assertLoginAllowedByOrgPolicy(options.user);
    const ssoContext = {
        providerId: options.provider.id,
        providerType: options.method,
        loginMethod: options.method,
        ...(options.samlNameId !== undefined ? { samlNameId: options.samlNameId } : {}),
        ...(options.samlSessionIndex !== undefined
            ? { samlSessionIndex: options.samlSessionIndex }
            : {}),
    };
    const session = await issueSessionForUser({
        user: options.user,
        ipAddress: options.flow.ipAddress || options.ipAddress,
        userAgent: options.flow.userAgent || options.userAgent,
        deviceName: options.flow.deviceName,
        deviceType: options.flow.clientDeviceType,
        mfaVerified: true,
        rememberMe: options.flow.rememberMe,
        ssoContext,
    });
    await repository.recordLogin(options.user.id, options.ipAddress, options.userAgent);
    logAudit({
        user_id: options.user.id,
        org_id: options.provider.org_id,
        action: options.method === 'saml' ? 'user.login_saml' : 'user.login_sso',
        resource_type: 'user',
        resource_id: options.user.id,
        ip_address: options.ipAddress,
        user_agent: options.userAgent,
        request_id: options.requestId,
        metadata: {
            provider_id: options.provider.id,
            session_id: session.sessionId,
            method: options.method,
        },
    });
    return {
        access_token: session.accessToken,
        refresh_token: session.refreshToken,
        expires_at: session.expiresAt,
        token_type: 'Bearer',
        session_id: session.sessionId,
        user_id: options.user.id,
    };
}
//# sourceMappingURL=sso-session.service.js.map