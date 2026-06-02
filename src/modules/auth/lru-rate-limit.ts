/**
 * In-process LRU rate limiter for the auth module.
 *
 * Bootstrap-friendly: no Redis dependency. Counters live in memory and are
 * scoped per Node process (same tradeoff as MFA challenge caches in cache.ts).
 *
 * For multi-instance deployments, run a single API instance or accept that
 * limits are per-process until a shared store is introduced later.
 */
import type { FastifyRequest, preHandlerHookHandler } from 'fastify';
import { LRUCache } from 'lru-cache';

import { AuthErrorCodes } from './types.js';

export interface LruRateLimitOptions {
  /** Maximum requests allowed within the window. */
  max: number;
  /** Window size in milliseconds. */
  windowMs: number;
  /** Namespace segment to avoid key collisions across limiters. */
  scope: string;
  keyGenerator?: (req: FastifyRequest) => string;
}

const counterCache = new LRUCache<string, number>({
  max: 100_000,
  ttlAutopurge: true,
});

export function lruRateLimit(
  options: LruRateLimitOptions,
): preHandlerHookHandler {
  const { max, windowMs, scope, keyGenerator } = options;

  return async function lruRateLimitHandler(request, reply) {
    const baseKey = keyGenerator
      ? keyGenerator(request)
      : request.ip || 'unknown';
    const routeKey =
      request.routeOptions?.url ||
      (request as { url?: string }).url ||
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
export function ipPlusIdentityKey(
  identity: (req: FastifyRequest) => string,
): (req: FastifyRequest) => string {
  return (req) => `${identity(req)}:${req.ip || 'unknown'}`;
}
