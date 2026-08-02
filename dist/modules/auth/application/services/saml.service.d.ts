/**
 * SAML 2.0 SP-initiated SSO (@node-saml/node-saml).
 *
 * Flow state in LRU (`samlLoginStateCache`). InResponseTo IDs in
 * `samlRequestIdCache`. Org IdP config in `organization_sso_providers`.
 */
import { SAML } from '@node-saml/node-saml';
import * as repository from '../../infrastructure/repositories/index.js';
import { type SsoLoginInput } from '../../domain/types.js';
export declare function buildSamlClient(provider: repository.SamlProviderRow): SAML;
export declare function startSamlLogin(input: SsoLoginInput, ipAddress: string, userAgent: string, requestId: string): Promise<{
    authorization_url: string;
    state: string;
}>;
export declare function completeSamlAcs(body: {
    SAMLResponse: string;
    RelayState?: string;
}, ipAddress: string, userAgent: string, requestId: string): Promise<{
    access_token: string;
    refresh_token: string;
    expires_at: Date;
    token_type: 'Bearer';
    session_id: string;
    user_id: string;
}>;
export declare function generateSpMetadata(): string;
//# sourceMappingURL=saml.service.d.ts.map