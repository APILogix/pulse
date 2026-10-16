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
import { LRUCache } from 'lru-cache';
import { redis } from '../../../../config/redis.js';
import { CacheFlags } from '../../../../config/cache-flags.js';
import { AuthErrorCodes } from '../../domain/types.js';

export interface LruRateLimitOptions {
  /** Maximum requests allowed within the window. */
  max: number;
  /** Window size in milliseconds. */
  windowMs: number;
  /** Namespace segment to avoid key collisions across limiters. */
  scope: string;
  keyGenerator?: (req: FastifyRequest) => string;
}

interface RateLimitBucket {
  count: number;
  resetAt: number;
}

const counterCache = new LRUCache<string, RateLimitBucket>({
  max: 100_000,
  ttlAutopurge: true,
});

const ATOMIC_RATE_LIMIT_LUA = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('PTTL', KEYS[1])
return {current, ttl}
`;

function isCriticalAuthRoute(scope: string): boolean {
  const s = scope.toLowerCase();
  return s.includes('login') || s.includes('mfa') || s.includes('password') || s.includes('stepup');
}

export function lruRateLimit(
  options: LruRateLimitOptions,
): preHandlerHookHandler {
  return async function lruRateLimitHandler(request, reply) {
    const identity = options.keyGenerator
      ? options.keyGenerator(request)
      : request.ip || 'unknown';

    if (CacheFlags.authRedisState) {
      const redisKey = `auth:ratelimit:${options.scope}:${identity}`;
      try {
        const [currentCount, ttlMs] = (await redis.eval(
          ATOMIC_RATE_LIMIT_LUA,
          1,
          redisKey,
          String(options.windowMs),
        )) as [number, number];

        const remaining = Math.max(0, options.max - currentCount);
        const retryAfterSeconds = Math.max(1, Math.ceil(ttlMs / 1000));
        const resetAtEpoch = Math.ceil((Date.now() + Math.max(0, ttlMs)) / 1000);

        reply.header('RateLimit-Limit', String(options.max));
        reply.header('RateLimit-Remaining', String(remaining));
        reply.header('RateLimit-Reset', String(resetAtEpoch));

        if (currentCount > options.max) {
          reply.header('Retry-After', String(retryAfterSeconds));
          request.log.warn(
            {
              rateLimitScope: options.scope,
              rateLimitKey: identity,
              retryAfterSeconds,
            },
            'Auth route rate limit exceeded',
          );
          return reply.status(429).send({
            error: {
              code: AuthErrorCodes.RATE_LIMITED,
              message: 'Too many requests. Please retry later.',
              details: { retry_after_seconds: retryAfterSeconds },
            },
          });
        }
        return;
      } catch (err) {
        if (isCriticalAuthRoute(options.scope)) {
          request.log.error(
            { err, scope: options.scope },
            'Redis rate limit check failed on critical auth route; failing closed for security',
          );
          return reply.status(503).send({
            error: {
              code: 'SERVICE_UNAVAILABLE',
              message: 'Authentication service temporarily unavailable. Please retry later.',
            },
          });
        }

        request.log.warn(
          { err, scope: options.scope },
          'Redis rate limit check failed on non-critical route; failing open',
        );
        return;
      }
    }

    // Fallback: in-process LRU limiter when flag is disabled
    const now = Date.now();
    const key = `${options.scope}:${identity}`;
    const current = counterCache.get(key);
    const bucket =
      current && current.resetAt > now
        ? current
        : { count: 0, resetAt: now + options.windowMs };

    bucket.count += 1;
    counterCache.set(key, bucket, { ttl: Math.max(1, bucket.resetAt - now) });

    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((bucket.resetAt - now) / 1000),
    );
    const remaining = Math.max(0, options.max - bucket.count);

    reply.header('RateLimit-Limit', String(options.max));
    reply.header('RateLimit-Remaining', String(remaining));
    reply.header('RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));

    if (bucket.count > options.max) {
      reply.header('Retry-After', String(retryAfterSeconds));
      request.log.warn(
        {
          rateLimitScope: options.scope,
          rateLimitKey: identity,
          retryAfterSeconds,
        },
        'Auth route rate limit exceeded',
      );
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
export function ipPlusIdentityKey(
  identity: (req: FastifyRequest) => string,
): (req: FastifyRequest) => string {
  return (req: FastifyRequest) => {
    const ip = req.ip || 'unknown';
    const id = identity(req);
    return `${ip}:${id}`;
  };
}
