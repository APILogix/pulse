import { redis } from '../../config/redis.js';
import { AuthErrorCodes } from '../../modules/auth/domain/types.js';
export function rateLimit(options) {
    const { max, window, keyGenerator, scope } = options;
    return async function rateLimitHandler(request, reply) {
        const baseKey = keyGenerator
            ? keyGenerator(request)
            : request.ip || 'unknown';
        // Fastify v5 exposes the matched route via routeOptions.url; routerPath
        // is removed in v5. Falling back to request.url keeps the limiter scoped
        // even when no matched-route metadata is available.
        const routeKey = request.routeOptions?.url || request.url || 'unknown';
        const scopeKey = scope ? `:${scope}` : '';
        const redisKey = `route_rl${scopeKey}:${baseKey}:${routeKey}`;
        let current;
        try {
            current = await redis.incr(redisKey);
            if (current === 1) {
                await redis.expire(redisKey, window);
            }
        }
        catch (err) {
            request.log.warn({ err, redisKey }, 'Rate limit check failed; allowing request');
            return;
        }
        if (current > max) {
            const ttl = await safeTtl(redisKey);
            return reply
                .header('Retry-After', String(ttl > 0 ? ttl : window))
                .status(429)
                .send({
                error: {
                    code: AuthErrorCodes.RATE_LIMITED,
                    message: `Rate limit exceeded. Try again in ${ttl > 0 ? ttl : window}s`,
                },
            });
        }
    };
}
async function safeTtl(key) {
    try {
        return await redis.ttl(key);
    }
    catch {
        return -1;
    }
}
/**
 * Build a key generator for `rateLimit` that combines the request IP with a
 * caller-supplied stable identity key (e.g. an email hash). This pairs the
 * counters so an attacker cannot exhaust limits with a single IP across many
 * email targets, while a legitimate user from one IP stays within their own
 * counter.
 */
export function ipPlusIdentityKey(identity) {
    return (req) => `${identity(req)}:${req.ip || 'unknown'}`;
}
//# sourceMappingURL=rate-limit.js.map