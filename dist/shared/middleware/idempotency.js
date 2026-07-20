import { redis } from "../../config/redis.js";
const DEFAULT_COMPLETED_TTL_SECONDS = 60 * 60 * 24; // 24 hours
const DEFAULT_PROCESSING_TTL_SECONDS = 30;
export const IDEMPOTENCY_KEY_SYMBOL = Symbol("idempotencyKey");
export const IDEMPOTENCY_REDIS_KEY_SYMBOL = Symbol("idempotencyRedisKey");
export const IDEMPOTENCY_TTL_SYMBOL = Symbol("idempotencyTtl");
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
        const redisKey = buildRedisKey(request, key);
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
            await redis.set(redisKey, JSON.stringify({ status: -1 }), "EX", processingTtl);
        }
        catch (err) {
            request.log.warn({ err, redisKey }, "Failed to set idempotency processing marker; allowing request");
            return;
        }
        // Attach metadata so the route's onSend hook can cache the response.
        request[IDEMPOTENCY_KEY_SYMBOL] = key;
        request[IDEMPOTENCY_REDIS_KEY_SYMBOL] = redisKey;
        request[IDEMPOTENCY_TTL_SYMBOL] = completedTtl;
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
    if (reply.statusCode < 200 || reply.statusCode >= 300)
        return;
    try {
        const payloadString = typeof payload === "string" ? payload : JSON.stringify(payload);
        const headers = {};
        for (const [header, value] of Object.entries(reply.getHeaders())) {
            if (value !== undefined && value !== null) {
                headers[header] = String(value);
            }
        }
        await redis.set(redisKey, JSON.stringify({ status: reply.statusCode, payload: payloadString, headers }), "EX", completedTtl);
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
function buildRedisKey(request, key) {
    const route = request.routeOptions?.url || request.url || "unknown";
    const method = request.method.toUpperCase();
    return `idempotency:${method}:${route}:${key}`;
}
//# sourceMappingURL=idempotency.js.map