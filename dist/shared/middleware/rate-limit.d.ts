/**
 * Per-route Redis-backed rate limiter.
 *
 * Returns a Fastify preHandler that increments a Redis counter keyed by
 * (caller-derived key) + (route URL). Counter resets after `window` seconds.
 *
 * Design notes:
 *   - Falls back to allowing the request when Redis is unavailable so a
 *     transient cache outage does not become a hard outage. This is logged
 *     so operators can detect degraded protection.
 *   - The keyGenerator defaults to request.ip; callers can pass a custom
 *     generator for per-user or per-email limits.
 *   - Always sends a Retry-After header on 429 responses.
 */
import type { FastifyRequest, preHandlerHookHandler } from 'fastify';
export interface RouteRateLimitOptions {
    /** Maximum number of requests allowed per window. */
    max: number;
    /** Window size in seconds. */
    window: number;
    /** Optional key derivation; defaults to req.ip. */
    keyGenerator?: (req: FastifyRequest) => string;
    /** Optional fixed key segment (e.g. "login") to scope counters. */
    scope?: string;
}
export declare function rateLimit(options: RouteRateLimitOptions): preHandlerHookHandler;
/**
 * Build a key generator for `rateLimit` that combines the request IP with a
 * caller-supplied stable identity key (e.g. an email hash). This pairs the
 * counters so an attacker cannot exhaust limits with a single IP across many
 * email targets, while a legitimate user from one IP stays within their own
 * counter.
 */
export declare function ipPlusIdentityKey(identity: (req: FastifyRequest) => string): (req: FastifyRequest) => string;
//# sourceMappingURL=rate-limit.d.ts.map