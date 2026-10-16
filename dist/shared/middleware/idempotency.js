import { createHash } from "node:crypto";
import { redis } from "../../config/redis.js";
import { CacheFlags } from "../../config/cache-flags.js";
const DEFAULT_COMPLETED_TTL_SECONDS = 60 * 60 * 24; // 24 hours
const DEFAULT_PROCESSING_TTL_SECONDS = 30;
const MAX_CACHED_PAYLOAD_BYTES = 64 * 1024; // 64 KB
export const IDEMPOTENCY_KEY_SYMBOL = Symbol("idempotencyKey");
export const IDEMPOTENCY_REDIS_KEY_SYMBOL = Symbol("idempotencyRedisKey");
export const IDEMPOTENCY_TTL_SYMBOL = Symbol("idempotencyTtl");
export const IDEMPOTENCY_PAYLOAD_HASH_SYMBOL = Symbol("idempotencyPayloadHash");
export const IDEMPOTENCY_OPT_OUT_SYMBOL = Symbol("idempotencyOptOut");
function canonicalJson(obj) {
    if (obj === null || typeof obj !== "object") {
        return JSON.stringify(obj) ?? "";
    }
    if (Array.isArray(obj)) {
        return "[" + obj.map(canonicalJson).join(",") + "]";
    }
    const keys = Object.keys(obj).sort();
    const entries = keys.map((k) => JSON.stringify(k) + ":" + canonicalJson(obj[k]));
    return "{" + entries.join(",") + "}";
}
function computePayloadHash(method, route, body) {
    const normalized = `${method.toUpperCase()}:${route}:${canonicalJson(body)}`;
    return createHash("sha256").update(normalized).digest("hex");
}
export function idempotency(options = {}) {
    const completedTtl = options.completedTtl ?? DEFAULT_COMPLETED_TTL_SECONDS;
    const processingTtl = options.processingTtl ?? DEFAULT_PROCESSING_TTL_SECONDS;
    return async function idempotencyHandler(request, reply) {
        const key = extractKey(request);
        if (!key)
            return;
        const method = request.method.toUpperCase();
        if (!isIdempotentMethod(method))
            return;
        const route = request.routeOptions?.url || request.url || "unknown";
        const isolationEnabled = CacheFlags.idempotencyTenantIsolation;
        let redisKey;
        let payloadHash;
        if (isolationEnabled) {
            const user = request.user;
            if (!user || !user.id) {
                return reply.status(400).send({
                    success: false,
                    error: {
                        code: "INVALID_IDEMPOTENCY_CONTEXT",
                        message: "Idempotency-Key requires an authenticated organization and user context",
                    },
                });
            }
            const orgId = user.currentOrgId ?? `user_${user.id}`;
            const userId = user.id;
            payloadHash = computePayloadHash(method, route, request.body);
            redisKey = `idempotency:${orgId}:${userId}:${method}:${route}:${key}`;
        }
        else {
            redisKey = buildLegacyRedisKey(request, key);
        }
        let stored = null;
        try {
            stored = await redis.get(redisKey);
        }
        catch (err) {
            request.log.warn({ err, redisKey }, "Idempotency Redis check failed; allowing request");
            return;
        }
        if (stored) {
            try {
                const parsed = JSON.parse(stored);
                // Verify payload integrity if fingerprint is present
                if (payloadHash && parsed.payloadHash && parsed.payloadHash !== payloadHash) {
                    return reply.status(422).send({
                        success: false,
                        error: {
                            code: "IDEMPOTENCY_PAYLOAD_MISMATCH",
                            message: "Idempotency key was previously used with a different request payload",
                        },
                    });
                }
                if ("status" in parsed && parsed.status === -1) {
                    return reply.status(409).send({
                        success: false,
                        error: {
                            code: "IDEMPOTENCY_KEY_IN_USE",
                            message: "Idempotency key is already being processed. Retry after the request completes.",
                        },
                    });
                }
                const cached = parsed;
                for (const [header, value] of Object.entries(cached.headers)) {
                    reply.header(header, value);
                }
                return reply.status(cached.status).send(cached.payload);
            }
            catch (err) {
                try {
                    await redis.del(redisKey);
                }
                catch {
                    // ignore
                }
            }
        }
        try {
            const markerPayload = payloadHash
                ? JSON.stringify({ status: -1, payloadHash })
                : JSON.stringify({ status: -1 });
            await redis.set(redisKey, markerPayload, "EX", processingTtl);
        }
        catch (err) {
            request.log.warn({ err, redisKey }, "Failed to set idempotency processing marker; allowing request");
            return;
        }
        // Attach metadata so the route's onSend hook can cache the response.
        request[IDEMPOTENCY_KEY_SYMBOL] = key;
        request[IDEMPOTENCY_REDIS_KEY_SYMBOL] = redisKey;
        request[IDEMPOTENCY_TTL_SYMBOL] = completedTtl;
        if (payloadHash) {
            request[IDEMPOTENCY_PAYLOAD_HASH_SYMBOL] = payloadHash;
        }
        request[IDEMPOTENCY_OPT_OUT_SYMBOL] =
            options.disableResponseCaching === true;
    };
}
/**
 * Capture and cache a successful response for an idempotent request.
 * Register this as an `onSend` hook on any plugin/route that applies the
 * idempotency preHandler.
 */
export async function cacheIdempotencyResponse(request, reply, payload) {
    const redisKey = request[IDEMPOTENCY_REDIS_KEY_SYMBOL];
    const completedTtl = request[IDEMPOTENCY_TTL_SYMBOL];
    if (!redisKey || completedTtl === undefined)
        return;
    const isOptedOut = request[IDEMPOTENCY_OPT_OUT_SYMBOL];
    if (isOptedOut) {
        try {
            await redis.del(redisKey);
        }
        catch {
            // ignore
        }
        return;
    }
    if (reply.statusCode < 200 || reply.statusCode >= 300) {
        try {
            await redis.del(redisKey);
        }
        catch {
            // ignore
        }
        return;
    }
    try {
        const payloadString = typeof payload === "string" ? payload : JSON.stringify(payload);
        // Hard cap for cached idempotency responses (64 KB) to prevent memory and cache bloat
        if (payloadString.length > MAX_CACHED_PAYLOAD_BYTES) {
            return;
        }
        const headers = {};
        for (const [header, value] of Object.entries(reply.getHeaders())) {
            if (value !== undefined && value !== null) {
                headers[header] = String(value);
            }
        }
        const payloadHash = request[IDEMPOTENCY_PAYLOAD_HASH_SYMBOL];
        await redis.set(redisKey, JSON.stringify({ status: reply.statusCode, payload: payloadString, headers, payloadHash }), "EX", completedTtl);
    }
    catch (err) {
        request.log.warn({ err, redisKey }, "Failed to cache idempotency response");
    }
}
function extractKey(request) {
    const raw = request.headers["idempotency-key"];
    if (typeof raw === "string" && raw.trim().length > 0) {
        return raw.trim();
    }
    return null;
}
function isIdempotentMethod(method) {
    return ["POST", "PATCH", "PUT", "DELETE"].includes(method);
}
function buildLegacyRedisKey(request, key) {
    const route = request.routeOptions?.url || request.url || "unknown";
    const method = request.method.toUpperCase();
    return `idempotency:${method}:${route}:${key}`;
}
//# sourceMappingURL=idempotency.js.map