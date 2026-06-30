import { LRUCache } from 'lru-cache'

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

export const apiKeyCache = new LRUCache<string, CachedProjectConfig>({
  max: 5000,
  ttl: 1000 * 60 * 30, // 30 minutes
  updateAgeOnGet: true,
  allowStale: false,
});