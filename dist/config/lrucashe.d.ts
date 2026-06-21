import { LRUCache } from 'lru-cache';
export interface CachedProjectConfig {
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
export declare const apiKeyCache: LRUCache<string, CachedProjectConfig, unknown>;
//# sourceMappingURL=lrucashe.d.ts.map