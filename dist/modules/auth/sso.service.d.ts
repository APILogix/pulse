/**

 * OIDC SSO login (authorization code + PKCE).

 *

 * State is stored in-process (LRU). Provider secrets and OIDC metadata live

 * in Postgres (`organization_sso_providers`).

 */
import { type SsoLoginInput } from './types.js';
/**
 * Unified SSO login entry: routes to OIDC or SAML based on provider_type.
 */
export declare function startSsoLogin(input: SsoLoginInput, ipAddress: string, userAgent: string, requestId: string): Promise<{
    authorization_url: string;
    state: string;
}>;
export declare function completeSsoCallback(callbackUrl: string, ipAddress: string, userAgent: string, requestId: string): Promise<{
    access_token: string;
    refresh_token: string;
    expires_at: Date;
    token_type: 'Bearer';
    session_id: string;
    user_id: string;
}>;
//# sourceMappingURL=sso.service.d.ts.map