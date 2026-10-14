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
    // Fast-Path Lookup & SDK Config Caching (sub-2ms init)
    lookupApiKey: (keyHash) => `lookup:apikey:${keyHash}`,
    lookupSdkConfigByEnv: (environmentId) => `lookup:sdk-config:env:${environmentId}`,
    lookupSdkConfigByMeta: (orgId, projectId, env) => `lookup:sdk-config:meta:${orgId}:${projectId}:${env}`,
    lookupOrgOverride: (orgId) => `lookup:org:override:${orgId}`,
    // Permanent Project-Scoped Remote Config Cache (No TTL)
    remoteConfig: (projectId, environment) => environment && environment !== 'production'
        ? `remote-config:${projectId}:${environment}`
        : `remote-config:${projectId}`,
    lookupInitDelivery: (keyHash, hintsHash) => `lookup:init:${keyHash}:${hintsHash}`,
    // Control-Plane / SDK Init Defense
    lookupNegativeKey: (keyHash) => `lookup:neg:key:${keyHash}`,
    ipFailures: (ip) => `security:ip:fail:${ip}`,
    ipJail: (ip) => `security:ip:jail:${ip}`,
    deliveryRateLimit: (identifier) => `security:ratelimit:delivery:${identifier}`,
};
export const RedisTTL = {
    API_KEY: 3600, // ✅ 1 hour (not 5 min — reduces DB pressure)
    IDEMPOTENCY: 86400, // ✅ 24 hours (good)
    RATE_LIMIT: 120, // ⚠️ slightly > window to avoid edge expiry
    EVENT_CACHE: 3600, // ✅ 1 hour (fine)
    CIRCUIT_OPEN: 30, // ✅ good
    REPLAY_PROGRESS: 3600, // ✅ fine
    HEALTH: 15, // ⚠️ 10s too aggressive, 15–30 safer
    // Lookup Cache TTLs
    LOOKUP_API_KEY: 3600, // 1 hour
    LOOKUP_SDK_CONFIG: 3600, // 1 hour
    LOOKUP_ORG_OVERRIDE: 600, // 10 minutes
    LOOKUP_INIT_DELIVERY: 300, // 5 minutes
    // Control-Plane Security TTLs
    LOOKUP_NEGATIVE_KEY: 60, // 60 seconds negative caching
    IP_FAIL_WINDOW: 60, // 60 seconds failure accumulation window
    IP_JAIL: 900, // 15 minutes jail
    DELIVERY_RATE_LIMIT: 60, // 60 seconds rate limit window
};
//# sourceMappingURL=keys.js.map