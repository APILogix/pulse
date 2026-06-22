import { type LinkableProvider } from './identity-link.config.js';
export interface OAuthProfile {
    provider: LinkableProvider;
    subject: string;
    email: string | null;
    displayName: string | null;
}
export declare function buildOidcClient(provider: 'google' | 'microsoft'): Promise<import("openid-client").Configuration>;
export declare function buildOAuthAuthorizationUrl(options: {
    provider: LinkableProvider;
    redirectUri: string;
    state: string;
    codeVerifier: string;
    nonce?: string;
}): Promise<string>;
export declare function exchangeOAuthCallback(provider: LinkableProvider, callbackUrl: string, codeVerifier: string, redirectUri: string, nonce?: string): Promise<OAuthProfile>;
export declare function createPkcePair(): {
    codeVerifier: string;
    state: string;
    nonce: string;
};
//# sourceMappingURL=oauth-exchange.d.ts.map