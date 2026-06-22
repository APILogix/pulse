/**
 * Centralized Redis key namespace for ingestion platform
 * Prevents collisions and provides observability
 */
export const RedisKeys = {
    // API Authentication
    apiKey: (key) => `ingest:apikey:${key}`,
    projectConfig: (projectId) => `ingest:config:${projectId}`,
    // Rate Limiting (sliding window via sorted sets)
    rateLimitWindow: (projectId, window) => `ingest:ratelimit:${projectId}:${window}`,
    // Idempotency (24h TTL)
    idempotency: (eventId) => `ingest:idempotency:${eventId}`,
    // Event cache for debug/replay
    eventCache: (eventId) => `ingest:event:${eventId}`,
    // DLQ & Replay tracking
    replayJob: (replayId) => `ingest:replay:${replayId}`,
    replayProgress: (replayId) => `ingest:replay:${replayId}:progress`,
    // Circuit Breaker pattern
    circuitBreaker: (service) => `ingest:circuit:${service}`,
    circuitFailureCount: (service) => `ingest:circuit:${service}:failures`,
    // Metrics & Observability
    metricsCounter: (projectId, date, type) => `ingest:metrics:${projectId}:${date}:${type}`,
    ingestionStats: (projectId) => `ingest:stats:${projectId}`,
    // Health
    health: () => `ingest:health`,
    lastIngest: (projectId) => `ingest:last:${projectId}`,
};
export const RedisTTL = {
    API_KEY: 3600, // ✅ 1 hour (not 5 min — reduces DB pressure)
    IDEMPOTENCY: 86400, // ✅ 24 hours (good)
    RATE_LIMIT: 120, // ⚠️ slightly > window to avoid edge expiry
    EVENT_CACHE: 3600, // ✅ 1 hour (fine)
    CIRCUIT_OPEN: 30, // ✅ good
    REPLAY_PROGRESS: 3600, // ✅ fine
    HEALTH: 15, // ⚠️ 10s too aggressive, 15–30 safer
};
//# sourceMappingURL=keys.js.map