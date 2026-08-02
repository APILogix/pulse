export type LinkableProvider = 'google' | 'github';
export declare function isLinkableProvider(value: string): value is LinkableProvider;
export declare function isProviderConfigured(provider: LinkableProvider): boolean;
export declare function listConfiguredLinkProviders(): LinkableProvider[];
//# sourceMappingURL=identity-link.config.d.ts.map