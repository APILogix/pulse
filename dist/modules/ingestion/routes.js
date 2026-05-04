import { authenticate } from "../../shared/middleware/auth.js";
import { IngestionController } from "./controller.js";
import { IngestionService } from "./service.js";
import { ErrorByIdSchema, ErrorListSchema, IngestSchema, InitSchema, ReplaySchema, } from "./types.js";
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
        "ingestRequests",
        "ingestErrors",
        "ingestLogs",
        "ingestMetrics",
        "getHealth",
        "getIngestionHealth",
        "getLimits",
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
export async function ingestionRoutes(fastify) {
    // Dependencies are owned by application bootstrapping; this module only
    // composes them into the ingestion use case.
    const ingestionQueue = requireFastifyDecorator(fastify, "ingestionQueue");
    const redisCache = requireFastifyDecorator(fastify, "redisCache");
    const postgresWriter = requireFastifyDecorator(fastify, "postgresWriter");
    console.log({
        ingestionQueue: fastify.ingestionQueue,
        redisCache: fastify.redisCache,
        postgresWriter: fastify.postgresWriter,
    });
    const service = new IngestionService(ingestionQueue, redisCache, postgresWriter, {
        maxBatchSize: 1000,
        defaultRateLimitPerSecond: 1000,
        defaultRateLimitPerMinute: 10000,
    });
    const controller = new IngestionController(service);
    assertControllerMethods(controller);
    fastify.addHook("onClose", async () => service.shutdown());
    fastify.post("/v1/init", 
    // { schema: InitSchema },
    controller.init.bind(controller));
    fastify.post("/v1/ingest", 
    // { schema: IngestSchema },
    controller.ingest.bind(controller));
    fastify.post("/v1/ingest/requests", { schema: IngestSchema }, controller.ingestRequests.bind(controller));
    fastify.post("/v1/ingest/errors", { schema: IngestSchema }, controller.ingestErrors.bind(controller));
    fastify.post("/v1/ingest/logs", { schema: IngestSchema }, controller.ingestLogs.bind(controller));
    fastify.post("/v1/ingest/metrics", { schema: IngestSchema }, controller.ingestMetrics.bind(controller));
    fastify.get("/v1/health", controller.getHealth.bind(controller));
    fastify.get("/v1/ingest/health", { preHandler: [authenticate] }, controller.getIngestionHealth.bind(controller));
    fastify.get("/v1/limits", {
        preHandler: [authenticate],
        schema: {
            querystring: {
                type: "object",
                required: ["apiKey"],
                properties: {
                    apiKey: { type: "string" },
                },
            },
        },
    }, controller.getLimits.bind(controller));
    fastify.get("/v1/errors", {
        preHandler: [authenticate],
        schema: ErrorListSchema,
    }, controller.listErrors.bind(controller));
    fastify.get("/v1/errors/:errorId", {
        preHandler: [authenticate],
        schema: ErrorByIdSchema,
    }, controller.getErrorById.bind(controller));
    fastify.get("/v1/dlq", {
        preHandler: [authenticate],
        schema: {
            querystring: {
                type: "object",
                properties: {
                    start: { type: "integer", default: 0 },
                    end: { type: "integer", default: 100 },
                },
            },
        },
    }, controller.getDLQ.bind(controller));
    fastify.post("/v1/dlq/reprocess/:jobId", {
        preHandler: [authenticate],
        schema: {
            params: {
                type: "object",
                required: ["jobId"],
                properties: {
                    jobId: { type: "string" },
                },
            },
        },
    }, controller.reprocessDLQ.bind(controller));
    fastify.post("/v1/dlq/reprocess-all", { preHandler: [authenticate] }, controller.reprocessAllDLQ.bind(controller));
    fastify.post("/v1/replay", {
        preHandler: [authenticate],
        schema: ReplaySchema,
    }, controller.replay.bind(controller));
    fastify.get("/v1/debug/events/:id", {
        preHandler: [authenticate],
        schema: {
            params: {
                type: "object",
                required: ["id"],
                properties: {
                    id: { type: "string", format: "uuid" },
                },
            },
            querystring: {
                type: "object",
                required: ["projectId"],
                properties: {
                    projectId: { type: "string", format: "uuid" },
                },
            },
        },
    }, controller.debugEvent.bind(controller));
}
//# sourceMappingURL=routes.js.map