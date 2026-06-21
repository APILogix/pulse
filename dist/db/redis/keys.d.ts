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
};
export declare const RedisTTL: {
    API_KEY: number;
    IDEMPOTENCY: number;
    RATE_LIMIT: number;
    EVENT_CACHE: number;
    CIRCUIT_OPEN: number;
    REPLAY_PROGRESS: number;
    HEALTH: number;
};
//# sourceMappingURL=keys.d.ts.map