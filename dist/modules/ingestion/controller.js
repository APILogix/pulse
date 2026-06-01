import { IngestionService } from './service.js';
import { resolveApiKey } from './utils/api-key.js';
const ERROR_MAP = {
    INVALID_REQUEST: { status: 400, message: 'Invalid request body' },
    INVALID_API_KEY: { status: 401, message: 'Invalid API key' },
    PROJECT_INACTIVE: { status: 403, message: 'Project inactive' },
    RATE_LIMIT_EXCEEDED: { status: 429, message: 'Rate limit exceeded' },
    EMPTY_BATCH: { status: 400, message: 'No events provided' },
    BATCH_TOO_LARGE: { status: 413, message: 'Batch exceeds maximum size' },
    CIRCUIT_OPEN: { status: 503, message: 'Service temporarily unavailable' },
    INVALID_EVENT_TYPE: { status: 400, message: 'Invalid event type for endpoint' },
    INVALID_DATE_RANGE: { status: 400, message: 'Invalid date range' },
    JOB_NOT_FOUND: { status: 404, message: 'Job not found' },
};
export class IngestionController {
    service;
    constructor(service) {
        this.service = service;
    }
    /**
     * SDK bootstrap endpoint.
     * Flow: read apiKey -> resolve project through service -> return SDK runtime
     * config. Invalid or inactive projects are translated by handleError().
     */
    async init(request, reply) {
        try {
            const apiKey = resolveApiKey(request, (request.body ?? {}));
            if (!apiKey) {
                throw new Error('INVALID_API_KEY');
            }
            const result = await this.service.initializeSdk(apiKey);
            return reply.send(result);
        }
        catch (err) {
            return this.handleError(err, request, reply);
        }
    }
    /**
     * Generic batch endpoint for mixed event types.
     * Flow: pass raw batch to service -> service enriches and queues accepted
     * events -> return 202 because persistence happens asynchronously.
     */
    async ingest(request, reply) {
        try {
            const body = request.body;
            const apiKey = resolveApiKey(request, body);
            if (!apiKey)
                throw new Error('INVALID_API_KEY');
            const result = await this.service.ingestBatch(body, apiKey);
            return reply.status(202).send(result);
        }
        catch (err) {
            return this.handleError(err, request, reply);
        }
    }
    /**
     * Typed request-event endpoint. The service rejects any event whose type does
     * not match this route, which protects downstream request_events inserts.
     */
    async ingestRequests(request, reply) {
        try {
            const body = request.body;
            const apiKey = resolveApiKey(request, body);
            if (!apiKey)
                throw new Error('INVALID_API_KEY');
            const result = await this.service.ingestRequests(body, apiKey);
            return reply.status(202).send(result);
        }
        catch (err) {
            return this.handleError(err, request, reply);
        }
    }
    /** Typed error-event endpoint for SDK exceptions and crash payloads. */
    async ingestErrors(request, reply) {
        try {
            const body = request.body;
            const apiKey = resolveApiKey(request, body);
            if (!apiKey)
                throw new Error('INVALID_API_KEY');
            const result = await this.service.ingestErrors(body, apiKey);
            return reply.status(202).send(result);
        }
        catch (err) {
            return this.handleError(err, request, reply);
        }
    }
    /** Typed log-event endpoint for application log records. */
    async ingestLogs(request, reply) {
        try {
            const body = request.body;
            const apiKey = resolveApiKey(request, body);
            if (!apiKey)
                throw new Error('INVALID_API_KEY');
            const result = await this.service.ingestLogs(body, apiKey);
            return reply.status(202).send(result);
        }
        catch (err) {
            return this.handleError(err, request, reply);
        }
    }
    /** Typed metric-event endpoint for numeric telemetry samples. */
    async ingestMetrics(request, reply) {
        try {
            const body = request.body;
            const apiKey = resolveApiKey(request, body);
            if (!apiKey)
                throw new Error('INVALID_API_KEY');
            const result = await this.service.ingestMetrics(body, apiKey);
            return reply.status(202).send(result);
        }
        catch (err) {
            return this.handleError(err, request, reply);
        }
    }
    /**
     * Public health check. Returns 200 only when Postgres + queue are healthy;
     * any degraded dependency returns 503. This module does not depend on Redis,
     * so the response always reports `redis: false` honestly.
     */
    async getHealth(request, reply) {
        try {
            const result = await this.service.getHealth();
            const statusCode = result.status === 'healthy' ? 200 : 503;
            return reply.status(statusCode).send(result);
        }
        catch (err) {
            request.log.error({ err }, 'Public health check failed');
            return reply.status(503).send({
                status: 'unhealthy',
                timestamp: new Date().toISOString(),
            });
        }
    }
    /** Authenticated operational health endpoint for queue and buffer metrics. */
    async getIngestionHealth(request, reply) {
        try {
            const result = await this.service.getIngestionHealth();
            return reply.send(result);
        }
        catch (err) {
            request.log.error({ err }, 'Ingestion operational health check failed');
            return reply.status(503).send({ status: 'unhealthy' });
        }
    }
    /** Lists persisted error events for one project. */
    async listErrors(request, reply) {
        try {
            const query = this.parseErrorListQuery(request.query);
            const result = await this.service.listErrors(query);
            return reply.send({
                success: true,
                data: result.data,
                meta: {
                    projectId: query.projectId,
                    total: result.total,
                    limit: result.limit,
                    offset: result.offset,
                    hasMore: result.hasMore,
                },
            });
        }
        catch (err) {
            return this.handleError(err, request, reply);
        }
    }
    /** Fetches one persisted error event by error_events.id or events.id. */
    async getErrorById(request, reply) {
        try {
            const { errorId } = request.params;
            const { projectId } = request.query;
            const result = await this.service.getErrorById(errorId, projectId);
            if (!result) {
                return reply.status(404).send({
                    error: 'Error event not found',
                    code: 'ERROR_NOT_FOUND',
                });
            }
            return reply.send({ success: true, data: result });
        }
        catch (err) {
            return this.handleError(err, request, reply);
        }
    }
    /**
     * Lists dead-lettered ingestion jobs (Postgres) for operator inspection.
     * Pagination is offset/limit; bounds are enforced both at the route schema
     * and again in the service for defense in depth.
     */
    async getDLQ(request, reply) {
        try {
            const { offset = 0, limit = 100 } = (request.query ?? {});
            const jobs = await this.service.getDLQJobs(Number(offset), Number(limit));
            return reply.send({ count: jobs.length, jobs });
        }
        catch (err) {
            request.log.error({ err }, 'Failed to fetch DLQ');
            return reply.status(500).send({ error: 'Failed to fetch DLQ' });
        }
    }
    /** Requeues one failed ingestion job from the Postgres dead-letter table. */
    async reprocessDLQ(request, reply) {
        try {
            const { jobId } = request.params;
            await this.service.reprocessDLQJob(jobId);
            return reply.send({ success: true, message: 'Job requeued' });
        }
        catch (err) {
            if (err instanceof Error && err.message === 'JOB_NOT_FOUND') {
                return reply.status(404).send({ error: 'Job not found' });
            }
            request.log.error({ err }, 'Failed to reprocess DLQ job');
            return reply.status(500).send({ error: 'Reprocess failed' });
        }
    }
    /** Requeues a bounded batch of failed jobs for bulk recovery operations. */
    async reprocessAllDLQ(request, reply) {
        try {
            const body = (request.body ?? {});
            const count = await this.service.reprocessAllDLQ(typeof body.batchSize === 'number' ? body.batchSize : 100);
            return reply.send({ success: true, reprocessed: count });
        }
        catch (err) {
            request.log.error({ err }, 'Failed to bulk reprocess DLQ');
            return reply.status(500).send({ error: 'Bulk reprocess failed' });
        }
    }
    /**
     * Replays historical events by loading them from Postgres and pushing replay
     * jobs into the queue with replay metadata.
     */
    async replay(request, reply) {
        try {
            const result = await this.service.replayEvents(request.body);
            return reply.status(202).send(result);
        }
        catch (err) {
            request.log.error({ err }, 'Replay failed');
            return reply.status(500).send({ error: 'Replay failed' });
        }
    }
    /** Fetches the raw event plus type-specific child table details for debugging. */
    async debugEvent(request, reply) {
        try {
            const { id } = request.params;
            const { projectId } = request.query;
            const result = await this.service.getDebugEvent(id, projectId);
            if (!result)
                return reply.status(404).send({ error: 'Event not found' });
            return reply.send(result);
        }
        catch (err) {
            request.log.error({ err }, 'Debug lookup failed');
            return reply.status(500).send({ error: 'Debug lookup failed' });
        }
    }
    parseErrorListQuery(raw) {
        const query = {
            projectId: String(raw.projectId ?? ''),
        };
        const limit = this.optionalNumber(raw.limit);
        if (limit !== undefined)
            query.limit = limit;
        const offset = this.optionalNumber(raw.offset);
        if (offset !== undefined)
            query.offset = offset;
        const from = this.optionalString(raw.from);
        if (from !== undefined)
            query.from = from;
        const to = this.optionalString(raw.to);
        if (to !== undefined)
            query.to = to;
        const fingerprint = this.optionalString(raw.fingerprint);
        if (fingerprint !== undefined)
            query.fingerprint = fingerprint;
        const errorType = this.optionalString(raw.errorType);
        if (errorType !== undefined)
            query.errorType = errorType;
        const resolved = this.optionalBoolean(raw.resolved);
        if (resolved !== undefined)
            query.resolved = resolved;
        return query;
    }
    optionalString(value) {
        if (typeof value !== 'string')
            return undefined;
        const trimmed = value.trim();
        return trimmed.length > 0 ? trimmed : undefined;
    }
    optionalNumber(value) {
        if (typeof value === 'number')
            return Number.isFinite(value) ? value : undefined;
        if (typeof value !== 'string' || value.trim().length === 0)
            return undefined;
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : undefined;
    }
    optionalBoolean(value) {
        if (typeof value === 'boolean')
            return value;
        if (value === 'true')
            return true;
        if (value === 'false')
            return false;
        return undefined;
    }
    /**
     * Converts domain error codes thrown by the service into SDK-safe HTTP
     * responses. Unknown errors are logged and remain generic to avoid leaking
     * internals to callers.
     */
    handleError(err, request, reply) {
        const code = err instanceof Error ? err.message : 'INTERNAL_ERROR';
        const mapped = ERROR_MAP[code];
        if (mapped) {
            return reply.status(mapped.status).send({
                error: mapped.message,
                code,
            });
        }
        request.log.error({ err, reqId: request.id }, 'Unhandled ingestion error');
        return reply.status(500).send({
            error: 'Internal server error',
            code: 'INTERNAL_ERROR',
        });
    }
}
//# sourceMappingURL=controller.js.map