/**
 * Idempotency key middleware.
 *
 * Uses Redis to guard mutating requests keyed by a client-supplied
 * `Idempotency-Key` header. The first request with a given key proceeds; any
 * concurrent or replayed request with the same key within the TTL receives a
 * 409 or the cached response. This prevents duplicate side effects (e.g.,
 * double project creation) from retries and network timeouts.
 *
 * Security & Isolation (Tier 0.1):
 *   - Redis key is strictly scoped by server-verified org_id and user_id.
 *   - Unauthenticated requests presenting an Idempotency-Key are rejected with 400.
 *   - Payload fingerprinting (SHA-256) rejects mismatched bodies with 422.
 *   - Explicit opt-out flag `disableResponseCaching` for sensitive routes (tokens/secrets).
 *   - Payload cache size capped at 64 KB without synchronous compression.
 */
import type { FastifyRequest, preHandlerHookHandler, FastifyReply } from "fastify";
import { createHash } from "node:crypto";
import { redis } from "../../config/redis.js";
import { CacheFlags } from "../../config/cache-flags.js";

const DEFAULT_COMPLETED_TTL_SECONDS = 60 * 60 * 24; // 24 hours
const DEFAULT_PROCESSING_TTL_SECONDS = 30;
const MAX_CACHED_PAYLOAD_BYTES = 64 * 1024; // 64 KB

export const IDEMPOTENCY_KEY_SYMBOL = Symbol("idempotencyKey");
export const IDEMPOTENCY_REDIS_KEY_SYMBOL = Symbol("idempotencyRedisKey");
export const IDEMPOTENCY_TTL_SYMBOL = Symbol("idempotencyTtl");
export const IDEMPOTENCY_PAYLOAD_HASH_SYMBOL = Symbol("idempotencyPayloadHash");
export const IDEMPOTENCY_OPT_OUT_SYMBOL = Symbol("idempotencyOptOut");

export interface IdempotencyOptions {
  /** TTL for completed cached responses (seconds). */
  completedTtl?: number;
  /** TTL for in-flight processing markers (seconds). */
  processingTtl?: number;
  /** When true, locks concurrent execution but never caches response payloads in Redis (for sensitive routes). */
  disableResponseCaching?: boolean;
}

interface CachedResponse {
  status: number;
  payload: string;
  headers: Record<string, string>;
  payloadHash?: string;
}

function canonicalJson(obj: unknown): string {
  if (obj === null || typeof obj !== "object") {
    return JSON.stringify(obj) ?? "";
  }
  if (Array.isArray(obj)) {
    return "[" + obj.map(canonicalJson).join(",") + "]";
  }
  const keys = Object.keys(obj as Record<string, unknown>).sort();
  const entries = keys.map((k) => JSON.stringify(k) + ":" + canonicalJson((obj as Record<string, unknown>)[k]));
  return "{" + entries.join(",") + "}";
}

function computePayloadHash(method: string, route: string, body: unknown): string {
  const normalized = `${method.toUpperCase()}:${route}:${canonicalJson(body)}`;
  return createHash("sha256").update(normalized).digest("hex");
}

export function idempotency(options: IdempotencyOptions = {}): preHandlerHookHandler {
  const completedTtl = options.completedTtl ?? DEFAULT_COMPLETED_TTL_SECONDS;
  const processingTtl = options.processingTtl ?? DEFAULT_PROCESSING_TTL_SECONDS;

  return async function idempotencyHandler(request: FastifyRequest, reply: FastifyReply) {
    const key = extractKey(request);
    if (!key) return;

    const method = request.method.toUpperCase();
    if (!isIdempotentMethod(method)) return;

    const route = request.routeOptions?.url || request.url || "unknown";
    const isolationEnabled = CacheFlags.idempotencyTenantIsolation;

    let redisKey: string;
    let payloadHash: string | undefined;

    if (isolationEnabled) {
      const user = (request as unknown as { user?: { id?: string; currentOrgId?: string } }).user;
      if (!user || !user.id) {
        return reply.status(400).send({
          success: false,
          error: {
            code: "INVALID_IDEMPOTENCY_CONTEXT",
            message: "Idempotency-Key requires an authenticated organization and user context",
          },
        });
      }

      const orgId = user.currentOrgId ?? `user_${user.id}`;
      const userId = user.id;
      payloadHash = computePayloadHash(method, route, request.body);
      redisKey = `idempotency:${orgId}:${userId}:${method}:${route}:${key}`;
    } else {
      redisKey = buildLegacyRedisKey(request, key);
    }

    let stored: string | null = null;

    try {
      stored = await redis.get(redisKey);
    } catch (err) {
      request.log.warn({ err, redisKey }, "Idempotency Redis check failed; allowing request");
      return;
    }

    if (stored) {
      try {
        const parsed = JSON.parse(stored) as CachedResponse | { status: -1; payloadHash?: string };

        // Verify payload integrity if fingerprint is present
        if (payloadHash && parsed.payloadHash && parsed.payloadHash !== payloadHash) {
          return reply.status(422).send({
            success: false,
            error: {
              code: "IDEMPOTENCY_PAYLOAD_MISMATCH",
              message: "Idempotency key was previously used with a different request payload",
            },
          });
        }

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
      const markerPayload = payloadHash
        ? JSON.stringify({ status: -1, payloadHash })
        : JSON.stringify({ status: -1 });
      await redis.set(redisKey, markerPayload, "EX", processingTtl);
    } catch (err) {
      request.log.warn({ err, redisKey }, "Failed to set idempotency processing marker; allowing request");
      return;
    }

    // Attach metadata so the route's onSend hook can cache the response.
    (request as unknown as Record<symbol, unknown>)[IDEMPOTENCY_KEY_SYMBOL] = key;
    (request as unknown as Record<symbol, unknown>)[IDEMPOTENCY_REDIS_KEY_SYMBOL] = redisKey;
    (request as unknown as Record<symbol, unknown>)[IDEMPOTENCY_TTL_SYMBOL] = completedTtl;
    if (payloadHash) {
      (request as unknown as Record<symbol, unknown>)[IDEMPOTENCY_PAYLOAD_HASH_SYMBOL] = payloadHash;
    }
    (request as unknown as Record<symbol, unknown>)[IDEMPOTENCY_OPT_OUT_SYMBOL] =
      options.disableResponseCaching === true;
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

  const isOptedOut = (request as unknown as Record<symbol, unknown>)[IDEMPOTENCY_OPT_OUT_SYMBOL] as boolean | undefined;
  if (isOptedOut) {
    try {
      await redis.del(redisKey);
    } catch {
      // ignore
    }
    return;
  }

  if (reply.statusCode < 200 || reply.statusCode >= 300) {
    try {
      await redis.del(redisKey);
    } catch {
      // ignore
    }
    return;
  }

  try {
    const payloadString = typeof payload === "string" ? payload : JSON.stringify(payload);
    // Hard cap for cached idempotency responses (64 KB) to prevent memory and cache bloat
    if (payloadString.length > MAX_CACHED_PAYLOAD_BYTES) {
      return;
    }
    const headers: Record<string, string> = {};
    for (const [header, value] of Object.entries(reply.getHeaders())) {
      if (value !== undefined && value !== null) {
        headers[header] = String(value);
      }
    }
    const payloadHash = (request as unknown as Record<symbol, unknown>)[IDEMPOTENCY_PAYLOAD_HASH_SYMBOL] as string | undefined;

    await redis.set(
      redisKey,
      JSON.stringify({ status: reply.statusCode, payload: payloadString, headers, payloadHash }),
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

function buildLegacyRedisKey(request: FastifyRequest, key: string): string {
  const route = request.routeOptions?.url || request.url || "unknown";
  const method = request.method.toUpperCase();
  return `idempotency:${method}:${route}:${key}`;
}
