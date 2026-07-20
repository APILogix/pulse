/**
 * Idempotency key middleware.
 *
 * Uses Redis to guard mutating requests keyed by a client-supplied
 * `Idempotency-Key` header. The first request with a given key proceeds; any
 * concurrent or replayed request with the same key within the TTL receives a
 * 409 or the cached response. This prevents duplicate side effects (e.g.,
 * double project creation) from retries and network timeouts.
 *
 * Design notes:
 *   - Only caches successful 2xx responses so transient 5xx errors are not
 *     frozen for replays.
 *   - TTL defaults to 24 hours for completed responses and 30 seconds for
 *     in-flight markers.
 *   - Only idempotent HTTP methods are guarded (POST, PATCH, PUT, DELETE).
 *   - Falls back to allowing the request if Redis is unavailable.
 *
 * Implementation: this middleware is intentionally paired with the route's
 * `onSend` hook for response capture. The preHandler validates the key and sets
 * a request symbol; the onSend hook writes the final 2xx payload to Redis.
 */
import type { FastifyRequest, preHandlerHookHandler, FastifyReply } from "fastify";
import { redis } from "../../config/redis.js";

const DEFAULT_COMPLETED_TTL_SECONDS = 60 * 60 * 24; // 24 hours
const DEFAULT_PROCESSING_TTL_SECONDS = 30;

export const IDEMPOTENCY_KEY_SYMBOL = Symbol("idempotencyKey");
export const IDEMPOTENCY_REDIS_KEY_SYMBOL = Symbol("idempotencyRedisKey");
export const IDEMPOTENCY_TTL_SYMBOL = Symbol("idempotencyTtl");

export interface IdempotencyOptions {
  /** TTL for completed cached responses (seconds). */
  completedTtl?: number;
  /** TTL for in-flight processing markers (seconds). */
  processingTtl?: number;
}

interface CachedResponse {
  status: number;
  payload: string;
  headers: Record<string, string>;
}

export function idempotency(options: IdempotencyOptions = {}): preHandlerHookHandler {
  const completedTtl = options.completedTtl ?? DEFAULT_COMPLETED_TTL_SECONDS;
  const processingTtl = options.processingTtl ?? DEFAULT_PROCESSING_TTL_SECONDS;

  return async function idempotencyHandler(request: FastifyRequest, reply: FastifyReply) {
    const key = extractKey(request);
    if (!key) return;

    const method = request.method.toUpperCase();
    if (!isIdempotentMethod(method)) return;

    const redisKey = buildRedisKey(request, key);
    let stored: string | null = null;

    try {
      stored = await redis.get(redisKey);
    } catch (err) {
      request.log.warn({ err, redisKey }, "Idempotency Redis check failed; allowing request");
      return;
    }

    if (stored) {
      try {
        const parsed = JSON.parse(stored) as CachedResponse | { status: -1 };
        if ("status" in parsed && parsed.status === -1) {
          return reply.status(409).send({
            success: false,
            error: {
              code: "IDEMPOTENCY_KEY_IN_USE",
              message: "Idempotency key is already being processed. Retry after the request completes.",
            },
          });
        }
        const cached = parsed as CachedResponse;
        for (const [header, value] of Object.entries(cached.headers)) {
          reply.header(header, value);
        }
        return reply.status(cached.status).send(cached.payload);
      } catch (err) {
        try {
          await redis.del(redisKey);
        } catch {
          // ignore
        }
      }
    }

    try {
      await redis.set(redisKey, JSON.stringify({ status: -1 }), "EX", processingTtl);
    } catch (err) {
      request.log.warn({ err, redisKey }, "Failed to set idempotency processing marker; allowing request");
      return;
    }

    // Attach metadata so the route's onSend hook can cache the response.
    (request as unknown as Record<symbol, unknown>)[IDEMPOTENCY_KEY_SYMBOL] = key;
    (request as unknown as Record<symbol, unknown>)[IDEMPOTENCY_REDIS_KEY_SYMBOL] = redisKey;
    (request as unknown as Record<symbol, unknown>)[IDEMPOTENCY_TTL_SYMBOL] = completedTtl;
  };
}

/**
 * Capture and cache a successful response for an idempotent request.
 * Register this as an `onSend` hook on any plugin/route that applies the
 * idempotency preHandler.
 */
export async function cacheIdempotencyResponse(
  request: FastifyRequest,
  reply: FastifyReply,
  payload: unknown,
): Promise<void> {
  const redisKey = (request as unknown as Record<symbol, unknown>)[IDEMPOTENCY_REDIS_KEY_SYMBOL] as string | undefined;
  const completedTtl = (request as unknown as Record<symbol, unknown>)[IDEMPOTENCY_TTL_SYMBOL] as number | undefined;
  if (!redisKey || completedTtl === undefined) return;

  if (reply.statusCode < 200 || reply.statusCode >= 300) return;

  try {
    const payloadString = typeof payload === "string" ? payload : JSON.stringify(payload);
    const headers: Record<string, string> = {};
    for (const [header, value] of Object.entries(reply.getHeaders())) {
      if (value !== undefined && value !== null) {
        headers[header] = String(value);
      }
    }
    await redis.set(
      redisKey,
      JSON.stringify({ status: reply.statusCode, payload: payloadString, headers }),
      "EX",
      completedTtl,
    );
  } catch (err) {
    request.log.warn({ err, redisKey }, "Failed to cache idempotency response");
  }
}

function extractKey(request: FastifyRequest): string | null {
  const raw = request.headers["idempotency-key"];
  if (typeof raw === "string" && raw.trim().length > 0) {
    return raw.trim();
  }
  return null;
}

function isIdempotentMethod(method: string): boolean {
  return ["POST", "PATCH", "PUT", "DELETE"].includes(method);
}

function buildRedisKey(request: FastifyRequest, key: string): string {
  const route = request.routeOptions?.url || request.url || "unknown";
  const method = request.method.toUpperCase();
  return `idempotency:${method}:${route}:${key}`;
}
