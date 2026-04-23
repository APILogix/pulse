/**
 * Centralized Redis key namespace for ingestion platform
 * Prevents collisions and provides observability
 */
export const RedisKeys = {
  // API Authentication
  apiKey: (key: string) => `ingest:apikey:${key}`,
  projectConfig: (projectId: string) => `ingest:config:${projectId}`,
  
  // Rate Limiting (sliding window via sorted sets)
  rateLimitWindow: (projectId: string, window: string) => 
    `ingest:ratelimit:${projectId}:${window}`,
  
  // Idempotency (24h TTL)
  idempotency: (eventId: string) => `ingest:idempotency:${eventId}`,
  
  // Event cache for debug/replay
  eventCache: (eventId: string) => `ingest:event:${eventId}`,
  
  // DLQ & Replay tracking
  replayJob: (replayId: string) => `ingest:replay:${replayId}`,
  replayProgress: (replayId: string) => `ingest:replay:${replayId}:progress`,
  
  // Circuit Breaker pattern
  circuitBreaker: (service: string) => `ingest:circuit:${service}`,
  circuitFailureCount: (service: string) => `ingest:circuit:${service}:failures`,
  
  // Metrics & Observability
  metricsCounter: (projectId: string, date: string, type: string) => 
    `ingest:metrics:${projectId}:${date}:${type}`,
  ingestionStats: (projectId: string) => `ingest:stats:${projectId}`,
  
  // Health
  health: () => `ingest:health`,
  lastIngest: (projectId: string) => `ingest:last:${projectId}`,
};

export const RedisTTL = {
  API_KEY: 3600,          // ✅ 1 hour (not 5 min — reduces DB pressure)
  IDEMPOTENCY: 86400,     // ✅ 24 hours (good)
  RATE_LIMIT: 120,        // ⚠️ slightly > window to avoid edge expiry
  EVENT_CACHE: 3600,      // ✅ 1 hour (fine)
  CIRCUIT_OPEN: 30,       // ✅ good
  REPLAY_PROGRESS: 3600,  // ✅ fine
  HEALTH: 15,             // ⚠️ 10s too aggressive, 15–30 safer
};