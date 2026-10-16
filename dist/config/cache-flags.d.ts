/**
 * Feature flags and kill-switches for caching defect remediation (Tiers 0, 1, 2).
 * Each fix has a safe default (true) and can be rolled back via its environment variable.
 */
export declare const CacheFlags: {
    readonly idempotencyTenantIsolation: boolean;
    readonly authRedisState: boolean;
    readonly cacheInvalidationBus: boolean;
    readonly redisDualInstance: boolean;
    readonly analyticsPaginationFix: boolean;
    readonly lookupSyncBounded: boolean;
    readonly ingestionNegativeCache: boolean;
    readonly entitlementsSingleFlight: boolean;
    readonly analyticsTimeQuantization: boolean;
    readonly authSessionUserCache: boolean;
    readonly projectRoleCache: boolean;
    readonly observabilityResultCache: boolean;
};
//# sourceMappingURL=cache-flags.d.ts.map