/**
 * Idempotency key middleware.
 *
 * Uses Redis to guard mutating requests keyed by a client-supplied
 * `Idempotency-Key` header. The first request with a given key proceeds; any
 * concurrent or replayed request with the same key within the TTL receives a
 * 409 or the cached response. This prevents duplicate side effects (e.g.,
 * double project creation) from retries and network timeouts.
 *
 * Design notes:
 *   - Only caches successful 2xx responses so transient 5xx errors are not
 *     frozen for replays.
 *   - TTL defaults to 24 hours for completed responses and 30 seconds for
 *     in-flight markers.
 *   - Only idempotent HTTP methods are guarded (POST, PATCH, PUT, DELETE).
 *   - Falls back to allowing the request if Redis is unavailable.
 *
 * Implementation: this middleware is intentionally paired with the route's
 * `onSend` hook for response capture. The preHandler validates the key and sets
 * a request symbol; the onSend hook writes the final 2xx payload to Redis.
 */
import type { FastifyRequest, preHandlerHookHandler, FastifyReply } from "fastify";
export declare const IDEMPOTENCY_KEY_SYMBOL: unique symbol;
export declare const IDEMPOTENCY_REDIS_KEY_SYMBOL: unique symbol;
export declare const IDEMPOTENCY_TTL_SYMBOL: unique symbol;
export interface IdempotencyOptions {
    /** TTL for completed cached responses (seconds). */
    completedTtl?: number;
    /** TTL for in-flight processing markers (seconds). */
    processingTtl?: number;
}
export declare function idempotency(options?: IdempotencyOptions): preHandlerHookHandler;
/**
 * Capture and cache a successful response for an idempotent request.
 * Register this as an `onSend` hook on any plugin/route that applies the
 * idempotency preHandler.
 */
export declare function cacheIdempotencyResponse(request: FastifyRequest, reply: FastifyReply, payload: unknown): Promise<void>;
//# sourceMappingURL=idempotency.d.ts.map