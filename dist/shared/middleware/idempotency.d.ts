/**
 * Idempotency key middleware.
 *
 * Uses Redis to guard mutating requests keyed by a client-supplied
 * `Idempotency-Key` header. The first request with a given key proceeds; any
 * concurrent or replayed request with the same key within the TTL receives a
 * 409 or the cached response. This prevents duplicate side effects (e.g.,
 * double project creation) from retries and network timeouts.
 *
 * Security & Isolation (Tier 0.1):
 *   - Redis key is strictly scoped by server-verified org_id and user_id.
 *   - Unauthenticated requests presenting an Idempotency-Key are rejected with 400.
 *   - Payload fingerprinting (SHA-256) rejects mismatched bodies with 422.
 *   - Explicit opt-out flag `disableResponseCaching` for sensitive routes (tokens/secrets).
 *   - Payload cache size capped at 64 KB without synchronous compression.
 */
import type { FastifyRequest, preHandlerHookHandler, FastifyReply } from "fastify";
export declare const IDEMPOTENCY_KEY_SYMBOL: unique symbol;
export declare const IDEMPOTENCY_REDIS_KEY_SYMBOL: unique symbol;
export declare const IDEMPOTENCY_TTL_SYMBOL: unique symbol;
export declare const IDEMPOTENCY_PAYLOAD_HASH_SYMBOL: unique symbol;
export declare const IDEMPOTENCY_OPT_OUT_SYMBOL: unique symbol;
export interface IdempotencyOptions {
    /** TTL for completed cached responses (seconds). */
    completedTtl?: number;
    /** TTL for in-flight processing markers (seconds). */
    processingTtl?: number;
    /** When true, locks concurrent execution but never caches response payloads in Redis (for sensitive routes). */
    disableResponseCaching?: boolean;
}
export declare function idempotency(options?: IdempotencyOptions): preHandlerHookHandler;
/**
 * Capture and cache a successful response for an idempotent request.
 * Register this as an `onSend` hook on any plugin/route that applies the
 * idempotency preHandler.
 */
export declare function cacheIdempotencyResponse(request: FastifyRequest, reply: FastifyReply, payload: unknown): Promise<void>;
//# sourceMappingURL=idempotency.d.ts.map