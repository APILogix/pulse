/**
 * Ingestion controller.
 *
 * Flow:
 * 1. Convert HTTP input into the service contract with minimal transformation.
 * 2. Delegate validation, project resolution, rate limiting, idempotency, and
 *    queueing to IngestionService.
 * 3. Normalize service error codes into stable HTTP responses for SDK clients.
 *
 * The controller intentionally stays thin: it owns protocol concerns such as
 * status codes and response shape, while the service owns business rules.
 *
 * Hardening choices (vs the original):
 *   - Bodies are typed/validated at the route layer (JSON Schema). The
 *     controller still re-shapes input but no longer relies on `as any` casts
 *     for runtime safety.
 *   - Comments accurately describe the Postgres-backed queue (no stale BullMQ
 *     references).
 *   - All error paths log the reqId so a 500 in production is traceable.
 */
import type { FastifyRequest, FastifyReply } from 'fastify';
import { IngestionService } from './service.js';
export declare class IngestionController {
    private readonly service;
    constructor(service: IngestionService);
    /**
     * SDK bootstrap endpoint.
     * Flow: read apiKey -> resolve project through service -> return SDK runtime
     * config. Invalid or inactive projects are translated by handleError().
     */
    init(request: FastifyRequest, reply: FastifyReply): Promise<never>;
    /**
     * Generic batch endpoint for mixed event types.
     * Flow: pass raw batch to service -> service enriches and queues accepted
     * events -> return 202 because persistence happens asynchronously.
     */
    ingest(request: FastifyRequest, reply: FastifyReply): Promise<never>;
    /**
     * Typed request-event endpoint. The service rejects any event whose type does
     * not match this route, which protects downstream request_events inserts.
     */
    ingestRequests(request: FastifyRequest, reply: FastifyReply): Promise<never>;
    /** Typed error-event endpoint for SDK exceptions and crash payloads. */
    ingestErrors(request: FastifyRequest, reply: FastifyReply): Promise<never>;
    /** Typed log-event endpoint for application log records. */
    ingestLogs(request: FastifyRequest, reply: FastifyReply): Promise<never>;
    /** Typed metric-event endpoint for numeric telemetry samples. */
    ingestMetrics(request: FastifyRequest, reply: FastifyReply): Promise<never>;
    /**
     * Public health check. Returns 200 only when Postgres + queue are healthy;
     * any degraded dependency returns 503. This module does not depend on Redis,
     * so the response always reports `redis: false` honestly.
     */
    getHealth(request: FastifyRequest, reply: FastifyReply): Promise<never>;
    /** Authenticated operational health endpoint for queue and buffer metrics. */
    getIngestionHealth(request: FastifyRequest, reply: FastifyReply): Promise<never>;
    /** Lists persisted error events for one project. */
    listErrors(request: FastifyRequest, reply: FastifyReply): Promise<never>;
    /** Fetches one persisted error event by error_events.id or events.id. */
    getErrorById(request: FastifyRequest, reply: FastifyReply): Promise<never>;
    /**
     * Lists dead-lettered ingestion jobs (Postgres) for operator inspection.
     * Pagination is offset/limit; bounds are enforced both at the route schema
     * and again in the service for defense in depth.
     */
    getDLQ(request: FastifyRequest, reply: FastifyReply): Promise<never>;
    /** Requeues one failed ingestion job from the Postgres dead-letter table. */
    reprocessDLQ(request: FastifyRequest, reply: FastifyReply): Promise<never>;
    /** Requeues a bounded batch of failed jobs for bulk recovery operations. */
    reprocessAllDLQ(request: FastifyRequest, reply: FastifyReply): Promise<never>;
    /**
     * Replays historical events by loading them from Postgres and pushing replay
     * jobs into the queue with replay metadata.
     */
    replay(request: FastifyRequest, reply: FastifyReply): Promise<never>;
    /** Fetches the raw event plus type-specific child table details for debugging. */
    debugEvent(request: FastifyRequest, reply: FastifyReply): Promise<never>;
    private parseErrorListQuery;
    private optionalString;
    private optionalNumber;
    private optionalBoolean;
    /**
     * Converts domain error codes thrown by the service into SDK-safe HTTP
     * responses. Unknown errors are logged and remain generic to avoid leaking
     * internals to callers.
     */
    private handleError;
}
//# sourceMappingURL=controller.d.ts.map