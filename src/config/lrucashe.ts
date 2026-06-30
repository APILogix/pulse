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

/**
 * Cached resolved SDK config sets for the SDK runtime fetch path, keyed by
 * `${orgId}:${projectId ?? 'org'}:${environment}:${platform ?? 'all'}`. The
 * fetch path can be very hot, so we keep the resolved set in-process (no Redis)
 * with a short TTL. The SDK-config service evicts the org's entries on any
 * create/update/rollback so changes propagate before the TTL elapses.
 */
import type { SdkConfigResolvedDto } from '../modules/organization/sdk-config.types.js';

export const sdkConfigCache = new LRUCache<string, SdkConfigResolvedDto[]>({
  max: 20000,
  ttl: 1000 * 30, // 30 seconds
  updateAgeOnGet: false,
  allowStale: false,
});

/** Build the cache key for a resolved SDK config set. */
export function sdkConfigCacheKey(
  orgId: string,
  projectId: string | null | undefined,
  environment: string,
  platform: string | null | undefined,
): string {
  return `${orgId}:${projectId ?? 'org'}:${environment}:${platform ?? 'all'}`;
}

/**
 * Evict every cached SDK config set for an org. Called on any config mutation.
 * LRUCache has no prefix delete, so we scan keys (bounded by `max`) and drop
 * those for the org — cheap relative to a DB round-trip and keeps reads correct.
 */
export function evictSdkConfigCache(orgId: string): void {
  const prefix = `${orgId}:`;
  for (const key of sdkConfigCache.keys()) {
    if (key.startsWith(prefix)) sdkConfigCache.delete(key);
  }
}