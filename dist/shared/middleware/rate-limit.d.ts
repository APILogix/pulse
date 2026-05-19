/**
 * Per-route rate limiting factory.
 *
 * Creates route-specific rate limit configurations using @fastify/rate-limit
 * that override the global rate limit with tighter or looser limits.
 */
import type { FastifyRequest, preHandlerHookHandler } from 'fastify';
export interface RouteRateLimitOptions {
    max: number;
    window: string | number;
    keyGenerator?: (req: FastifyRequest) => string;
    ban?: number;
}
export declare function rateLimit(options: RouteRateLimitOptions): preHandlerHookHandler;
export declare function createRateLimitConfig(options: RouteRateLimitOptions): {
    max: number;
    timeWindow: string | number;
    keyGenerator: (req: FastifyRequest) => string;
    skipOnError: boolean;
};
//# sourceMappingURL=rate-limit.d.ts.map