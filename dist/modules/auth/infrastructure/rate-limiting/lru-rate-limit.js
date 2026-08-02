import { LRUCache } from 'lru-cache';
import { AuthErrorCodes } from '../../domain/types.js';
const counterCache = new LRUCache({
    max: 100_000,
    ttlAutopurge: true,
});
export function lruRateLimit(options) {
    return async function lruRateLimitHandler(request, reply) {
        const now = Date.now();
        const identity = options.keyGenerator
            ? options.keyGenerator(request)
            : request.ip || 'unknown';
        const key = `${options.scope}:${identity}`;
        const current = counterCache.get(key);
        const bucket = current && current.resetAt > now
            ? current
            : { count: 0, resetAt: now + options.windowMs };
        bucket.count += 1;
        counterCache.set(key, bucket, { ttl: Math.max(1, bucket.resetAt - now) });
        const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
        const remaining = Math.max(0, options.max - bucket.count);
        reply.header('RateLimit-Limit', String(options.max));
        reply.header('RateLimit-Remaining', String(remaining));
        reply.header('RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));
        if (bucket.count > options.max) {
            reply.header('Retry-After', String(retryAfterSeconds));
            request.log.warn({
                rateLimitScope: options.scope,
                rateLimitKey: identity,
                retryAfterSeconds,
            }, 'Auth route rate limit exceeded');
            return reply.status(429).send({
                error: {
                    code: AuthErrorCodes.RATE_LIMITED,
                    message: 'Too many requests. Please retry later.',
                    details: { retry_after_seconds: retryAfterSeconds },
                },
            });
        }
    };
}
/**
 * Combine IP with a stable identity segment (e.g. email hash) for credential
 * endpoints.
 */
export function ipPlusIdentityKey(identity) {
    return (req) => `${identity(req)}:${req.ip || 'unknown'}`;
}
//# sourceMappingURL=lru-rate-limit.js.map