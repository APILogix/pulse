/**
 * Centralized Redis key namespace for ingestion platform
 * Prevents collisions and provides observability
 */
export declare const RedisKeys: {
    apiKey: (key: string) => string;
    projectConfig: (projectId: string) => string;
    rateLimitWindow: (projectId: string, window: string) => string;
    idempotency: (eventId: string) => string;
    eventCache: (eventId: string) => string;
    replayJob: (replayId: string) => string;
    replayProgress: (replayId: string) => string;
    circuitBreaker: (service: string) => string;
    circuitFailureCount: (service: string) => string;
    metricsCounter: (projectId: string, date: string, type: string) => string;
    ingestionStats: (projectId: string) => string;
    health: () => string;
    lastIngest: (projectId: string) => string;
    lookupApiKey: (keyHash: string) => string;
    lookupSdkConfigByEnv: (environmentId: string) => string;
    lookupSdkConfigByMeta: (orgId: string, projectId: string, env: string) => string;
    lookupOrgOverride: (orgId: string) => string;
    remoteConfig: (projectId: string, environment?: string | null) => string;
    lookupInitDelivery: (keyHash: string, hintsHash: string) => string;
    lookupNegativeKey: (keyHash: string) => string;
    ipFailures: (ip: string) => string;
    ipJail: (ip: string) => string;
    deliveryRateLimit: (identifier: string) => string;
};
export declare const RedisTTL: {
    API_KEY: number;
    IDEMPOTENCY: number;
    RATE_LIMIT: number;
    EVENT_CACHE: number;
    CIRCUIT_OPEN: number;
    REPLAY_PROGRESS: number;
    HEALTH: number;
    LOOKUP_API_KEY: number;
    LOOKUP_SDK_CONFIG: number;
    LOOKUP_ORG_OVERRIDE: number;
    LOOKUP_INIT_DELIVERY: number;
    LOOKUP_NEGATIVE_KEY: number;
    IP_FAIL_WINDOW: number;
    IP_JAIL: number;
    DELIVERY_RATE_LIMIT: number;
};
//# sourceMappingURL=keys.d.ts.map