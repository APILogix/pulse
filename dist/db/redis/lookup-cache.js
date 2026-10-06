/**
 * RedisLookupCache — Enterprise-grade, fail-open Redis caching layer for
 * hot-path SDK initialization, API key verification, compiled SDK configuration,
 * and organization entitlement lookups.
 *
 * Design Goals:
 * 1. Sub-millisecond lookup latency for SDK /v1/init and /v1/sdk-config.
 * 2. Zero database connection usage on warm cache hits.
 * 3. Fail-open resilience: all Redis errors or disconnects degrade cleanly to PostgreSQL.
 * 4. Lean data serialization: stores only required fields to save Redis memory.
 * 5. Constant-time compare on secret hash to prevent timing attacks.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { LRUCache } from "lru-cache";
import { redis } from "../../config/redis.js";
import { logger } from "../../config/logger.js";
import { RedisKeys, RedisTTL } from "./keys.js";
const cacheLogger = logger.child({ component: "redis-lookup-cache" });
function sha256Hex(input) {
    return createHash("sha256").update(input, "utf8").digest("hex");
}
function constantTimeHexEqual(a, b) {
    const bufA = Buffer.from(a, "utf8");
    const bufB = Buffer.from(b, "utf8");
    if (bufA.length !== bufB.length) {
        timingSafeEqual(bufA, bufA);
        return false;
    }
    return timingSafeEqual(bufA, bufB);
}
export class RedisLookupCache {
    client;
    readTimeoutMs;
    readCooldownUntil = 0;
    pendingReads = 0;
    // Tier-0 In-Memory LRU Caches for sub-millisecond hot-path lookups
    l1ApiKeyCache = new LRUCache({
        max: 10_000,
        ttl: 1000 * 60 * 60, // 1 hour in-process TTL; explicitly invalidated on key changes
    });
    l1InitDeliveryCache = new LRUCache({
        max: 5_000,
        ttl: 1000 * 60 * 60, // 1 hour in-process TTL
    });
    l1NegativeKeyCache = new LRUCache({
        max: 10_000,
        ttl: 30_000, // 30 seconds
    });
    l1IpJailCache = new LRUCache({
        max: 5_000,
        ttl: 60_000, // 60 seconds
    });
    l1OrgOverrideCache = new LRUCache({
        max: 2_000,
        ttl: 1000 * 60 * 60, // 1 hour in-process TTL
    });
    l1RemoteConfigCache = new LRUCache({
        max: 5_000,
        ttl: 1000 * 60 * 60 * 24, // 24 hours in-process TTL; explicitly invalidated on config update
    });
    l1RateLimitCache = new LRUCache({
        max: 10_000,
        ttl: 60_000, // 60 seconds
    });
    consecutiveReadFailures = 0;
    constructor(client = redis, readTimeoutMs = 1500) {
        this.client = client;
        this.readTimeoutMs = readTimeoutMs;
    }
    /** Cache latency must not consume the SDK startup budget. Never queue unbounded reads. */
    async read(key) {
        if (Date.now() < this.readCooldownUntil || this.pendingReads >= 256)
            return null;
        this.pendingReads++;
        let timer;
        const operation = Promise.resolve().then(() => this.client.get(key));
        const release = () => { this.pendingReads--; };
        void operation.then(release, release);
        try {
            const res = await Promise.race([
                operation,
                new Promise((resolve) => {
                    timer = setTimeout(() => {
                        this.consecutiveReadFailures++;
                        if (this.consecutiveReadFailures >= 3) {
                            this.readCooldownUntil = Date.now() + 2_000;
                        }
                        resolve(null);
                    }, this.readTimeoutMs);
                }),
            ]);
            if (res !== null) {
                this.consecutiveReadFailures = 0;
            }
            return res;
        }
        catch {
            this.consecutiveReadFailures++;
            if (this.consecutiveReadFailures >= 3) {
                this.readCooldownUntil = Date.now() + 2_000;
            }
            return null;
        }
        finally {
            clearTimeout(timer);
        }
    }
    /**
     * Fast availability check: only dispatch when the client is 'ready'.
     * When disconnected or in 'wait' mode, trigger reconnection and fail open cleanly.
     */
    isAvailable() {
        if (!this.client)
            return false;
        const status = this.client.status;
        if (status === undefined)
            return true; // Mocked client in unit tests
        if (status === "ready")
            return true;
        if (status === "end" || status === "close" || status === "wait") {
            void this.client.connect?.().catch(() => { });
        }
        return false;
    }
    // ── 1. API Key Mapping ──────────────────────────────────────────────────
    /**
     * Look up API key mapping by raw API key.
     * Performs constant-time verification against the cached secret_hash.
     */
    async getApiKeyMapping(rawKey) {
        const keyHash = sha256Hex(rawKey);
        // 0. Fast-path: Check Tier-0 in-memory LRU cache (<0.01ms)
        const l1Record = this.l1ApiKeyCache.get(keyHash);
        if (l1Record) {
            if (!constantTimeHexEqual(keyHash, l1Record.secretHash)) {
                this.l1ApiKeyCache.delete(keyHash);
                return null;
            }
            return {
                organizationId: l1Record.organizationId,
                projectId: l1Record.projectId,
                defaultEnvironmentId: l1Record.defaultEnvironmentId,
                allowedEnvironmentIds: l1Record.allowedEnvironmentIds,
                ...(l1Record.keyId ? { keyId: l1Record.keyId } : {}),
                ...(l1Record.allowedIps && l1Record.allowedIps.length > 0 ? { allowedIps: l1Record.allowedIps } : {}),
                ...(l1Record.allowedEndpoints && l1Record.allowedEndpoints.length > 0 ? { allowedEndpoints: l1Record.allowedEndpoints } : {}),
            };
        }
        if (!this.isAvailable())
            return null;
        try {
            const cacheKey = RedisKeys.lookupApiKey(keyHash);
            const data = await this.read(cacheKey);
            if (!data)
                return null;
            const record = JSON.parse(data);
            if (!record || typeof record !== "object" || !record.secretHash)
                return null;
            // Constant-time secret hash check to ensure credentials match
            if (!constantTimeHexEqual(keyHash, record.secretHash)) {
                cacheLogger.warn({ keyHash: keyHash.slice(0, 10) }, "Cached API key secret hash mismatch");
                return null;
            }
            // Populate Tier-0 L1 cache
            this.l1ApiKeyCache.set(keyHash, record);
            return {
                organizationId: record.organizationId,
                projectId: record.projectId,
                defaultEnvironmentId: record.defaultEnvironmentId,
                allowedEnvironmentIds: record.allowedEnvironmentIds,
                ...(record.keyId ? { keyId: record.keyId } : {}),
                ...(record.allowedIps && record.allowedIps.length > 0 ? { allowedIps: record.allowedIps } : {}),
                ...(record.allowedEndpoints && record.allowedEndpoints.length > 0 ? { allowedEndpoints: record.allowedEndpoints } : {}),
            };
        }
        catch (err) {
            cacheLogger.debug({ err }, "Redis getApiKeyMapping failed (failing open to DB)");
            return null;
        }
    }
    /**
     * Cache API key mapping with secret hash.
     */
    async setApiKeyMapping(rawKey, mapping, secretHash, ttlSeconds = RedisTTL.LOOKUP_API_KEY) {
        const keyHash = sha256Hex(rawKey);
        const record = {
            organizationId: mapping.organizationId,
            projectId: mapping.projectId,
            defaultEnvironmentId: mapping.defaultEnvironmentId,
            allowedEnvironmentIds: mapping.allowedEnvironmentIds,
            ...(mapping.keyId ? { keyId: mapping.keyId } : {}),
            ...(mapping.allowedIps && mapping.allowedIps.length > 0 ? { allowedIps: mapping.allowedIps } : {}),
            ...(mapping.allowedEndpoints && mapping.allowedEndpoints.length > 0 ? { allowedEndpoints: mapping.allowedEndpoints } : {}),
            secretHash,
        };
        // Always populate Tier-0 in-memory cache
        this.l1ApiKeyCache.set(keyHash, record);
        if (!this.isAvailable())
            return;
        try {
            const cacheKey = RedisKeys.lookupApiKey(keyHash);
            await this.client.setex(cacheKey, ttlSeconds, JSON.stringify(record));
        }
        catch (err) {
            cacheLogger.debug({ err }, "Redis setApiKeyMapping failed");
        }
    }
    /**
     * Invalidate cached API key by key hash or public prefix.
     */
    async invalidateApiKey(keyHash) {
        this.l1ApiKeyCache.delete(keyHash);
        if (!this.isAvailable())
            return;
        try {
            await this.client.del(RedisKeys.lookupApiKey(keyHash));
        }
        catch (err) {
            cacheLogger.debug({ err, keyHash: keyHash.slice(0, 10) }, "Redis invalidateApiKey failed");
        }
    }
    // ── 2. Compiled SDK Config by Environment ID ────────────────────────────
    async getCompiledConfigByEnv(environmentId) {
        if (!this.isAvailable())
            return null;
        try {
            const cacheKey = RedisKeys.lookupSdkConfigByEnv(environmentId);
            const data = await this.read(cacheKey);
            if (!data)
                return null;
            const record = JSON.parse(data);
            if (!record || typeof record.revisionNo !== "number" || !record.compiledSnapshot)
                return null;
            return {
                revisionNo: record.revisionNo,
                compiledSnapshot: record.compiledSnapshot,
            };
        }
        catch (err) {
            cacheLogger.debug({ err, environmentId }, "Redis getCompiledConfigByEnv failed (failing open to DB)");
            return null;
        }
    }
    async setCompiledConfigByEnv(environmentId, data, ttlSeconds = RedisTTL.LOOKUP_SDK_CONFIG) {
        if (!this.isAvailable())
            return;
        try {
            const cacheKey = RedisKeys.lookupSdkConfigByEnv(environmentId);
            const record = {
                revisionNo: data.revisionNo,
                compiledSnapshot: data.compiledSnapshot,
            };
            await this.client.setex(cacheKey, ttlSeconds, JSON.stringify(record));
        }
        catch (err) {
            cacheLogger.debug({ err, environmentId }, "Redis setCompiledConfigByEnv failed");
        }
    }
    // ── 3. Compiled SDK Config by Metadata (Org + Project + EnvSlug) ────────
    async getCompiledConfigByMeta(organizationId, projectId, environment) {
        if (!this.isAvailable())
            return null;
        try {
            const cacheKey = RedisKeys.lookupSdkConfigByMeta(organizationId, projectId, environment);
            const data = await this.read(cacheKey);
            if (!data)
                return null;
            const record = JSON.parse(data);
            if (!record ||
                typeof record.revisionNo !== "number" ||
                !record.environmentId ||
                !record.compiledSnapshot) {
                return null;
            }
            return {
                revisionNo: record.revisionNo,
                environmentId: record.environmentId,
                compiledSnapshot: record.compiledSnapshot,
            };
        }
        catch (err) {
            cacheLogger.debug({ err, organizationId, projectId, environment }, "Redis getCompiledConfigByMeta failed");
            return null;
        }
    }
    async setCompiledConfigByMeta(organizationId, projectId, environment, data, ttlSeconds = RedisTTL.LOOKUP_SDK_CONFIG) {
        if (!this.isAvailable())
            return;
        try {
            const cacheKey = RedisKeys.lookupSdkConfigByMeta(organizationId, projectId, environment);
            const record = {
                revisionNo: data.revisionNo,
                environmentId: data.environmentId,
                compiledSnapshot: data.compiledSnapshot,
            };
            await this.client.setex(cacheKey, ttlSeconds, JSON.stringify(record));
        }
        catch (err) {
            cacheLogger.debug({ err, organizationId, projectId, environment }, "Redis setCompiledConfigByMeta failed");
        }
    }
    async invalidateSdkConfig(environmentId, organizationId, projectId, environment) {
        if (!this.isAvailable())
            return;
        try {
            const pipeline = this.client.pipeline();
            if (environmentId) {
                pipeline.del(RedisKeys.lookupSdkConfigByEnv(environmentId));
            }
            if (organizationId && projectId && environment) {
                pipeline.del(RedisKeys.lookupSdkConfigByMeta(organizationId, projectId, environment));
            }
            await pipeline.exec();
        }
        catch (err) {
            cacheLogger.debug({ err }, "Redis invalidateSdkConfig failed");
        }
    }
    // ── 4. Organization Entitlement / Operator Override Cache ──────────────
    async getOrgEntitlementOverride(organizationId) {
        // 0. Fast-path: Check Tier-0 in-memory LRU cache (<0.01ms)
        const l1Record = this.l1OrgOverrideCache.get(organizationId);
        if (l1Record) {
            return l1Record.override ?? undefined;
        }
        if (!this.isAvailable())
            return null;
        try {
            const cacheKey = RedisKeys.lookupOrgOverride(organizationId);
            const data = await this.read(cacheKey);
            if (data === null)
                return null; // Cache miss
            const record = JSON.parse(data);
            this.l1OrgOverrideCache.set(organizationId, record);
            return record.override ?? undefined;
        }
        catch (err) {
            cacheLogger.debug({ err, organizationId }, "Redis getOrgEntitlementOverride failed (failing open)");
            return null;
        }
    }
    async setOrgEntitlementOverride(organizationId, override, ttlSeconds = RedisTTL.LOOKUP_ORG_OVERRIDE) {
        const record = {
            override: override ?? null,
        };
        this.l1OrgOverrideCache.set(organizationId, record);
        if (!this.isAvailable())
            return;
        try {
            const cacheKey = RedisKeys.lookupOrgOverride(organizationId);
            await this.client.setex(cacheKey, ttlSeconds, JSON.stringify(record));
        }
        catch (err) {
            cacheLogger.debug({ err, organizationId }, "Redis setOrgEntitlementOverride failed");
        }
    }
    async invalidateOrgOverride(organizationId) {
        this.l1OrgOverrideCache.delete(organizationId);
        if (!this.isAvailable())
            return;
        try {
            await this.client.del(RedisKeys.lookupOrgOverride(organizationId));
        }
        catch (err) {
            cacheLogger.debug({ err, organizationId }, "Redis invalidateOrgOverride failed");
        }
    }
    // ── 5. Full Composite Delivery Result Fast-Path ────────────────────────
    async getInitDelivery(rawKey, hintsHash) {
        const keyHash = sha256Hex(rawKey);
        const l1Key = `${keyHash}:${hintsHash}`;
        const l1Record = this.l1InitDeliveryCache.get(l1Key);
        if (l1Record && l1Record.config && l1Record.etag) {
            return {
                organizationId: l1Record.organizationId,
                projectId: l1Record.projectId,
                environmentId: l1Record.environmentId,
                revisionNo: l1Record.revisionNo,
                config: l1Record.config,
                etag: l1Record.etag,
                usedDefaultFallback: l1Record.usedDefaultFallback ?? false,
            };
        }
        if (!this.isAvailable())
            return null;
        try {
            const cacheKey = RedisKeys.lookupInitDelivery(keyHash, hintsHash);
            const data = await this.read(cacheKey);
            if (!data)
                return null;
            const record = JSON.parse(data);
            if (!record || !record.config || !record.etag)
                return null;
            this.l1InitDeliveryCache.set(l1Key, record);
            return {
                organizationId: record.organizationId,
                projectId: record.projectId,
                environmentId: record.environmentId,
                revisionNo: record.revisionNo,
                config: record.config,
                etag: record.etag,
                usedDefaultFallback: record.usedDefaultFallback ?? false,
            };
        }
        catch (err) {
            cacheLogger.debug({ err }, "Redis getInitDelivery failed (failing open)");
            return null;
        }
    }
    async setInitDelivery(rawKey, hintsHash, result, ttlSeconds = RedisTTL.LOOKUP_INIT_DELIVERY) {
        const keyHash = sha256Hex(rawKey);
        const record = {
            organizationId: result.organizationId,
            projectId: result.projectId,
            environmentId: result.environmentId,
            revisionNo: result.revisionNo,
            config: result.config,
            etag: result.etag,
            usedDefaultFallback: result.usedDefaultFallback ?? false,
        };
        this.l1InitDeliveryCache.set(`${keyHash}:${hintsHash}`, record);
        if (!this.isAvailable())
            return;
        try {
            const cacheKey = RedisKeys.lookupInitDelivery(keyHash, hintsHash);
            await this.client.setex(cacheKey, ttlSeconds, JSON.stringify(record));
        }
        catch (err) {
            cacheLogger.debug({ err }, "Redis setInitDelivery failed");
        }
    }
    async invalidateInitDelivery(rawKey) {
        const keyHash = sha256Hex(rawKey);
        for (const k of this.l1InitDeliveryCache.keys()) {
            if (k.startsWith(`${keyHash}:`)) {
                this.l1InitDeliveryCache.delete(k);
            }
        }
        if (!this.isAvailable())
            return;
        try {
            await this.client.del(RedisKeys.lookupInitDelivery(keyHash, "default"));
            await this.client.del(RedisKeys.lookupInitDelivery(keyHash, "empty"));
        }
        catch (err) {
            cacheLogger.debug({ err }, "Redis invalidateInitDelivery failed");
        }
    }
    // ── 5b. Permanent Project-Scoped Remote Config Cache (No TTL) ────────────
    /**
     * Fast-path lookup for the materialized remote SDK configuration.
     * Checks Tier-0 L1 in-memory LRU cache first (<0.01ms), then Redis indefinitely cached key.
     */
    async getRemoteConfig(projectId, environment) {
        const cacheKey = RedisKeys.remoteConfig(projectId, environment);
        const defaultKey = RedisKeys.remoteConfig(projectId);
        // 0. Tier-0 L1 in-memory LRU cache (<0.01ms)
        let l1 = this.l1RemoteConfigCache.get(cacheKey);
        if (!l1 && (!environment || environment === "production" || environment === "default")) {
            l1 = this.l1RemoteConfigCache.get(defaultKey);
        }
        if (l1 && l1.config && l1.etag) {
            return l1;
        }
        if (!this.isAvailable())
            return null;
        try {
            let data = await this.read(cacheKey);
            if (!data && (!environment || environment === "production" || environment === "default") && cacheKey !== defaultKey) {
                data = await this.read(defaultKey);
            }
            if (!data)
                return null;
            const doc = JSON.parse(data);
            if (!doc || typeof doc.version !== "number" || !doc.config || !doc.etag) {
                return null;
            }
            // Populate Tier-0 L1 in-memory cache
            this.l1RemoteConfigCache.set(cacheKey, doc);
            if (!environment || environment === "production" || environment === "default") {
                this.l1RemoteConfigCache.set(defaultKey, doc);
            }
            return doc;
        }
        catch (err) {
            cacheLogger.debug({ err, projectId }, "Redis getRemoteConfig failed (failing open)");
            return null;
        }
    }
    /**
     * Authoritatively cache the final SDK configuration in Redis WITHOUT an application-level TTL.
     * Config remains cached indefinitely until explicitly updated or invalidated.
     */
    async setRemoteConfig(doc) {
        const cacheKey = RedisKeys.remoteConfig(doc.projectId, doc.environment);
        const defaultKey = RedisKeys.remoteConfig(doc.projectId);
        // Populate L1 cache immediately
        this.l1RemoteConfigCache.set(cacheKey, doc);
        // Also cache under default project key if environment is default or production
        if (doc.environment === "production" || !doc.environment || doc.environment === "default") {
            this.l1RemoteConfigCache.set(defaultKey, doc);
        }
        if (!this.isAvailable())
            return;
        try {
            const payload = JSON.stringify(doc);
            // STRICT ARCHITECTURAL REQUIREMENT: Cache in Redis WITHOUT an application-level TTL (indefinite hot cache)
            // Never use setex, EXPIRE, PX, or NX+TTL here.
            await this.client.set(cacheKey, payload);
            if (doc.environment === "production" || !doc.environment || doc.environment === "default") {
                await this.client.set(defaultKey, payload);
            }
        }
        catch (err) {
            cacheLogger.debug({ err, projectId: doc.projectId }, "Redis setRemoteConfig failed");
        }
    }
    /**
     * Explicitly invalidate the remote config cache whenever configuration or project settings change.
     */
    async invalidateRemoteConfig(projectId, environment) {
        const primaryKey = RedisKeys.remoteConfig(projectId, environment);
        const defaultKey = RedisKeys.remoteConfig(projectId);
        this.l1RemoteConfigCache.delete(primaryKey);
        this.l1RemoteConfigCache.delete(defaultKey);
        // Also sweep any L1 keys matching this project
        for (const k of this.l1RemoteConfigCache.keys()) {
            if (k.startsWith(`remote-config:${projectId}`)) {
                this.l1RemoteConfigCache.delete(k);
            }
        }
        if (!this.isAvailable())
            return;
        try {
            const pipeline = this.client.pipeline();
            pipeline.del(primaryKey);
            if (primaryKey !== defaultKey) {
                pipeline.del(defaultKey);
            }
            await pipeline.exec();
        }
        catch (err) {
            cacheLogger.debug({ err, projectId }, "Redis invalidateRemoteConfig failed");
        }
    }
    /**
     * Programmatic inspection of key TTL. Returns -1 for persistent / no expiration,
     * -2 if key does not exist, or remaining seconds if an expiration is set.
     */
    async getRemoteConfigTtl(projectId, environment) {
        if (!this.isAvailable())
            return -2;
        try {
            const cacheKey = RedisKeys.remoteConfig(projectId, environment);
            return await this.client.ttl(cacheKey);
        }
        catch {
            return -2;
        }
    }
    // ── Control-Plane Security & Anti-Abuse ─────────────────────────────────
    async isKeyNegativeCached(rawKey) {
        const keyHash = sha256Hex(rawKey);
        const cached = this.l1NegativeKeyCache.get(keyHash);
        if (cached !== undefined)
            return cached;
        if (!this.isAvailable())
            return false;
        try {
            const data = await this.read(RedisKeys.lookupNegativeKey(keyHash));
            const isNeg = Boolean(data);
            this.l1NegativeKeyCache.set(keyHash, isNeg);
            return isNeg;
        }
        catch {
            return false;
        }
    }
    async setNegativeKey(rawKey, ttlSeconds = RedisTTL.LOOKUP_NEGATIVE_KEY) {
        const keyHash = sha256Hex(rawKey);
        this.l1NegativeKeyCache.set(keyHash, true);
        if (!this.isAvailable())
            return;
        try {
            await this.client.setex(RedisKeys.lookupNegativeKey(keyHash), ttlSeconds, "1");
        }
        catch (err) {
            cacheLogger.debug({ err }, "Redis setNegativeKey failed");
        }
    }
    async isIpJailed(ip) {
        const cached = this.l1IpJailCache.get(ip);
        if (cached !== undefined)
            return cached;
        if (!this.isAvailable())
            return false;
        try {
            const data = await this.read(RedisKeys.ipJail(ip));
            const isJailed = Boolean(data);
            this.l1IpJailCache.set(ip, isJailed);
            return isJailed;
        }
        catch {
            return false;
        }
    }
    async recordAuthFailure(ip, maxFailures = 10, jailSeconds = RedisTTL.IP_JAIL) {
        if (!this.isAvailable())
            return { jailed: false, count: 0 };
        try {
            const failKey = RedisKeys.ipFailures(ip);
            const count = await this.client.incr(failKey);
            if (count === 1) {
                await this.client.expire(failKey, RedisTTL.IP_FAIL_WINDOW);
            }
            if (count >= maxFailures) {
                const jailKey = RedisKeys.ipJail(ip);
                await this.client.setex(jailKey, jailSeconds, "1");
                this.l1IpJailCache.set(ip, true);
                cacheLogger.warn({ ip, count }, "IP jailed due to excessive auth failures");
                return { jailed: true, count };
            }
            return { jailed: false, count };
        }
        catch (err) {
            cacheLogger.debug({ err, ip }, "Redis recordAuthFailure failed");
            return { jailed: false, count: 0 };
        }
    }
    /**
     * Ultra-fast in-process token-bucket rate limiter with non-blocking async Redis persistence.
     * Completely eliminates 400ms WAN latency on every single /init request.
     */
    async checkDeliveryRateLimit(identifier, limit = 120, windowSeconds = RedisTTL.DELIVERY_RATE_LIMIT) {
        const now = Date.now();
        let local = this.l1RateLimitCache.get(identifier);
        if (!local || now >= local.resetAt) {
            local = { count: 0, resetAt: now + windowSeconds * 1000 };
            this.l1RateLimitCache.set(identifier, local);
        }
        local.count++;
        const remaining = Math.max(0, limit - local.count);
        const resetSeconds = Math.max(1, Math.ceil((local.resetAt - now) / 1000));
        if (local.count > limit) {
            return { allowed: false, remaining: 0, resetSeconds };
        }
        // Sync to Redis off hot-path (non-blocking)
        if (this.isAvailable() && (local.count === 1 || local.count % 10 === 0)) {
            const key = RedisKeys.deliveryRateLimit(identifier);
            void this.client.pipeline().incrby(key, local.count === 1 ? 1 : 10).expire(key, windowSeconds).exec().catch(() => { });
        }
        return {
            allowed: true,
            remaining,
            resetSeconds,
        };
    }
}
export const redisLookupCache = new RedisLookupCache(redis, 1500);
export default redisLookupCache;
//# sourceMappingURL=lookup-cache.js.map