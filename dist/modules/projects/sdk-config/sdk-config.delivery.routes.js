/**
 * Canonical SDK delivery routes: `POST /v1/init` and `POST /v1/sdk-config`.
 *
 * Authorization is rooted in the presented API key (design.md §7.3, Property 1):
 *   - The bearer/X-API-Key credential is verified with a constant-time compare.
 *   - Organization comes from the key mapping.
 *   - Project/environment are SDK metadata and select a committed config inside
 *     that organization; environment UUIDs are not accepted from the SDK.
 *
 * Enterprise Security Hardening:
 *   - Edge & Origin Shield: Blocks browser cross-origin requests (`Sec-Fetch-Mode: cors`).
 *   - Zero-Trust IP Allowlisting: Verifies client IP against `allowed_ips` CIDR blocks.
 *   - Negative Caching & Abuse Jail: Protects PostgreSQL from key brute-force storms.
 *   - Cryptographic Request Signing: Verifies HMAC-SHA256 signature and ±5min timestamp replay defense.
 *   - Delivery Rate Limiting: Redis token-bucket per key/IP with standard rate headers.
 *   - Asynchronous Usage Auditing: Updates `last_used_at` and `last_used_ip` off hot path.
 *
 * Returns the complete schema-v1 document with `ETag` and `X-Config-Revision`
 * (revision/publish metadata travels in headers, never inside schema-v1 `meta`).
 */
import { createHash } from "node:crypto";
import { LRUCache } from "lru-cache";
import { pool } from "../../../config/database.js";
import { env } from "../../../config/env.js";
import { extractApiKeyPrefix } from "../shared/utils.js";
import { redisLookupCache } from "../../../db/redis/lookup-cache.js";
import { RedisKeys } from "../../../db/redis/keys.js";
import { SdkConfigError } from "./errors.js";
import { DeliveryFlight } from "./delivery-flight.js";
import { extractClientIp, isIpAllowed } from "./ip-filter.js";
import { checkBrowserOriginGuard, constantTimeHexEqual, isEndpointAllowed, sha256Hex, verifyRequestSignature, } from "./security.js";
/** Extract the raw API key from `Authorization: Bearer` or `X-API-Key`. */
function extractApiKey(request) {
    const headerKey = request.headers["x-api-key"];
    if (typeof headerKey === "string" && headerKey.trim().length > 0)
        return headerKey.trim();
    const auth = request.headers.authorization;
    if (typeof auth === "string" && auth.toLowerCase().startsWith("bearer ")) {
        return auth.slice(7).trim() || null;
    }
    return null;
}
function deliveryHintsHash(hints) {
    return sha256Hex(JSON.stringify({
        environment: hints.environment ?? null,
        environmentId: hints.environmentId ?? null,
        projectId: hints.projectId ?? null,
        schemaVersion: hints.schemaVersion ?? null,
    }));
}
/**
 * Resolve and verify the API key, returning its authoritative mapping.
 * Uses Redis lookup cache on the fast-path with fallback to PostgreSQL.
 * Integrates negative caching to mitigate brute-force and DB starvation.
 */
async function resolveApiKeyMapping(rawKey) {
    // 0. Negative Cache Fast-Fail (<0.05ms)
    if (typeof redisLookupCache.isKeyNegativeCached === "function") {
        const isNeg = await redisLookupCache.isKeyNegativeCached(rawKey);
        if (isNeg)
            return null;
    }
    // 1. Fast-Path: Check Redis Lookup Cache
    const cached = await redisLookupCache.getApiKeyMapping(rawKey);
    if (cached) {
        return cached;
    }
    // 2. Slow-Path: Query PostgreSQL Database
    const publicKey = extractApiKeyPrefix(rawKey);
    if (!publicKey) {
        if (typeof redisLookupCache.setNegativeKey === "function") {
            void redisLookupCache.setNegativeKey(rawKey, 60);
        }
        return null;
    }
    const result = await pool.query(`SELECT p.org_id AS organization_id, 
            k.id AS key_id,
            k.project_id, 
            k.environment_id, 
            k.secret_hash,
            k.allowed_ips,
            k.allowed_endpoints
       FROM project_api_keys k
       JOIN projects p ON p.id = k.project_id AND p.deleted_at IS NULL
      WHERE k.public_key = $1 
        AND k.status = 'active' 
        AND (k.is_active IS NULL OR k.is_active = TRUE)
        AND (k.expires_at IS NULL OR k.expires_at > NOW())
        AND (p.status IS NULL OR p.status = 'active')
        AND k.deleted_at IS NULL
      LIMIT 1`, [publicKey]);
    const row = result.rows[0];
    if (!row) {
        if (typeof redisLookupCache.setNegativeKey === "function") {
            void redisLookupCache.setNegativeKey(rawKey, 60);
        }
        return null;
    }
    if (!constantTimeHexEqual(sha256Hex(rawKey), row.secret_hash)) {
        if (typeof redisLookupCache.setNegativeKey === "function") {
            void redisLookupCache.setNegativeKey(rawKey, 60);
        }
        return null;
    }
    const mapping = {
        organizationId: row.organization_id,
        projectId: row.project_id,
        defaultEnvironmentId: row.environment_id,
        allowedEnvironmentIds: [row.environment_id],
        ...(row.key_id ? { keyId: row.key_id } : {}),
        ...(row.allowed_ips && row.allowed_ips.length > 0 ? { allowedIps: row.allowed_ips } : {}),
        ...(row.allowed_endpoints && row.allowed_endpoints.length > 0 ? { allowedEndpoints: row.allowed_endpoints } : {}),
    };
    // Populate Redis cache asynchronously
    void redisLookupCache.setApiKeyMapping(rawKey, mapping, row.secret_hash);
    return mapping;
}
function toHints(body, mapping) {
    const hints = {};
    if (typeof body.schemaVersion === "number")
        hints.schemaVersion = body.schemaVersion;
    if (typeof body.metadata?.projectId === "string")
        hints.projectId = body.metadata.projectId;
    else if (typeof body.projectId === "string")
        hints.projectId = body.projectId;
    if (typeof body.metadata?.environment === "string")
        hints.environment = body.metadata.environment;
    else if (typeof body.environment === "string")
        hints.environment = body.environment;
    // Fallback for older SDKs that do not send metadata. New SDKs select by
    // metadata.projectId + metadata.environment; only org id is taken from the key.
    hints.environmentId = mapping.defaultEnvironmentId;
    return hints;
}
const lastUsedDebounce = new LRUCache({ max: 10_000, ttl: 60_000 });
/**
 * Register both SDK bootstrap names against one handler. This guarantees
 * `/v1/init` and `/v1/sdk-config` use the same API-key mapping, service call,
 * response document, and cache/revision headers.
 */
export function registerSdkDeliveryRoutes(fastify, service) {
    const maxActive = env?.SDK_INIT_MAX_ACTIVE_FLIGHTS ?? 256;
    const defaultTimeoutMs = env?.SDK_INIT_DEADLINE_MS ?? 20000;
    const keyLookups = new DeliveryFlight(maxActive, 1024, defaultTimeoutMs);
    const deliveries = new DeliveryFlight(maxActive, 1024, defaultTimeoutMs);
    const sendDelivery = (request, reply, result) => {
        const revisionNo = "version" in result ? result.version : result.revisionNo;
        const environmentName = "environment" in result ? result.environment : result.config.sdk.environment;
        const releaseName = "release" in result ? result.release : result.config.sdk.release;
        const configHash = "configHash" in result ? result.configHash : result.config.meta.configHash;
        reply.header("ETag", result.etag);
        reply.header("X-Config-Revision", String(revisionNo));
        reply.header("Cache-Control", "private, no-cache");
        const ifNoneMatch = request.headers["if-none-match"];
        if (ifNoneMatch) {
            const normalizedClient = ifNoneMatch.trim().replace(/^W\//, "");
            const normalizedServer = result.etag.trim().replace(/^W\//, "");
            if (normalizedClient === normalizedServer || ifNoneMatch === "*") {
                return reply.code(304).send();
            }
        }
        const config = result.config;
        const ingestEndpoint = config.transport.routes.events?.url
            || config.transport.routes.requests?.url
            || (config.transport.routes.errors?.url ? `${config.transport.routes.errors.url.replace(/\/errors$/, '')}/events` : "");
        return reply.code(200).send({
            success: true,
            projectId: config.sdk.projectId,
            organizationId: result.organizationId,
            environmentId: result.environmentId,
            environment: environmentName,
            release: releaseName,
            configRevision: revisionNo,
            configHash: configHash,
            plan: "enterprise",
            config,
            ingestion: {
                endpoint: ingestEndpoint,
                batchSize: config.transport.routes.events.batchSize,
                flushInterval: config.transport.routes.events.flushIntervalMs,
                maxQueueSize: config.limits.maxQueueSize,
            },
            requestId: request.id || "req_sdk_init",
        });
    };
    const deliver = async (request, reply) => {
        // 1. Origin Shield: Block unauthorized browser cross-origin requests
        if (!checkBrowserOriginGuard(request)) {
            return reply.code(403).send({
                error: { code: "forbidden", message: "Cross-origin browser requests forbidden for control-plane SDK routes" }
            });
        }
        const clientIp = extractClientIp(request);
        // 2. IP Jail Check: Stop abusive callers before touching any resources
        if (typeof redisLookupCache.isIpJailed === "function") {
            const isJailed = await redisLookupCache.isIpJailed(clientIp);
            if (isJailed) {
                return reply.code(429).header("Retry-After", "900").send({
                    error: { code: "ip_banned", message: "Too many failed authentication attempts. Client IP temporarily jailed." }
                });
            }
        }
        const rawKey = extractApiKey(request);
        if (!rawKey) {
            if (typeof redisLookupCache.recordAuthFailure === "function") {
                void redisLookupCache.recordAuthFailure(clientIp);
            }
            return reply.code(401).send({ error: { code: "unauthorized", message: "Missing API key" } });
        }
        const totalDeadlineMs = Math.max(env?.SDK_INIT_DEADLINE_MS ?? 30000, 30000);
        const deadlineAt = Date.now() + totalDeadlineMs;
        let mapping = null;
        try {
            mapping = await keyLookups.run(sha256Hex(rawKey), () => resolveApiKeyMapping(rawKey), deadlineAt);
        }
        catch (flightError) {
            request.log.warn({ err: flightError }, "Key lookup flight failed or timed out, trying direct resolution");
            try {
                mapping = await resolveApiKeyMapping(rawKey);
            }
            catch (directErr) {
                request.log.error({ err: directErr }, "sdk-config direct key resolution failed");
                return reply.header("Retry-After", "1").code(503).send({ error: { code: "unavailable", message: "Configuration temporarily unavailable" } });
            }
        }
        if (!mapping) {
            if (typeof redisLookupCache.recordAuthFailure === "function") {
                void redisLookupCache.recordAuthFailure(clientIp);
            }
            // Uniform 401 body/timing to resist enumeration.
            return reply.code(401).send({ error: { code: "unauthorized", message: "Invalid API key" } });
        }
        // 3. Zero-Trust Network IP / CIDR Allowlist Enforcement
        if (!isIpAllowed(clientIp, mapping.allowedIps)) {
            request.log.warn({ clientIp, keyId: mapping.keyId }, "SDK init request blocked: IP not in allowed_ips");
            if (typeof redisLookupCache.recordAuthFailure === "function") {
                void redisLookupCache.recordAuthFailure(clientIp);
            }
            return reply.code(403).send({
                error: { code: "forbidden", message: "Client IP not allowed by network security policy" }
            });
        }
        // 4. Allowed Endpoints Scoping
        if (!isEndpointAllowed(request.url, mapping.allowedEndpoints)) {
            request.log.warn({ url: request.url, keyId: mapping.keyId }, "SDK delivery blocked: endpoint not allowed");
            return reply.code(403).send({
                error: { code: "forbidden", message: "API key is not authorized for this endpoint" }
            });
        }
        // 5. Cryptographic HMAC Signature & Replay Defense (Timestamp Freshness)
        const sigResult = verifyRequestSignature(rawKey, request.headers["x-pulse-timestamp"], request.headers["x-pulse-signature"], request.method, request.url, request.body);
        if (!sigResult.valid) {
            if (typeof redisLookupCache.recordAuthFailure === "function") {
                void redisLookupCache.recordAuthFailure(clientIp);
            }
            return reply.code(401).send({
                error: { code: sigResult.code || "unauthorized", message: sigResult.message || "Invalid signature" }
            });
        }
        // 6. Delivery Rate Limiting (Token Bucket per Key/IP)
        if (typeof redisLookupCache.checkDeliveryRateLimit === "function") {
            const rateLimitId = mapping.keyId || sha256Hex(rawKey);
            const rl = await redisLookupCache.checkDeliveryRateLimit(rateLimitId, 120, 60);
            if (!rl.allowed) {
                return reply.code(429).header("Retry-After", String(rl.resetSeconds)).send({
                    error: { code: "rate_limit_exceeded", message: "SDK delivery rate limit exceeded. Retry after backoff." }
                });
            }
            reply.header("X-RateLimit-Limit", "120");
            reply.header("X-RateLimit-Remaining", String(rl.remaining));
            reply.header("X-RateLimit-Reset", String(rl.resetSeconds));
        }
        // 7. Non-blocking Asynchronous Usage Tracking (Debounced to prevent DB pool exhaustion under burst loads)
        if (mapping.keyId && !lastUsedDebounce.has(mapping.keyId)) {
            lastUsedDebounce.set(mapping.keyId, Date.now());
            pool.query("UPDATE project_api_keys SET last_used_at = NOW(), last_used_ip = $1::inet WHERE id = $2", [clientIp, mapping.keyId]).catch((err) => {
                request.log.debug({ err }, "Non-critical: failed to update api key last_used_at");
            });
        }
        const body = (request.body ?? {});
        const hints = toHints(body, mapping);
        const envHint = hints.environment ?? null;
        // 8. Remote Configuration Fast-Path: Permanent Redis Remote Config Hot-Cache (NO TTL, Project-Scoped)
        // Architecture: PostgreSQL (Source of Truth) -> Redis (Indefinite Hot Cache) -> /init
        if (typeof redisLookupCache.getRemoteConfig === "function") {
            const cachedRemote = await redisLookupCache.getRemoteConfig(mapping.projectId, envHint);
            if (cachedRemote) {
                // Mandatory Tenant Isolation Check (Section 8):
                // Verify that the cached document strictly matches the authenticated API key's project.
                if (cachedRemote.projectId === mapping.projectId) {
                    return sendDelivery(request, reply, cachedRemote);
                }
                request.log.warn({ keyProject: mapping.projectId, cachedProject: cachedRemote.projectId }, "Cache tenant mismatch detected, evicting");
                if (typeof redisLookupCache.invalidateRemoteConfig === "function") {
                    void redisLookupCache.invalidateRemoteConfig(mapping.projectId, envHint);
                }
            }
        }
        const hintsHash = deliveryHintsHash(hints);
        if (typeof redisLookupCache.getInitDelivery === "function") {
            const legacyCached = await redisLookupCache.getInitDelivery(rawKey, hintsHash);
            if (legacyCached) {
                return sendDelivery(request, reply, legacyCached);
            }
        }
        // 9. Cache Miss Recovery: Rebuild from PostgreSQL & Persist to Redis WITHOUT TTL (Section 1, 4, 5, 10)
        try {
            const remainingMs = deadlineAt - Date.now();
            const stageDeadlineAt = Date.now() + Math.max(10000, remainingMs);
            const flightKey = `${mapping.projectId}:${envHint ?? "default"}`;
            const buildDoc = async () => {
                // Coalesced re-check to eliminate duplicate DB queries on burst cold miss
                if (typeof redisLookupCache.getRemoteConfig === "function") {
                    const coalesced = await redisLookupCache.getRemoteConfig(mapping.projectId, envHint);
                    if (coalesced && coalesced.projectId === mapping.projectId)
                        return coalesced;
                }
                if (typeof redisLookupCache.getInitDelivery === "function") {
                    const legacyCached = await redisLookupCache.getInitDelivery(rawKey, hintsHash);
                    if (legacyCached) {
                        return {
                            version: legacyCached.revisionNo,
                            projectId: legacyCached.projectId,
                            organizationId: legacyCached.organizationId,
                            environmentId: legacyCached.environmentId,
                            environment: legacyCached.config.sdk.environment,
                            release: legacyCached.config.sdk.release,
                            etag: legacyCached.etag,
                            configHash: legacyCached.config.meta.configHash,
                            config: legacyCached.config,
                        };
                    }
                }
                const built = await service.buildDelivery(mapping, hints);
                const doc = {
                    version: built.revisionNo,
                    projectId: built.projectId,
                    organizationId: built.organizationId,
                    environmentId: built.environmentId,
                    environment: built.config.sdk.environment,
                    release: built.config.sdk.release,
                    etag: built.etag,
                    configHash: built.config.meta.configHash,
                    config: built.config,
                };
                // Cache in Redis WITHOUT an application-level TTL (indefinite hot cache)
                if (typeof redisLookupCache.setRemoteConfig === "function") {
                    void redisLookupCache.setRemoteConfig(doc);
                }
                if (typeof redisLookupCache.setInitDelivery === "function") {
                    void redisLookupCache.setInitDelivery(rawKey, hintsHash, built, 60);
                }
                return doc;
            };
            let result;
            try {
                result = await deliveries.run(flightKey, buildDoc, stageDeadlineAt);
            }
            catch (flightErr) {
                request.log.warn({ err: flightErr }, "Deliveries flight failed, falling back to direct build");
                result = await buildDoc();
            }
            return sendDelivery(request, reply, result);
        }
        catch (error) {
            // Last-resort fallback: if PostgreSQL experienced a cold-start timeout or transient error,
            // return any previously cached configuration for this project rather than failing with 503.
            if (typeof redisLookupCache.getRemoteConfig === "function") {
                try {
                    const lkg = await redisLookupCache.getRemoteConfig(mapping.projectId, envHint);
                    if (lkg && lkg.projectId === mapping.projectId) {
                        request.log.warn({ projectId: mapping.projectId }, "Returning cached remote config after transient build error");
                        return sendDelivery(request, reply, lkg);
                    }
                }
                catch {
                    // ignore fallback error
                }
            }
            if (error instanceof SdkConfigError) {
                if (error.statusCode === 503)
                    reply.header("Retry-After", "1");
                return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message, details: error.details } });
            }
            request.log.error({ err: error }, "sdk-config delivery failed");
            return reply.code(503).send({ error: { code: "unavailable", message: "Configuration temporarily unavailable" } });
        }
    };
    fastify.post("/v1/init", { bodyLimit: 4096 }, deliver);
    fastify.post("/init", { bodyLimit: 4096 }, deliver);
    fastify.post("/v1/sdk-config", { bodyLimit: 4096 }, deliver);
}
//# sourceMappingURL=sdk-config.delivery.routes.js.map