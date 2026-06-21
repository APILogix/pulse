/**
 * Ingestion route registration.
 *
 * Flow:
 * 1. Read infrastructure dependencies that were attached to the Fastify instance
 *    during application boot: shared Postgres pool and writer.
 * 2. Construct the service once for this route scope so every handler shares the
 *    same buffer, queue, cache, and persistence objects.
 * 3. Bind controller methods explicitly because Fastify calls handlers without
 *    the class instance context.
 * 4. Attach shutdown cleanup so process-local state (rate buckets) is released
 *    before the Fastify process closes.
 *
 * Hardening choices:
 *   - All ingestion endpoints carry strict JSON-Schema validation so malformed
 *     bodies are rejected at the framework boundary, before any handler logic.
 *   - The /v1/limits endpoint uses the Authorization header as the API-key
 *     channel (NOT a query string) to avoid leaking the secret into access
 *     logs, browser history, and CDN/proxy logs.
 *   - Routes that operate on dead-lettered jobs require platform-admin so a
 *     compromised user account cannot retrigger every failed job in the system.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { authenticate, requireAdmin } from "../../shared/middleware/auth.js";
import {
  requireProjectMembershipFromBody,
  requireProjectMembershipFromQuery,
} from "../../shared/middleware/tenant.js";
import { extractApiKeyFromRequest } from "./utils/api-key.js";
import { env } from "../../config/env.js";
import { IngestionController } from "./controller.js";
import { IngestionService } from "./service.js";
import {
  ErrorByIdSchema,
  ErrorListSchema,
  IngestSchema,
  InitSchema,
  ReplaySchema,
} from "./types.js";

type FastifyDecoratorName = "postgresWriter";

type ControllerMethodName =
  | "init"
  | "ingest"
  | "ingestRequests"
  | "ingestErrors"
  | "ingestLogs"
  | "ingestMetrics"
  | "getHealth"
  | "getIngestionHealth"
  | "listErrors"
  | "getErrorById"
  | "getDLQ"
  | "reprocessDLQ"
  | "reprocessAllDLQ"
  | "replay"
  | "debugEvent";

function requireFastifyDecorator<T>(
  fastify: FastifyInstance,
  name: FastifyDecoratorName,
): T {
  // Route registration should fail fast if boot plugins did not wire the
  // required dependency. This prevents handlers from accepting traffic with a
  // partially constructed ingestion pipeline.
  const decoratedFastify = fastify as FastifyInstance & Record<string, unknown>;
  const dependency = decoratedFastify[name];

  if (!fastify.hasDecorator(name) || dependency == null) {
    throw new Error(`Missing required Fastify decorator: ${name}`);
  }

  return dependency as T;
}

function assertControllerMethods(controller: IngestionController): void {
  // Keep route registration honest when controller methods are renamed or
  // removed. A boot-time error is easier to diagnose than a runtime 500 on a
  // production ingestion endpoint.
  const methods: ControllerMethodName[] = [
    "init",
    "ingest",
    "ingestRequests",
    "ingestErrors",
    "ingestLogs",
    "ingestMetrics",
    "getHealth",
    "getIngestionHealth",
    "listErrors",
    "getErrorById",
    "getDLQ",
    "reprocessDLQ",
    "reprocessAllDLQ",
    "replay",
    "debugEvent",
  ];

  for (const method of methods) {
    if (typeof controller[method] !== "function") {
      throw new Error(`Missing required ingestion controller method: ${method}`);
    }
  }
}

export async function ingestionRoutes(fastify: FastifyInstance): Promise<void> {
  const postgresWriter = requireFastifyDecorator<
    FastifyInstance["postgresWriter"]
  >(fastify, "postgresWriter");

  const service = new IngestionService(
    postgresWriter.pool,
    postgresWriter,
    {
      maxBatchSize: env.INGESTION_MAX_BATCH_SIZE,
      defaultRateLimitPerSecond: env.INGESTION_DEFAULT_RATE_PER_SECOND,
      defaultRateLimitPerMinute: env.INGESTION_DEFAULT_RATE_PER_MINUTE,
    },
  );

  const controller = new IngestionController(service);
  assertControllerMethods(controller);

  fastify.addHook("onClose", async () => service.shutdown());

  // ── SDK ingestion endpoints ─────────────────────────────────────────────
  // All ingestion endpoints validate their bodies via JSON Schema. The schema
  // is the only line of defense against malformed input reaching handlers,
  // so we deliberately apply it everywhere, including the previously-unguarded
  // /v1/init and /v1/ingest routes.
  fastify.post(
    "/v1/init",
    { schema: InitSchema },
    controller.init.bind(controller),
  );

  fastify.post(
    "/v1/ingest",
    { schema: IngestSchema },
    controller.ingest.bind(controller),
  );

  fastify.post(
    "/v1/ingest/requests",
    { schema: IngestSchema },
    controller.ingestRequests.bind(controller),
  );

  fastify.post(
    "/v1/ingest/errors",
    { schema: IngestSchema },
    controller.ingestErrors.bind(controller),
  );

  fastify.post(
    "/v1/ingest/logs",
    { schema: IngestSchema },
    controller.ingestLogs.bind(controller),
  );

  fastify.post(
    "/v1/ingest/metrics",
    { schema: IngestSchema },
    controller.ingestMetrics.bind(controller),
  );

  // ── Health & observability ──────────────────────────────────────────────
  fastify.get("/v1/health", controller.getHealth.bind(controller));

  fastify.get(
    "/v1/ingest/health",
    { preHandler: [authenticate] },
    controller.getIngestionHealth.bind(controller),
  );

  // ── Tenant-scoped limits lookup ─────────────────────────────────────────
  // The API key is read from a request header, NOT from the query string.
  // Putting a secret in a URL leaks it into:
  //   * server access logs (Fastify, ALB, NGINX)
  //   * browser history & referer headers
  //   * upstream proxy/CDN logs
  // Header-based extraction (Authorization: Bearer <key> or X-API-Key) keeps
  // the secret out of every shared log surface.
  fastify.get(
    "/v1/limits",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const apiKey = extractApiKeyFromRequest(request);
      if (!apiKey) {
        return reply.status(401).send({
          error: "Missing API key",
          code: "INVALID_API_KEY",
        });
      }
      try {
        const result = await service.getLimits(apiKey);
        return reply.send(result);
      } catch (err) {
        if (err instanceof Error && err.message === "INVALID_API_KEY") {
          return reply.status(401).send({
            error: "Invalid API key",
            code: "INVALID_API_KEY",
          });
        }
        request.log.error({ err }, "Failed to resolve ingestion limits");
        return reply.status(500).send({
          error: "Failed to resolve limits",
          code: "INTERNAL_ERROR",
        });
      }
    },
  );

  // ── Error event lookups ─────────────────────────────────────────────────
  fastify.get(
    "/v1/errors",
    {
      preHandler: [authenticate, requireProjectMembershipFromQuery],
      schema: ErrorListSchema,
    },
    controller.listErrors.bind(controller),
  );

  fastify.get(
    "/v1/errors/:errorId",
    {
      preHandler: [authenticate, requireProjectMembershipFromQuery],
      schema: ErrorByIdSchema,
    },
    controller.getErrorById.bind(controller),
  );

  // ── DLQ admin endpoints ─────────────────────────────────────────────────
  // DLQ operations can replay arbitrary historical traffic onto the live
  // queue. They MUST require platform-admin: a regular user has no business
  // poking at the dead-letter table.
  fastify.get(
    "/v1/dlq",
    {
      preHandler: [authenticate, requireAdmin],
      schema: {
        querystring: {
          type: "object",
          properties: {
            offset: { type: "integer", minimum: 0, default: 0 },
            limit: { type: "integer", minimum: 1, maximum: 1000, default: 100 },
          },
          additionalProperties: false,
        },
      },
    },
    controller.getDLQ.bind(controller),
  );

  fastify.post(
    "/v1/dlq/reprocess/:jobId",
    {
      preHandler: [authenticate, requireAdmin],
      schema: {
        params: {
          type: "object",
          required: ["jobId"],
          properties: {
            jobId: { type: "string", format: "uuid" },
          },
          additionalProperties: false,
        },
      },
    },
    controller.reprocessDLQ.bind(controller),
  );

  fastify.post(
    "/v1/dlq/reprocess-all",
    {
      preHandler: [authenticate, requireAdmin],
      schema: {
        body: {
          type: "object",
          properties: {
            batchSize: { type: "integer", minimum: 1, maximum: 1000, default: 100 },
          },
          additionalProperties: false,
        },
      },
    },
    controller.reprocessAllDLQ.bind(controller),
  );

  // ── Replay & debug ──────────────────────────────────────────────────────
  fastify.post(
    "/v1/replay",
    {
      preHandler: [authenticate, requireAdmin, requireProjectMembershipFromBody],
      schema: ReplaySchema,
    },
    controller.replay.bind(controller),
  );

  fastify.get(
    "/v1/debug/events/:id",
    {
      preHandler: [authenticate, requireProjectMembershipFromQuery],
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: {
            id: { type: "string", format: "uuid" },
          },
          additionalProperties: false,
        },
        querystring: {
          type: "object",
          required: ["projectId"],
          properties: {
            projectId: { type: "string", format: "uuid" },
          },
          additionalProperties: false,
        },
      },
    },
    controller.debugEvent.bind(controller),
  );
}
