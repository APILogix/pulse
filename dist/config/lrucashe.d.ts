import { LRUCache } from 'lru-cache';
export interface CachedProjectConfig {
    id: string;
    orgId: string;
    name: string;
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
    samplingRules: Record<string, unknown>;
    featureFlags: Record<string, unknown>;
    sdkConfig: Record<string, unknown>;
    isActive: boolean;
    apiKeyId: string;
    /** Billing plan tier resolved at key-lookup time; drives queue priority. */
    planTier?: 'free' | 'starter' | 'growth' | 'business' | 'enterprise';
    /** Optional org-wide rate limits overriding the platform defaults. */
    orgRateLimitPerSecond?: number;
    orgRateLimitPerMinute?: number;
    orgRateLimitPerHour?: number;
}
export declare const apiKeyCache: LRUCache<string, CachedProjectConfig, unknown>;
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
export declare const alertThresholdCache: LRUCache<string, CachedAlertThresholds, unknown>;
/** Build the cache key for an org/project alert-threshold config. */
export declare function alertThresholdCacheKey(orgId: string, projectId?: string | null): string;
/** Evict a cached alert-threshold config after an update. */
export declare function evictAlertThresholdCache(orgId: string, projectId?: string | null): void;
/**
 * Cached resolved SDK config sets for the SDK runtime fetch path, keyed by
 * `${orgId}:${projectId ?? 'org'}:${environment}:${platform ?? 'all'}`. The
 * fetch path can be very hot, so we keep the resolved set in-process (no Redis)
 * with a short TTL. The SDK-config service evicts the org's entries on any
 * create/update/rollback so changes propagate before the TTL elapses.
 */
import type { SdkConfigResolvedDto } from '../modules/organization/sdk-config.types.js';
export declare const sdkConfigCache: LRUCache<string, SdkConfigResolvedDto[], unknown>;
/** Build the cache key for a resolved SDK config set. */
export declare function sdkConfigCacheKey(orgId: string, projectId: string | null | undefined, environment: string, platform: string | null | undefined): string;
/**
 * Evict every cached SDK config set for an org. Called on any config mutation.
 * LRUCache has no prefix delete, so we scan keys (bounded by `max`) and drop
 * those for the org — cheap relative to a DB round-trip and keeps reads correct.
 */
export declare function evictSdkConfigCache(orgId: string): void;
//# sourceMappingURL=lrucashe.d.ts.map