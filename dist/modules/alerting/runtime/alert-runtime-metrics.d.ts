export declare function recordCatalogCacheHit(tier: string): void;
export declare function recordCatalogCacheMiss(tier: string): void;
export declare function recordCatalogCacheLoad(tier: string): void;
export declare function recordCatalogCacheInvalidation(reason?: string): void;
export declare function recordRedisCooldownSuccess(tier: string): void;
export declare function recordRedisCooldownRejected(tier: string): void;
export declare function recordRedisError(operation: string): void;
export declare function recordRedisLatency(operation: string, latencyMs: number): void;
export declare function recordEvaluated(tier: string): void;
export declare function recordEvaluationMatched(tier: string): void;
export declare function recordEvaluationSkipped(tier: string, reason: string): void;
export declare function recordEvaluationFailed(tier: string, reason?: string): void;
export declare function recordEvaluationStale(tier: string): void;
export declare function recordEvaluationLatency(tier: string, latencyMs: number): void;
export declare function recordAlertTriggered(tier: string): void;
export declare function recordAlertRecovered(tier: string): void;
/** `gate` distinguishes the cheap Redis fast-path filter from the authoritative DB gate. */
export declare function recordCooldownBlocked(tier: string, gate: 'redis-fastpath' | 'db-authoritative'): void;
export declare function recordAlertDeduplicated(tier: string): void;
export declare function recordAlertAutoResolved(): void;
export declare function recordIncidentOpened(tier: string): void;
export declare function recordIncidentReused(tier: string): void;
/** `origin` distinguishes an evaluated recovery from a manual API resolve. */
export declare function recordIncidentResolved(origin: 'recovery' | 'manual' | 'auto'): void;
export declare function recordIncidentAcknowledged(): void;
export declare function recordIncidentPersistFailed(operation: 'open' | 'resolve'): void;
//# sourceMappingURL=alert-runtime-metrics.d.ts.map