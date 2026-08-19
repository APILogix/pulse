export declare function recordCatalogCacheHit(tier: string): void;
export declare function recordCatalogCacheMiss(tier: string): void;
export declare function recordCatalogCacheLoad(tier: string): void;
export declare function recordCatalogCacheInvalidation(reason?: string): void;
export declare function recordRedisCooldownSuccess(tier: string): void;
export declare function recordRedisCooldownRejected(tier: string): void;
export declare function recordRedisError(operation: string): void;
export declare function recordRedisLatency(operation: string, latencyMs: number): void;
//# sourceMappingURL=alert-runtime-metrics.d.ts.map