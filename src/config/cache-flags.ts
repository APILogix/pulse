/**
 * Feature flags and kill-switches for caching defect remediation (Tiers 0, 1, 2).
 * Each fix has a safe default (true) and can be rolled back via its environment variable.
 */

function isFlagEnabled(name: string, defaultValue = true): boolean {
  const val = process.env[name];
  if (val === undefined || val === '') return defaultValue;
  return val.toLowerCase() !== 'false' && val !== '0';
}

export const CacheFlags = {
  // Tier 0
  get idempotencyTenantIsolation(): boolean {
    return isFlagEnabled('IDEMPOTENCY_TENANT_ISOLATION_ENABLED', true);
  },
  get authRedisState(): boolean {
    return isFlagEnabled('AUTH_REDIS_STATE_ENABLED', true);
  },
  get cacheInvalidationBus(): boolean {
    return isFlagEnabled('CACHE_INVALIDATION_BUS_ENABLED', true);
  },
  get redisDualInstance(): boolean {
    return isFlagEnabled('REDIS_DUAL_INSTANCE_ENABLED', true);
  },

  // Tier 1
  get analyticsPaginationFix(): boolean {
    return isFlagEnabled('ANALYTICS_PAGINATION_CACHE_KEY_FIX_ENABLED', true);
  },
  get lookupSyncBounded(): boolean {
    return isFlagEnabled('LOOKUP_SYNC_BOUNDED_CACHE_ENABLED', true);
  },
  get ingestionNegativeCache(): boolean {
    return isFlagEnabled('INGESTION_NEGATIVE_CACHE_ENABLED', true);
  },

  // Tier 2
  get entitlementsSingleFlight(): boolean {
    return isFlagEnabled('ENTITLEMENTS_SINGLE_FLIGHT_ENABLED', true);
  },
  get analyticsTimeQuantization(): boolean {
    return isFlagEnabled('ANALYTICS_TIME_QUANTIZATION_ENABLED', true);
  },
  get authSessionUserCache(): boolean {
    return isFlagEnabled('AUTH_SESSION_USER_CACHE_ENABLED', true);
  },
  get projectRoleCache(): boolean {
    return isFlagEnabled('PROJECT_ROLE_CACHE_ENABLED', true);
  },
  get observabilityResultCache(): boolean {
    return isFlagEnabled('OBSERVABILITY_RESULT_CACHE_ENABLED', true);
  },
};
