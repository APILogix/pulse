/**
 * SAML Service Provider configuration (entity ID, ACS, optional signing certs).
 */
import { env } from '../../../../config/env.js';
function appBaseUrl() {
    return (env.FRONTEND_URL || env.APP_URL).replace(/\/+$/, '');
}
function apiBaseUrl() {
    const api = env.API_PUBLIC_URL || env.APP_URL;
    return api.replace(/\/+$/, '');
}
export const samlSpConfig = {
    /** SP entity ID published in metadata. */
    entityId: env.SAML_SP_ENTITY_ID || `${apiBaseUrl()}/auth/saml/metadata`,
    /** Assertion Consumer Service URL (IdP POST target). */
    acsUrl: env.SAML_SP_ACS_URL || `${apiBaseUrl()}/auth/saml/acs`,
    /** Single Logout Service URL (SP endpoint for SAML SLO). */
    sloUrl: env.SAML_SP_SLO_URL || `${apiBaseUrl()}/auth/saml/slo`,
    /** Optional PEM private key for signing AuthnRequests (enterprise IdPs). */
    privateKey: env.SAML_SP_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    /** Optional PEM certificate for SP metadata / signature verification. */
    certificate: env.SAML_SP_CERTIFICATE?.replace(/\\n/g, '\n'),
};
export function getSamlCallbackUrl() {
    return `${appBaseUrl()}/auth/sso/callback`;
}
//# sourceMappingURL=saml.config.js.map