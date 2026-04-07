import { redis } from '../../config/redis.js';
export function rateLimit(options) {
    return async (request, reply) => {
        const key = `${options.keyPrefix || 'rl'}:${request.user?.id || request.ip}:${request.routeOptions.url}`;
        const windowMs = options.window * 1000;
        const current = await redis.incr(key);
        if (current === 1) {
            await redis.pexpire(key, windowMs);
        }
        const ttl = await redis.pttl(key);
        reply.header('X-RateLimit-Limit', options.max);
        reply.header('X-RateLimit-Remaining', Math.max(0, options.max - current));
        reply.header('X-RateLimit-Reset', new Date(Date.now() + ttl).toISOString());
        if (current > options.max) {
            return reply.status(429).send({
                error: {
                    code: 'RATE_LIMITED',
                    message: 'Too many requests, please try again later',
                    retry_after: Math.ceil(ttl / 1000),
                },
            });
        }
    };
}
//# sourceMappingURL=rate-limit.js.map