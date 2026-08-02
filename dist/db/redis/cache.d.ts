import { Redis } from 'ioredis';
export interface ProjectConfig {
    id: string;
    orgId: string;
    name: string;
    environment: string;
    rateLimitPerSecond: number;
    rateLimitPerMinute: number;
    allowedEventTypes: string[];
    isActive: boolean;
    apiKeyId: string;
}
export declare class RedisCache {
    private redis;
    constructor(redis: Redis);
    /** Project Resolution by API Key Hash (never raw key) */
    getProjectByApiKeyHash(keyHash: string): Promise<ProjectConfig | null>;
    /**
     * Store project config keyed by API key hash.
     * @param ttl Optional TTL in seconds. Defaults to RedisTTL.API_KEY (1 hour).
     *            Pass a shorter TTL when the key has a near-future expiresAt.
     */
    setProjectByApiKeyHash(keyHash: string, project: ProjectConfig, ttl?: number): Promise<void>;
    invalidateProjectByHash(keyHash: string): Promise<void>;
    /** Idempotency: returns TRUE if new, FALSE if duplicate */
    checkIdempotency(eventId: string): Promise<boolean>;
    /** Sliding Window Rate Limit using Sorted Sets */
    checkRateLimit(projectId: string, limit: number, windowSeconds: number): Promise<{
        allowed: boolean;
        remaining: number;
        resetAt: number;
    }>;
    /** Circuit Breaker */
    isCircuitOpen(service: string): Promise<boolean>;
    recordFailure(service: string, threshold: number, windowSeconds?: number): Promise<void>;
    recordSuccess(service: string): Promise<void>;
    cacheEvent(eventId: string, event: any): Promise<void>;
    getCachedEvent(eventId: string): Promise<any | null>;
    incrementIngestCounter(projectId: string, eventType: string): Promise<void>;
    recordLastIngest(projectId: string): Promise<void>;
    ping(): Promise<'PONG'>;
    get client(): Redis;
}
//# sourceMappingURL=cache.d.ts.map