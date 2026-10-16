import { LRUCache } from 'lru-cache'
import type { SdkConfigResolvedDto } from '../modules/organization/sdk-config/sdk-config.types.js';

export interface CachedProjectConfig {
  id: string;
  orgId: string;
  name: string;
  slug?: string | undefined;
  orgName?: string | undefined;
  orgSlug?: string | undefined;
  /** Environment slug — kept for ingestion compatibility and SDK config resolution. */
  environment: string;
  /** Environment UUID from project_environments. */
  environmentId: string;
  /** Human-readable environment name (null when not resolved). */
  environmentName?: string | null;
  rateLimitPerSecond: number;
  rateLimitPerMinute: number;
  rateLimitPerHour: number | null;
  allowedEventTypes: string[];
  permissions: string[];
  allowedEndpoints: string[];
  blockedEndpoints: string[];
  allowedOrigins: string[];
  allowedIps: string[];
  allowedDomains: string[];
  allowedSdks: string[];
  isActive: boolean;
  apiKeyId: string;
  apiKeyName: string;
  /** Billing plan tier resolved at key-lookup time; drives queue priority. */
  planTier?: 'free' | 'starter' | 'growth' | 'business' | 'enterprise';
  /** Optional org-wide rate limits overriding the platform defaults. */
  orgRateLimitPerSecond?: number;
  orgRateLimitPerMinute?: number;
  orgRateLimitPerHour?: number;
}

import { registerL1Cache, publishInvalidation } from '../shared/cache/invalidation-bus.js';

export const apiKeyCache = new LRUCache<string, CachedProjectConfig>({
  max: 5000,
  ttl: 1000 * 60, // 60 seconds backstop TTL (Tier 0.3)
  updateAgeOnGet: false,
  allowStale: false,
});

/**
 * Separate bounded LRU for invalid API keys (Tier 1.3 negative caching).
 * Max: 10,000, TTL: 30 seconds.
 * Keyed strictly by SHA-256 hash of the key, NEVER the raw key.
 */
export const invalidApiKeyCache = new LRUCache<string, boolean>({
  max: 10_000,
  ttl: 30_000, // 30 seconds
  updateAgeOnGet: false,
  allowStale: false,
});

registerL1Cache('apiKey', {
  delete: (key: string) => {
    apiKeyCache.delete(key);
    invalidApiKeyCache.delete(key);
  },
  clear: () => {
    apiKeyCache.clear();
    invalidApiKeyCache.clear();
  },
});

export function evictApiKeyCache(keyHash: string): void {
  apiKeyCache.delete(keyHash);
  invalidApiKeyCache.delete(keyHash);
  void publishInvalidation('apiKey', keyHash);
}

/**
 * Cached organization alert-threshold config (latency SLO gates) keyed by
 * `${orgId}:${projectId ?? 'org'}`. The alerting evaluator reads this on every
 * window so we keep it in-process (no Redis). Short TTL bounds how long a
 * threshold edit takes to take effect; the org service also evicts explicitly
 * on update via evictAlertThresholdCache().
 */
export interface CachedAlertThresholds {
  orgId: string;
  projectId: string | null;
  p50ThresholdMs: number;
  p75ThresholdMs: number;
  p90ThresholdMs: number;
  p95ThresholdMs: number;
  p99ThresholdMs: number;
  p50AlertEnabled: boolean;
  p75AlertEnabled: boolean;
  p90AlertEnabled: boolean;
  p95AlertEnabled: boolean;
  p99AlertEnabled: boolean;
  errorRateThresholdPercent: number;
  errorRateAlertEnabled: boolean;
  apdexThreshold: number;
  apdexAlertEnabled: boolean;
  evaluationWindowMinutes: number;
  cooldownMinutes: number;
  alertsEnabled: boolean;
  notifyEmails: string[];
}

export const alertThresholdCache = new LRUCache<string, CachedAlertThresholds>({
  max: 20000,
  ttl: 1000 * 60, // 60 seconds
  updateAgeOnGet: false,
  allowStale: false,
});

/** Build the cache key for an org/project alert-threshold config. */
export function alertThresholdCacheKey(orgId: string, projectId?: string | null): string {
  return `${orgId}:${projectId ?? 'org'}`;
}

/** Evict a cached alert-threshold config after an update. */
export function evictAlertThresholdCache(orgId: string, projectId?: string | null): void {
  alertThresholdCache.delete(alertThresholdCacheKey(orgId, projectId));
}

/** Published SDK configuration cache, keyed only by environment ID. */

export const sdkConfigCache = new LRUCache<string, SdkConfigResolvedDto>({
  max: 20000,
  ttl: 1000 * 30,
  updateAgeOnGet: false,
  allowStale: false,
});

export function sdkConfigCacheKey(environmentId: string): string {
  return environmentId;
}

export function evictSdkConfigCache(environmentId: string): void {
  sdkConfigCache.delete(environmentId);
}
