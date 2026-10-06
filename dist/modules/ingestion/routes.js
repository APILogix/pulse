import { createRequire } from "node:module";
import { authenticate, requireAdmin } from "../../shared/middleware/auth.js";
import { requireProjectMembershipFromBody, requireProjectMembershipFromQuery, } from "../../shared/middleware/tenant.js";
import { extractApiKeyFromRequest } from "./utils/api-key.js";
import { env } from "../../config/env.js";
import { acceptEmptyJsonBodyAsObject } from "../../shared/http/empty-json-body.js";
import { IngestionController } from "./controller.js";
import { IngestionService } from "./service.js";
import { ErrorByIdSchema, ErrorListSchema, IngestSchema, ReplaySchema, } from "./types.js";
import { TYPED_INGEST_ROUTES } from "./route-table.js";
const require = createRequire(import.meta.url);
const AjvCtor = require("ajv");
const addFormats = require("ajv-formats");
function requireFastifyDecorator(fastify, name) {
    // Route registration should fail fast if boot plugins did not wire the
    // required dependency. This prevents handlers from accepting traffic with a
    // partially constructed ingestion pipeline.
    const decoratedFastify = fastify;
    const dependency = decoratedFastify[name];
    if (!fastify.hasDecorator(name) || dependency == null) {
        throw new Error(`Missing required Fastify decorator: ${name}`);
    }
    return dependency;
}
function assertControllerMethods(controller) {
    // Keep route registration honest when controller methods are renamed or
    // removed. A boot-time error is easier to diagnose than a runtime 500 on a
    // production ingestion endpoint.
    const methods = [
        "init",
        "ingest",
        "ingestTyped",
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
        "getUsage",
    ];
    for (const method of methods) {
        if (typeof controller[method] !== "function") {
            throw new Error(`Missing required ingestion controller method: ${method}`);
        }
    }
}
function ingestBodySummary(body) {
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
        return { bodyType: typeof body };
    }
    const ingest = body;
    const events = Array.isArray(ingest.events) ? ingest.events : [];
    const types = new Map();
    const eventShapeSamples = [];
    let approximateEventBytes = 0;
    for (const [index, event] of events.entries()) {
        if (event && typeof event === "object") {
            const record = event;
            const type = String(record.type ?? "unknown");
            types.set(type, (types.get(type) ?? 0) + 1);
            if (eventShapeSamples.length < 3) {
                eventShapeSamples.push({
                    index,
                    type,
                    keys: Object.keys(record).slice(0, 30),
                });
            }
        }
        approximateEventBytes += Buffer.byteLength(JSON.stringify(event ?? null), "utf8");
    }
    return {
        environment: ingest.metadata?.environment,
        sdkVersion: ingest.metadata?.sdkVersion,
        batchId: ingest.metadata?.batchId,
        declaredCompression: ingest.metadata?.compression,
        eventCount: events.length,
        eventTypes: Object.fromEntries(types),
        eventShapeSamples,
        approximateEventBytes,
    };
}
export async function ingestionRoutes(fastify) {
    acceptEmptyJsonBodyAsObject(fastify);
    const ajv = new AjvCtor({
        coerceTypes: true,
        useDefaults: true,
        removeAdditional: false,
        allErrors: true,
    });
    addFormats(ajv);
    fastify.setValidatorCompiler(({ schema }) => ajv.compile(schema));
    const postgresWriter = requireFastifyDecorator(fastify, "postgresWriter");
    const service = new IngestionService(postgresWriter.pool, postgresWriter, {
        maxBatchSize: env.INGESTION_MAX_BATCH_SIZE,
        defaultRateLimitPerSecond: env.INGESTION_DEFAULT_RATE_PER_SECOND,
        defaultRateLimitPerMinute: env.INGESTION_DEFAULT_RATE_PER_MINUTE,
    }, fastify.sdkConfigDelivery);
    const controller = new IngestionController(service);
    assertControllerMethods(controller);
    fastify.addHook("onClose", async () => service.shutdown());
    // fastify.addHook("onResponse", async (request, reply) => {
    //   request.log.info(
    //     {
    //       method: request.method,
    //       url: request.url,
    //       statusCode: reply.statusCode,
    //       contentEncoding: request.headers["content-encoding"],
    //     },
    //     "Ingestion request completed",
    //   );
    // });
    fastify.addHook("onError", async (request, _reply, error) => {
        request.log.warn({
            err: error,
            method: request.method,
            url: request.url,
            contentType: request.headers["content-type"],
            contentEncoding: request.headers["content-encoding"],
            contentLength: request.headers["content-length"],
        }, "Ingestion request failed");
    });
    // Per-signal typed write endpoints — the PRIMARY SDK transport. Registration
    // is DATA-DRIVEN from TYPED_INGEST_ROUTES so there is exactly one dedicated
    // POST route per SDK event family and no hand-written handler per type. Each
    // handler enforces its declared event type inside the service; a foreign
    // event fails the batch with INVALID_EVENT_TYPE. These path suffixes are kept
    // in lockstep with the advertised SDK config paths (ROUTE_INGEST_PATHS), so
    // the SDK never receives a URL that the backend does not serve. POST here
    // coexists safely with the GET read routes (e.g. GET /v1/errors) by method.
    for (const route of TYPED_INGEST_ROUTES) {
        fastify.post(route.path, { schema: IngestSchema }, controller.ingestTyped(route.type));
    }
    // Legacy compatibility batch endpoint. NOT the primary SDK transport: it
    // accepts MIXED event types in one request and is retained only so older SDK
    // builds keep working. New SDKs POST to the typed routes above.
    fastify.post("/v1/ingest", { schema: IngestSchema }, controller.ingest.bind(controller));
    // Legacy typed sub-paths (compatibility only). Superseded by the top-level
    // typed routes above; retained so previously-issued SDK configs keep
    // resolving. They share the same strict single-type enforcement.
    fastify.post("/v1/ingest/requests", { schema: IngestSchema }, controller.ingestRequests.bind(controller));
    fastify.post("/v1/ingest/errors", { schema: IngestSchema }, controller.ingestErrors.bind(controller));
    fastify.post("/v1/ingest/logs", { schema: IngestSchema }, controller.ingestLogs.bind(controller));
    fastify.post("/v1/ingest/metrics", { schema: IngestSchema }, controller.ingestMetrics.bind(controller));
    // ── Health & observability ──────────────────────────────────────────────
    fastify.get("/v1/health", controller.getHealth.bind(controller));
    fastify.get("/v1/ingest/health", { preHandler: [authenticate] }, controller.getIngestionHealth.bind(controller));
    // ── Tenant-scoped limits lookup ─────────────────────────────────────────
    // The API key is read from a request header, NOT from the query string.
    // Putting a secret in a URL leaks it into:
    //   * server access logs (Fastify, ALB, NGINX)
    //   * browser history & referer headers
    //   * upstream proxy/CDN logs
    // Header-based extraction (Authorization: Bearer <key> or X-API-Key) keeps
    // the secret out of every shared log surface.
    fastify.get("/v1/limits", async (request, reply) => {
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
        }
        catch (err) {
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
    });
    // ── Tenant-scoped usage lookup (new usage tables) ───────────────────────
    // Realtime per-project usage read from project_usage_realtime (durable
    // hourly buckets + un-flushed staging tail). Project membership enforced.
    fastify.get("/v1/usage", {
        preHandler: [authenticate, requireProjectMembershipFromQuery],
        schema: {
            querystring: {
                type: "object",
                required: ["projectId"],
                properties: {
                    projectId: { type: "string", format: "uuid" },
                    counterType: { type: "string", maxLength: 64 },
                },
                additionalProperties: false,
            },
        },
    }, controller.getUsage.bind(controller));
    // ── Error event lookups ─────────────────────────────────────────────────
    fastify.get("/v1/errors", {
        preHandler: [authenticate, requireProjectMembershipFromQuery],
        schema: ErrorListSchema,
    }, controller.listErrors.bind(controller));
    fastify.get("/v1/errors/:errorId", {
        preHandler: [authenticate, requireProjectMembershipFromQuery],
        schema: ErrorByIdSchema,
    }, controller.getErrorById.bind(controller));
    // ── DLQ admin endpoints ─────────────────────────────────────────────────
    // DLQ operations can replay arbitrary historical traffic onto the live
    // queue. They MUST require platform-admin: a regular user has no business
    // poking at the dead-letter table.
    fastify.get("/v1/dlq", {
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
    }, controller.getDLQ.bind(controller));
    fastify.post("/v1/dlq/reprocess/:jobId", {
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
    }, controller.reprocessDLQ.bind(controller));
    fastify.post("/v1/dlq/reprocess-all", {
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
    }, controller.reprocessAllDLQ.bind(controller));
    // ── Replay & debug ──────────────────────────────────────────────────────
    fastify.post("/v1/replay", {
        preHandler: [authenticate, requireAdmin, requireProjectMembershipFromBody],
        schema: ReplaySchema,
    }, controller.replay.bind(controller));
    fastify.get("/v1/debug/events/:id", {
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
    }, controller.debugEvent.bind(controller));
}
//# sourceMappingURL=routes.js.map