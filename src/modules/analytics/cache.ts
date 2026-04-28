import { LRUCache } from "lru-cache";

interface CacheEntry<T> {
  data: T;
  source: "lru" | "redis";
}

interface RedisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: "EX", ttlSeconds: number): Promise<unknown>;
  del(...keys: string[]): Promise<unknown>;
  ping(): Promise<string>;
  scanStream(options: { match: string; count: number }): AsyncIterable<string[]>;
}

export class AnalyticsCache {
  private readonly lru = new LRUCache<string, any>({
    max: 5_000,
    ttl: 60_000,
    updateAgeOnGet: true,
  });

  constructor(private readonly redisClient: RedisLike) {}

  getLru<T>(key: string): T | undefined {
    return this.lru.get(key) as T | undefined;
  }

  setLru(key: string, value: unknown, ttlSeconds = 60): void {
    this.lru.set(key, value, { ttl: ttlSeconds * 1_000 });
  }

  async getRedis<T>(key: string): Promise<T | null> {
    try {
      const value = await this.redisClient.get(key);
      return value ? (JSON.parse(value) as T) : null;
    } catch {
      return null;
    }
  }

  async setRedis(key: string, value: unknown, ttlSeconds = 60): Promise<void> {
    try {
      await this.redisClient.set(key, JSON.stringify(value), "EX", ttlSeconds);
    } catch {
      // Redis is an optimization for analytics. Read paths must still work.
    }
  }

  async get<T>(key: string): Promise<CacheEntry<T> | null> {
    const lruValue = this.getLru<T>(key);
    if (lruValue !== undefined) {
      return { data: lruValue, source: "lru" };
    }

    const redisValue = await this.getRedis<T>(key);
    if (redisValue !== null) {
      this.setLru(key, redisValue);
      return { data: redisValue, source: "redis" };
    }

    return null;
  }

  async set(key: string, value: unknown, ttlSeconds = 60): Promise<void> {
    this.setLru(key, value, ttlSeconds);
    await this.setRedis(key, value, ttlSeconds);
  }

  async invalidate(key: string): Promise<void> {
    this.lru.delete(key);
    try {
      await this.redisClient.del(key);
    } catch {
      // Best-effort invalidation.
    }
  }

  async invalidateProject(projectId: string): Promise<void> {
    this.lru.clear();
    try {
      const stream = this.redisClient.scanStream({
        match: `analytics:*:${projectId}:*`,
        count: 100,
      });

      for await (const keys of stream as AsyncIterable<string[]>) {
        if (keys.length > 0) {
          await this.redisClient.del(...keys);
        }
      }
    } catch {
      // Best-effort invalidation.
    }
  }

  async isHealthy(): Promise<boolean> {
    try {
      return (await this.redisClient.ping()) === "PONG";
    } catch {
      return false;
    }
  }
}
