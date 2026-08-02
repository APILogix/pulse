import type { LinkableProvider } from '../config/identity-link.config.js';
export declare function apiBaseUrl(): string;
export declare function getApiOidcCallbackUrl(): string;
export declare function getApiSocialLoginCallbackUrl(): string;
export declare function getApiProviderAuthorizeUrl(provider: LinkableProvider, flow: 'login' | 'link'): string;
export declare function buildConfiguredCallbackUrl(redirectUri: string, requestUrl: string): string;
//# sourceMappingURL=oauth-callback.config.d.ts.map