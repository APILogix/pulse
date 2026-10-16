/**
 * Shared Redis rate limiter with in-process LRU fallback for the auth module.
 *
 * Tier 0.2 Implementation:
 *   - Counters live in Redis under `auth:ratelimit:${scope}:${identity}`.
 *   - Atomic evaluation via Lua script (INCR + PEXPIRE).
 *   - Failure degradation:
 *       * Login / MFA / Password routes FAIL CLOSED (503 Service Unavailable).
 *       * Non-critical routes FAIL OPEN to preserve availability.
 */
import type { FastifyRequest, preHandlerHookHandler } from 'fastify';
export interface LruRateLimitOptions {
    /** Maximum requests allowed within the window. */
    max: number;
    /** Window size in milliseconds. */
    windowMs: number;
    /** Namespace segment to avoid key collisions across limiters. */
    scope: string;
    keyGenerator?: (req: FastifyRequest) => string;
}
export declare function lruRateLimit(options: LruRateLimitOptions): preHandlerHookHandler;
/**
 * Combine IP with a stable identity segment (e.g. email hash) for credential
 * endpoints.
 */
export declare function ipPlusIdentityKey(identity: (req: FastifyRequest) => string): (req: FastifyRequest) => string;
//# sourceMappingURL=lru-rate-limit.d.ts.map