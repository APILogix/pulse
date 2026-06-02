export type LinkableProvider = 'google' | 'github' | 'microsoft';
export declare function getIdentityLinkCallbackUrl(): string;
export { getApiIdentityLinkCallbackUrl } from './oauth-callback.config.js';
export declare function isLinkableProvider(value: string): value is LinkableProvider;
export declare function isProviderConfigured(provider: LinkableProvider): boolean;
export declare function listConfiguredLinkProviders(): LinkableProvider[];
export declare function getMicrosoftIssuer(): string;
//# sourceMappingURL=identity-link.config.d.ts.map