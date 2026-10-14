import type { Redis } from "ioredis";
import type { ApiKeyMapping, OperatorOverride } from "../../modules/projects/sdk-config/delivery.js";
import type { DeliveryResult } from "../../modules/projects/sdk-config/sdk-config.service.js";
import type { SchemaV1Config } from "../../modules/projects/sdk-config/schema-v1.js";
export interface CachedApiKeyRecord {
    organizationId: string;
    projectId: string;
    defaultEnvironmentId: string;
    allowedEnvironmentIds: string[];
    secretHash: string;
    keyId?: string;
    allowedIps?: string[];
    allowedEndpoints?: string[];
}
export interface CachedCompiledConfigRecord {
    revisionNo: number;
    environmentId?: string;
    compiledSnapshot: SchemaV1Config;
}
export interface CachedOrgOverrideRecord {
    override: OperatorOverride | null;
}
export interface CachedInitDeliveryRecord {
    organizationId: string;
    projectId: string;
    environmentId: string;
    revisionNo: number;
    config: SchemaV1Config;
    etag: string;
    usedDefaultFallback: boolean;
}
export interface CachedRemoteConfigDoc {
    version: number;
    projectId: string;
    organizationId: string;
    environmentId: string;
    environment: string;
    release: string;
    etag: string;
    configHash: string;
    config: SchemaV1Config;
}
export declare class RedisLookupCache {
    private readonly client;
    private readonly readTimeoutMs;
    private readCooldownUntil;
    private pendingReads;
    private readonly l1ApiKeyCache;
    private readonly l1InitDeliveryCache;
    private readonly l1NegativeKeyCache;
    private readonly l1IpJailCache;
    private readonly l1OrgOverrideCache;
    private readonly l1RemoteConfigCache;
    private readonly l1RateLimitCache;
    private consecutiveReadFailures;
    constructor(client?: Redis, readTimeoutMs?: number);
    /** Cache latency must not consume the SDK startup budget. Never queue unbounded reads. */
    private read;
    /**
     * Fast availability check: only dispatch when the client is 'ready'.
     * When disconnected or in 'wait' mode, trigger reconnection and fail open cleanly.
     */
    private isAvailable;
    /**
     * Look up API key mapping by raw API key.
     * Performs constant-time verification against the cached secret_hash.
     */
    getApiKeyMapping(rawKey: string): Promise<ApiKeyMapping | null>;
    /**
     * Cache API key mapping with secret hash.
     */
    setApiKeyMapping(rawKey: string, mapping: ApiKeyMapping, secretHash: string, ttlSeconds?: number): Promise<void>;
    /**
     * Invalidate cached API key by key hash or public prefix.
     */
    invalidateApiKey(keyHash: string): Promise<void>;
    getCompiledConfigByEnv(environmentId: string): Promise<{
        revisionNo: number;
        compiledSnapshot: SchemaV1Config;
    } | null>;
    setCompiledConfigByEnv(environmentId: string, data: {
        revisionNo: number;
        compiledSnapshot: SchemaV1Config;
    }, ttlSeconds?: number): Promise<void>;
    getCompiledConfigByMeta(organizationId: string, projectId: string, environment: string): Promise<{
        revisionNo: number;
        environmentId: string;
        compiledSnapshot: SchemaV1Config;
    } | null>;
    setCompiledConfigByMeta(organizationId: string, projectId: string, environment: string, data: {
        revisionNo: number;
        environmentId: string;
        compiledSnapshot: SchemaV1Config;
    }, ttlSeconds?: number): Promise<void>;
    invalidateSdkConfig(environmentId?: string, organizationId?: string, projectId?: string, environment?: string): Promise<void>;
    getOrgEntitlementOverride(organizationId: string): Promise<OperatorOverride | undefined | null>;
    setOrgEntitlementOverride(organizationId: string, override: OperatorOverride | undefined, ttlSeconds?: number): Promise<void>;
    invalidateOrgOverride(organizationId: string): Promise<void>;
    getInitDelivery(rawKey: string, hintsHash: string): Promise<DeliveryResult | null>;
    setInitDelivery(rawKey: string, hintsHash: string, result: DeliveryResult, ttlSeconds?: number): Promise<void>;
    invalidateInitDelivery(rawKey: string): Promise<void>;
    /**
     * Ultra-fast synchronous L1 cache check (< 5 microseconds).
     * Safe to call on high-throughput hot paths like telemetry batch admission.
     */
    getRemoteConfigL1(projectId: string, environment?: string | null): CachedRemoteConfigDoc | null;
    /**
     * Fast-path lookup for the materialized remote SDK configuration.
     * Checks Tier-0 L1 in-memory LRU cache first (<0.01ms), then Redis indefinitely cached key.
     */
    getRemoteConfig(projectId: string, environment?: string | null): Promise<CachedRemoteConfigDoc | null>;
    /**
     * Authoritatively cache the final SDK configuration in Redis WITHOUT an application-level TTL.
     * Config remains cached indefinitely until explicitly updated or invalidated.
     */
    setRemoteConfig(doc: CachedRemoteConfigDoc): Promise<void>;
    /**
     * Explicitly invalidate the remote config cache whenever configuration or project settings change.
     */
    invalidateRemoteConfig(projectId: string, environment?: string | null): Promise<void>;
    /**
     * Programmatic inspection of key TTL. Returns -1 for persistent / no expiration,
     * -2 if key does not exist, or remaining seconds if an expiration is set.
     */
    getRemoteConfigTtl(projectId: string, environment?: string | null): Promise<number>;
    isKeyNegativeCached(rawKey: string): Promise<boolean>;
    setNegativeKey(rawKey: string, ttlSeconds?: number): Promise<void>;
    isIpJailed(ip: string): Promise<boolean>;
    recordAuthFailure(ip: string, maxFailures?: number, jailSeconds?: number): Promise<{
        jailed: boolean;
        count: number;
    }>;
    /**
     * Ultra-fast in-process token-bucket rate limiter with non-blocking async Redis persistence.
     * Completely eliminates 400ms WAN latency on every single /init request.
     */
    checkDeliveryRateLimit(identifier: string, limit?: number, windowSeconds?: number): Promise<{
        allowed: boolean;
        remaining: number;
        resetSeconds: number;
    }>;
}
export declare const redisLookupCache: RedisLookupCache;
export default redisLookupCache;
//# sourceMappingURL=lookup-cache.d.ts.map