import { env } from '../../../../config/env.js';
import { logAudit } from '../../../../shared/middleware/audit-logger.js';
import { blacklistAccessToken } from '../../infrastructure/cache/auth.cache.js';
import * as repository from '../../infrastructure/repositories/index.js';
import { buildSamlClient } from './saml.service.js';
import { parseSamlLogoutPayload } from '../../infrastructure/protocols/saml-xml.util.js';
import { AuthError, AuthErrorCodes } from '../../domain/types.js';
export async function startSamlSingleLogout(userId, sessionId, ipAddress, requestId) {
    const session = await repository.findSessionById(sessionId, userId);
    if (!session?.saml_name_id || !session.sso_provider_id) {
        return { logout_url: null };
    }
    const provider = await repository.findSamlProviderById(session.sso_provider_id);
    if (!provider) {
        return { logout_url: null };
    }
    const saml = buildSamlClient(provider);
    const profile = {
        nameID: session.saml_name_id,
        nameIDFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
        issuer: provider.entity_id,
        ...(session.saml_session_index
            ? { sessionIndex: session.saml_session_index }
            : {}),
    };
    const logoutUrl = await saml.getLogoutUrlAsync(profile, '', {});
    logAudit({
        user_id: userId,
        org_id: provider.org_id,
        action: 'sso.saml_logout_started',
        resource_type: 'session',
        resource_id: sessionId,
        ip_address: ipAddress,
        request_id: requestId,
    });
    return { logout_url: logoutUrl };
}
/**
 * Revoke local session, then return IdP logout URL when SAML context exists.
 */
export async function completeSamlLogoutForUser(userId, sessionId, ipAddress, requestId) {
    const slo = await startSamlSingleLogout(userId, sessionId, ipAddress, requestId);
    await repository.revokeSession(sessionId, userId, 'User SAML logout');
    blacklistAccessToken(sessionId);
    logAudit({
        user_id: userId,
        org_id: null,
        action: 'user.logout',
        resource_type: 'session',
        resource_id: sessionId,
        ip_address: ipAddress,
        request_id: requestId,
        metadata: { saml_slo: slo.logout_url !== null },
    });
    return { logout_url: slo.logout_url, logged_out: true };
}
export async function handleSamlSingleLogout(body, ipAddress, requestId) {
    if (body.SAMLRequest) {
        return handleIdpInitiatedLogout(body, ipAddress, requestId);
    }
    if (body.SAMLResponse) {
        return handleSpLogoutResponse(body, ipAddress, requestId);
    }
    throw new AuthError('Missing SAML logout payload', AuthErrorCodes.SAML_RESPONSE_INVALID, 400);
}
async function resolveSamlProviderForLogout(options) {
    if (options.session?.provider_id) {
        const bySession = await repository.findSamlProviderById(options.session.provider_id);
        if (bySession)
            return bySession;
    }
    if (options.issuer) {
        return repository.findSamlProviderByEntityId(options.issuer);
    }
    return null;
}
async function handleIdpInitiatedLogout(body, ipAddress, requestId) {
    const parsed = parseSamlLogoutPayload(body.SAMLRequest);
    const provider = parsed.issuer
        ? await repository.findSamlProviderByEntityId(parsed.issuer)
        : null;
    const session = parsed.nameId && provider
        ? await repository.findLatestSamlSessionByProviderAndNameId(provider.id, parsed.nameId)
        : null;
    const resolvedProvider = await resolveSamlProviderForLogout({
        session,
        issuer: parsed.issuer,
    });
    if (!resolvedProvider) {
        throw new AuthError('Cannot process SAML logout for unknown provider', AuthErrorCodes.SAML_RESPONSE_INVALID, 400);
    }
    const saml = buildSamlClient(resolvedProvider);
    const result = await saml.validatePostRequestAsync({
        SAMLRequest: body.SAMLRequest,
    });
    const nameId = result.profile?.nameID ?? parsed.nameId ?? session?.saml_name_id ?? null;
    if (nameId) {
        await revokeSessionsBySamlContext(resolvedProvider.id, nameId, typeof result.profile?.sessionIndex === 'string'
            ? result.profile.sessionIndex
            : parsed.sessionIndex, ipAddress, requestId);
    }
    const responseUrl = await saml.getLogoutResponseUrlAsync(result.profile ?? { nameID: nameId ?? '', issuer: resolvedProvider.entity_id }, body.RelayState ?? '', {}, true);
    return { redirect_url: responseUrl, logged_out: true };
}
async function handleSpLogoutResponse(body, ipAddress, requestId) {
    const parsed = parseSamlLogoutPayload(body.SAMLResponse);
    if (parsed.nameId && parsed.issuer) {
        const provider = await repository.findSamlProviderByEntityId(parsed.issuer);
        if (provider) {
            await revokeSessionsBySamlContext(provider.id, parsed.nameId, parsed.sessionIndex, ipAddress, requestId);
        }
    }
    return { redirect_url: getSamlLogoutRedirectUrl(), logged_out: true };
}
async function revokeSessionsBySamlContext(providerId, nameId, sessionIndex, ipAddress, requestId) {
    const sessions = await repository.listActiveSamlSessionsForLogout(providerId, nameId, sessionIndex ?? undefined);
    if (sessions.length === 0) {
        return;
    }
    const sessionIds = sessions.map((row) => row.session_id);
    await repository.expireSamlSessionsBySessionIds(sessionIds);
    for (const row of sessions) {
        await repository.revokeSession(row.session_id, row.user_id, 'SAML single logout');
        blacklistAccessToken(row.session_id);
        logAudit({
            user_id: row.user_id,
            org_id: null,
            actor_type: 'saml',
            actor_id: providerId,
            action: 'user.logout_saml',
            resource_type: 'session',
            resource_id: row.session_id,
            ip_address: ipAddress,
            request_id: requestId,
            metadata: { saml_name_id: nameId, session_index: sessionIndex ?? null },
        });
    }
}
export function getSamlLogoutRedirectUrl() {
    const base = (env.FRONTEND_URL || env.APP_URL).replace(/\/+$/, '');
    return `${base}/auth/logout/complete`;
}
//# sourceMappingURL=saml-slo.service.js.map