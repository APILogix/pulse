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

export function rateLimit(options: RouteRateLimitOptions): preHandlerHookHandler {
  return async function rateLimitHandler(request, reply) {
    const key = options.keyGenerator
      ? options.keyGenerator(request)
      : request.ip || 'unknown';

    const rateLimitKey = `route_rl:${key}:${request.routerPath}`;

    const redis = (request.server as any).redis;
    if (redis) {
      try {
        const current = await redis.incr(rateLimitKey);
        if (current === 1) {
          const seconds = typeof options.window === 'string'
            ? parseInt(options.window, 10)
            : Math.floor(options.window / 1000);
          await redis.expire(rateLimitKey, seconds);
        }
        if (current > options.max) {
          return reply.status(429).send({
            statusCode: 429,
            error: 'Too Many Requests',
            message: `Rate limit exceeded. Max ${options.max} requests per ${options.window}`,
          });
        }
      } catch (err) {
        request.log.warn({ err }, 'Rate limit check failed — allowing request');
      }
    }
  };
}

export function createRateLimitConfig(options: RouteRateLimitOptions) {
  return {
    max: options.max,
    timeWindow: options.window,
    keyGenerator: options.keyGenerator || ((req: FastifyRequest) => req.ip || 'unknown'),
    skipOnError: false,
  };
}
