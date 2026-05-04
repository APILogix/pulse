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
 */
import type { FastifyRequest, FastifyReply } from 'fastify';
import { IngestionService } from './service.js';
export declare class IngestionController {
    private service;
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
     * Public health check. Returns 200 only when Redis, Postgres, and queue
     * connectivity are all healthy; degraded dependencies return 503.
     */
    getHealth(request: FastifyRequest, reply: FastifyReply): Promise<never>;
    /** Authenticated operational health endpoint for queue and buffer metrics. */
    getIngestionHealth(request: FastifyRequest, reply: FastifyReply): Promise<never>;
    /** Returns the rate-limit and batch-size policy resolved from an API key. */
    getLimits(request: FastifyRequest, reply: FastifyReply): Promise<never>;
    /** Lists persisted error events for one project. */
    listErrors(request: FastifyRequest, reply: FastifyReply): Promise<never>;
    /** Fetches one persisted error event by error_events.id or events.id. */
    getErrorById(request: FastifyRequest, reply: FastifyReply): Promise<never>;
    /** Lists failed BullMQ jobs so operators can inspect dead-letter payloads. */
    getDLQ(request: FastifyRequest, reply: FastifyReply): Promise<never>;
    /** Requeues one failed BullMQ job after an operator chooses to retry it. */
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
     * responses. Unknown errors remain generic to avoid leaking internals.
     */
    private handleError;
}
//# sourceMappingURL=controller.d.ts.map