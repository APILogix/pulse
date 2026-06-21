/**
 * SAML 2.0 SP-initiated SSO (@node-saml/node-saml).
 *
 * Flow state in LRU (`samlLoginStateCache`). InResponseTo IDs in
 * `samlRequestIdCache`. Org IdP config in `organization_sso_providers`.
 */
import { SAML, ValidateInResponseTo } from '@node-saml/node-saml';
import { randomState } from 'openid-client';
import { logAudit } from '../../shared/middleware/audit-logger.js';
import { samlLoginStateCache } from './cache.js';
import * as repository from './repository.js';
import { samlRequestIdCache } from './saml-request-cache.js';
import { samlSpConfig } from './saml.config.js';
import { extractDisplayNameFromSamlProfile, extractEmailFromSamlProfile, resolveSsoUser, } from './sso-provision.service.js';
import { finalizeEnterpriseSsoLogin } from './sso-session.service.js';
import { AuthError, AuthErrorCodes, } from './types.js';
import { normalizeEmail } from './utils.js';
export function buildSamlClient(provider) {
    if (!provider.sso_url || !provider.x509_certificate || !provider.entity_id) {
        throw new AuthError('SAML provider is missing IdP configuration', AuthErrorCodes.SAML_NOT_CONFIGURED, 500);
    }
    return new SAML({
        entryPoint: provider.sso_url,
        issuer: samlSpConfig.entityId,
        callbackUrl: samlSpConfig.acsUrl,
        logoutUrl: samlSpConfig.sloUrl,
        idpCert: provider.x509_certificate,
        idpIssuer: provider.entity_id,
        wantAssertionsSigned: true,
        wantAuthnResponseSigned: false,
        validateInResponseTo: ValidateInResponseTo.always,
        requestIdExpirationPeriodMs: 10 * 60 * 1000,
        cacheProvider: samlRequestIdCache,
        ...(samlSpConfig.privateKey
            ? {
                privateKey: samlSpConfig.privateKey,
                signatureAlgorithm: 'sha256',
            }
            : {}),
    });
}
export async function startSamlLogin(input, ipAddress, userAgent, requestId) {
    let provider = null;
    if (input.provider_id) {
        provider = await repository.findSamlProviderById(input.provider_id);
    }
    else if (input.email) {
        const domain = normalizeEmail(input.email).split('@')[1];
        if (domain) {
            provider = await repository.findSamlProviderForEmailDomain(domain);
        }
    }
    if (!provider) {
        throw new AuthError('No SAML provider configured for this request', AuthErrorCodes.SAML_NOT_CONFIGURED, 404);
    }
    const saml = buildSamlClient(provider);
    const state = randomState();
    const authorizationUrl = await saml.getAuthorizeUrlAsync(state, undefined, {
        additionalParams: {},
    });
    const payload = {
        providerId: provider.id,
        orgId: provider.org_id,
        rememberMe: input.remember_me === true,
        ipAddress,
        userAgent,
        ...(input.device_name !== undefined ? { deviceName: input.device_name } : {}),
        ...(input.device_type !== undefined
            ? { clientDeviceType: input.device_type }
            : {}),
    };
    samlLoginStateCache.set(state, payload);
    logAudit({
        user_id: null,
        org_id: provider.org_id,
        action: 'sso.saml_login_started',
        resource_type: 'sso_provider',
        resource_id: provider.id,
        ip_address: ipAddress,
        request_id: requestId,
        user_agent: userAgent,
    });
    return { authorization_url: authorizationUrl, state };
}
export async function completeSamlAcs(body, ipAddress, userAgent, requestId) {
    const state = body.RelayState;
    if (!state) {
        throw new AuthError('Missing RelayState', AuthErrorCodes.SAML_RESPONSE_INVALID, 400);
    }
    const flow = samlLoginStateCache.get(state);
    if (!flow) {
        throw new AuthError('SSO session expired; restart sign-in', AuthErrorCodes.SAML_RESPONSE_INVALID, 400);
    }
    samlLoginStateCache.delete(state);
    const provider = await repository.findSamlProviderById(flow.providerId);
    if (!provider) {
        throw new AuthError('SAML provider not found', AuthErrorCodes.SAML_NOT_CONFIGURED, 404);
    }
    const saml = buildSamlClient(provider);
    let profile;
    try {
        const result = await saml.validatePostResponseAsync(body);
        profile = (result.profile ?? {});
    }
    catch {
        throw new AuthError('Invalid SAML response', AuthErrorCodes.SAML_RESPONSE_INVALID, 400);
    }
    const email = extractEmailFromSamlProfile(profile);
    if (!email) {
        throw new AuthError('Identity provider did not return an email', AuthErrorCodes.SAML_RESPONSE_INVALID, 400);
    }
    const displayName = extractDisplayNameFromSamlProfile(profile, email);
    const user = await resolveSsoUser(email, displayName, provider, ipAddress, requestId, 'user.saml_jit_provisioned');
    const nameId = typeof profile.nameID === 'string'
        ? profile.nameID
        : typeof profile.nameId === 'string'
            ? profile.nameId
            : email;
    const sessionIndex = typeof profile.sessionIndex === 'string' ? profile.sessionIndex : undefined;
    return finalizeEnterpriseSsoLogin({
        user,
        provider,
        flow,
        ipAddress,
        userAgent,
        requestId,
        method: 'saml',
        samlNameId: nameId,
        ...(sessionIndex !== undefined ? { samlSessionIndex: sessionIndex } : {}),
    });
}
export function generateSpMetadata() {
    if (!samlSpConfig.certificate) {
        throw new AuthError('SAML SP certificate is not configured (set SAML_SP_CERTIFICATE)', AuthErrorCodes.SAML_NOT_CONFIGURED, 503);
    }
    const saml = new SAML({
        issuer: samlSpConfig.entityId,
        callbackUrl: samlSpConfig.acsUrl,
        logoutUrl: samlSpConfig.sloUrl,
        entryPoint: samlSpConfig.acsUrl,
        idpCert: samlSpConfig.certificate,
        ...(samlSpConfig.privateKey
            ? {
                privateKey: samlSpConfig.privateKey,
                signatureAlgorithm: 'sha256',
            }
            : {}),
    });
    return saml.generateServiceProviderMetadata(samlSpConfig.privateKey ?? null, samlSpConfig.certificate);
}
//# sourceMappingURL=saml.service.js.map