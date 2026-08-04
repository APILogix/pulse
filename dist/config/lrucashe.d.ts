import { LRUCache } from 'lru-cache';
import type { SdkConfigResolvedDto } from '../modules/organization/sdk-config/sdk-config.types.js';
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
/** Published SDK configuration cache, keyed only by environment ID. */
export declare const sdkConfigCache: LRUCache<string, SdkConfigResolvedDto, unknown>;
export declare function sdkConfigCacheKey(environmentId: string): string;
export declare function evictSdkConfigCache(environmentId: string): void;
//# sourceMappingURL=lrucashe.d.ts.map