interface CacheEntry<T> {
    data: T;
    source: "lru" | "redis";
}
interface LruLookup<T> {
    hit: boolean;
    data: T | undefined;
}
interface RedisLike {
    get(key: string): Promise<string | null>;
    set(key: string, value: string, mode: "EX", ttlSeconds: number): Promise<unknown>;
    del(...keys: string[]): Promise<unknown>;
    ping(): Promise<string>;
    scanStream(options: {
        match: string;
        count: number;
    }): AsyncIterable<string[]>;
}
export declare class AnalyticsCache {
    private readonly redisClient;
    private readonly defaultTtlSeconds;
    private readonly log;
    private readonly lru;
    constructor(redisClient: RedisLike);
    getLru<T>(key: string): LruLookup<T>;
    setLru(key: string, value: unknown, ttlSeconds?: number): void;
    getRedis<T>(key: string): Promise<T | null>;
    setRedis(key: string, value: unknown, ttlSeconds?: number): Promise<void>;
    get<T>(key: string): Promise<CacheEntry<T> | null>;
    set(key: string, value: unknown, ttlSeconds?: number): Promise<void>;
    invalidate(key: string): Promise<void>;
    invalidateProject(projectId: string): Promise<void>;
    isHealthy(): Promise<boolean>;
}
export {};
//# sourceMappingURL=cache.d.ts.map