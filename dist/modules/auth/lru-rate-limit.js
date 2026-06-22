import { LRUCache } from 'lru-cache';
import { AuthErrorCodes } from './types.js';
const counterCache = new LRUCache({
    max: 100_000,
    ttlAutopurge: true,
});
export function lruRateLimit(options) {
    const { max, windowMs, scope, keyGenerator } = options;
    return async function lruRateLimitHandler(request, reply) {
        const baseKey = keyGenerator
            ? keyGenerator(request)
            : request.ip || 'unknown';
        const routeKey = request.routeOptions?.url ||
            request.url ||
            'unknown';
        const redisKey = `auth_rl:${scope}:${baseKey}:${routeKey}`;
        const previous = counterCache.get(redisKey) ?? 0;
        const current = previous + 1;
        counterCache.set(redisKey, current, { ttl: windowMs });
        if (current > max) {
            const retryAfterSeconds = Math.ceil(windowMs / 1000);
            return reply
                .header('Retry-After', String(retryAfterSeconds))
                .status(429)
                .send({
                error: {
                    code: AuthErrorCodes.RATE_LIMITED,
                    message: `Rate limit exceeded. Try again in ${retryAfterSeconds}s`,
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