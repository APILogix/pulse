import { Redis } from 'ioredis';
import { RedisKeys, RedisTTL } from './keys.js';


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

export class RedisCache {
  constructor(private redis: Redis) {}

  /** Project Resolution by API Key Hash (never raw key) */
  async getProjectByApiKeyHash(keyHash: string): Promise<ProjectConfig | null> {
    const data = await this.redis.get(RedisKeys.apiKey(keyHash));
    return data ? JSON.parse(data) : null;
  }

  /**
   * Store project config keyed by API key hash.
   * @param ttl Optional TTL in seconds. Defaults to RedisTTL.API_KEY (1 hour).
   *            Pass a shorter TTL when the key has a near-future expiresAt.
   */
  async setProjectByApiKeyHash(keyHash: string, project: ProjectConfig, ttl?: number): Promise<void> {
    await this.redis.setex(
      RedisKeys.apiKey(keyHash),
      ttl ?? RedisTTL.API_KEY,
      JSON.stringify(project)
    );
  }

  async invalidateProjectByHash(keyHash: string): Promise<void> {
    await this.redis.del(RedisKeys.apiKey(keyHash));
  }

  /** Idempotency: returns TRUE if new, FALSE if duplicate */
  async checkIdempotency(eventId: string): Promise<boolean> {
    const key = RedisKeys.idempotency(eventId);
    const result = await this.redis.set(key, '1', 'EX', RedisTTL.IDEMPOTENCY, 'NX');
    return result === 'OK';
  }

  /** Sliding Window Rate Limit using Sorted Sets */
  async checkRateLimit(
    projectId: string,
    limit: number,
    windowSeconds: number
  ): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
    const now = Date.now();
    const windowKey = RedisKeys.rateLimitWindow(projectId, `${windowSeconds}s`);
    const windowStart = now - (windowSeconds * 1000);

    const pipeline = this.redis.pipeline();
    pipeline.zremrangebyscore(windowKey, 0, windowStart);
    pipeline.zcard(windowKey);
    pipeline.zadd(windowKey, now, `${now}-${Math.random()}`);
    pipeline.expire(windowKey, windowSeconds);
    
    const results = await pipeline.exec();
    const currentCount = results?.[1]?.[1] as number || 0;
    
    const allowed = currentCount < limit;
    
    if (!allowed) {
      await this.redis.zremrangebyrank(windowKey, -1, -1);
    }

    return {
      allowed,
      remaining: Math.max(0, limit - currentCount - (allowed ? 1 : 0)),
      resetAt: Math.floor((now + (windowSeconds * 1000)) / 1000),
    };
  }

  /** Circuit Breaker */
  async isCircuitOpen(service: string): Promise<boolean> {
    const key = RedisKeys.circuitBreaker(service);
    const state = await this.redis.get(key);
    return state === 'OPEN';
  }

  async recordFailure(service: string, threshold: number, windowSeconds = 60): Promise<void> {
    const countKey = RedisKeys.circuitFailureCount(service);
    const circuitKey = RedisKeys.circuitBreaker(service);
    
    const now = Date.now();
    const windowStart = now - (windowSeconds * 1000);
    
    const pipeline = this.redis.pipeline();
    pipeline.zremrangebyscore(countKey, 0, windowStart);
    pipeline.zadd(countKey, now, `${now}-${Math.random()}`);
    pipeline.expire(countKey, windowSeconds);
    pipeline.zcard(countKey);
    
    const results = await pipeline.exec();
    const count = results?.[3]?.[1] as number || 0;
    
    if (count >= threshold) {
      await this.redis.setex(circuitKey, RedisTTL.CIRCUIT_OPEN, 'OPEN');
    }
  }

  async recordSuccess(service: string): Promise<void> {
    await this.redis.del(RedisKeys.circuitFailureCount(service));
    await this.redis.del(RedisKeys.circuitBreaker(service));
  }

  async cacheEvent(eventId: string, event: any): Promise<void> {
    await this.redis.setex(
      RedisKeys.eventCache(eventId),
      RedisTTL.EVENT_CACHE,
      JSON.stringify(event)
    );
  }

  async getCachedEvent(eventId: string): Promise<any | null> {
    const data = await this.redis.get(RedisKeys.eventCache(eventId));
    return data ? JSON.parse(data) : null;
  }

  async incrementIngestCounter(projectId: string, eventType: string): Promise<void> {
    const date = new Date().toISOString().split('T')[0]!;
    await this.redis.hincrby(
      RedisKeys.metricsCounter(projectId, date, eventType),
      'count',
      1
    );
    await this.redis.expire(RedisKeys.metricsCounter(projectId, date!, eventType), 86400 * 7);
  }

  async recordLastIngest(projectId: string): Promise<void> {
    await this.redis.setex(
      RedisKeys.lastIngest(projectId),
      RedisTTL.HEALTH,
      Date.now().toString()
    );
  }

  async ping(): Promise<'PONG'> {
    return this.redis.ping();
  }

  get client(): Redis {
    return this.redis;
  }
}