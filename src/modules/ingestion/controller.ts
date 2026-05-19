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
import type { ErrorEventListQuery } from './types.js';

export class IngestionController {
  constructor(private service: IngestionService) {}

  /**
   * SDK bootstrap endpoint.
   * Flow: read apiKey -> resolve project through service -> return SDK runtime
   * config. Invalid or inactive projects are translated by handleError().
   */
  async init(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { apiKey } = request.body as { apiKey: string };
      if(!apiKey){
        throw new Error("key not found")
      }
      const result = await this.service.initializeSdk(apiKey);
      return reply.send(result);
    } catch (err: any) {
      return this.handleError(err, reply);
    }
  }

  /**
   * Generic batch endpoint for mixed event types.
   * Flow: pass raw batch to service -> service enriches and queues accepted
   * events -> return 202 because persistence happens asynchronously.
   */
  async ingest(request: FastifyRequest, reply: FastifyReply) {
    try {
      const result = await this.service.ingestBatch(request.body as any);
      return reply.status(202).send(result);
    } catch (err: any) {
      return this.handleError(err, reply);
    }
  }

  /**
   * Typed request-event endpoint. The service rejects any event whose type does
   * not match this route, which protects downstream request_events inserts.
   */
  async ingestRequests(request: FastifyRequest, reply: FastifyReply) {
    try {
      const result = await this.service.ingestRequests(request.body as any);
      return reply.status(202).send(result);
    } catch (err: any) {
      return this.handleError(err, reply);
    }
  }

  /** Typed error-event endpoint for SDK exceptions and crash payloads. */
  async ingestErrors(request: FastifyRequest, reply: FastifyReply) {
    try {
      const result = await this.service.ingestErrors(request.body as any);
      return reply.status(202).send(result);
    } catch (err: any) {
      return this.handleError(err, reply);
    }
  }

  /** Typed log-event endpoint for application log records. */
  async ingestLogs(request: FastifyRequest, reply: FastifyReply) {
    try {
      const result = await this.service.ingestLogs(request.body as any);
      return reply.status(202).send(result);
    } catch (err: any) {
      return this.handleError(err, reply);
    }
  }

  /** Typed metric-event endpoint for numeric telemetry samples. */
  async ingestMetrics(request: FastifyRequest, reply: FastifyReply) {
    try {
      const result = await this.service.ingestMetrics(request.body as any);
      return reply.status(202).send(result);
    } catch (err: any) {
      return this.handleError(err, reply);
    }
  }

  /**
   * Public health check. Returns 200 only when Redis, Postgres, and queue
   * connectivity are all healthy; degraded dependencies return 503.
   */
  async getHealth(request: FastifyRequest, reply: FastifyReply) {
    try {
      const result = await this.service.getHealth();
      const statusCode = result.status === 'healthy' ? 200 : 503;
      return reply.status(statusCode).send(result);
    } catch {
      return reply.status(503).send({ 
        status: 'unhealthy', 
        timestamp: new Date().toISOString() 
      });
    }
  }

  /** Authenticated operational health endpoint for queue and buffer metrics. */
  async getIngestionHealth(request: FastifyRequest, reply: FastifyReply) {
    try {
      const result = await this.service.getIngestionHealth();
      return reply.send(result);
    } catch {
      return reply.status(503).send({ status: 'unhealthy' });
    }
  }

  /** Returns the rate-limit and batch-size policy resolved from an API key. */
  async getLimits(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { apiKey } = request.query as { apiKey: string };
      const result = await this.service.getLimits(apiKey);
      return reply.send(result);
    } catch (err: any) {
      return this.handleError(err, reply);
    }
  }

  /** Lists persisted error events for one project. */
  async listErrors(request: FastifyRequest, reply: FastifyReply) {
    try {
      const query = this.parseErrorListQuery(request.query as Record<string, unknown>);
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
    } catch (err: any) {
      return this.handleError(err, reply);
    }
  }

  /** Fetches one persisted error event by error_events.id or events.id. */
  async getErrorById(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { errorId } = request.params as { errorId: string };
      const { projectId } = request.query as { projectId: string };
      const result = await this.service.getErrorById(errorId, projectId);

      if (!result) {
        return reply.status(404).send({
          error: 'Error event not found',
          code: 'ERROR_NOT_FOUND',
        });
      }

      return reply.send({ success: true, data: result });
    } catch (err: any) {
      return this.handleError(err, reply);
    }
  }

  /** Lists failed BullMQ jobs so operators can inspect dead-letter payloads. */
  async getDLQ(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { start = 0, end = 100 } = request.query as any;
      const jobs = await this.service.getDLQJobs(Number(start), Number(end));
      return reply.send({
        count: jobs.length,
        jobs: jobs.map((j) => ({
          id: j.id,
          name: j.name,
          failedReason: j.failedReason,
          stacktrace: j.stacktrace,
          timestamp: j.timestamp,
          attemptsMade: j.attemptsMade,
          data: j.data,
        })),
      });
    } catch {
      return reply.status(500).send({ error: 'Failed to fetch DLQ' });
    }
  }

  /** Requeues one failed BullMQ job after an operator chooses to retry it. */
  async reprocessDLQ(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { jobId } = request.params as { jobId: string };
      await this.service.reprocessDLQJob(jobId);
      return reply.send({ success: true, message: 'Job requeued' });
    } catch (err: any) {
      if (err.message === 'JOB_NOT_FOUND') {
        return reply.status(404).send({ error: 'Job not found' });
      }
      return reply.status(500).send({ error: 'Reprocess failed' });
    }
  }

  /** Requeues a bounded batch of failed jobs for bulk recovery operations. */
  async reprocessAllDLQ(request: FastifyRequest, reply: FastifyReply) {
    try {
      const count = await this.service.reprocessAllDLQ();
      return reply.send({ success: true, reprocessed: count });
    } catch {
      return reply.status(500).send({ error: 'Bulk reprocess failed' });
    }
  }

  /**
   * Replays historical events by loading them from Postgres and pushing replay
   * jobs into the queue with replay metadata.
   */
  async replay(request: FastifyRequest, reply: FastifyReply) {
    try {
      const result = await this.service.replayEvents(request.body as any);
      return reply.status(202).send(result);
    } catch {
      return reply.status(500).send({ error: 'Replay failed' });
    }
  }

  /** Fetches the raw event plus type-specific child table details for debugging. */
  async debugEvent(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = request.params as { id: string };
      const { projectId } = request.query as { projectId: string };
      const result = await this.service.getDebugEvent(id, projectId);
      if (!result) return reply.status(404).send({ error: 'Event not found' });
      return reply.send(result);
    } catch {
      return reply.status(500).send({ error: 'Debug lookup failed' });
    }
  }

  private parseErrorListQuery(raw: Record<string, unknown>): ErrorEventListQuery {
    const query: ErrorEventListQuery = {
      projectId: String(raw.projectId ?? ''),
    };

    const limit = this.optionalNumber(raw.limit);
    if (limit !== undefined) {
      query.limit = limit;
    }

    const offset = this.optionalNumber(raw.offset);
    if (offset !== undefined) {
      query.offset = offset;
    }

    const from = this.optionalString(raw.from);
    if (from !== undefined) {
      query.from = from;
    }

    const to = this.optionalString(raw.to);
    if (to !== undefined) {
      query.to = to;
    }

    const fingerprint = this.optionalString(raw.fingerprint);
    if (fingerprint !== undefined) {
      query.fingerprint = fingerprint;
    }

    const errorType = this.optionalString(raw.errorType);
    if (errorType !== undefined) {
      query.errorType = errorType;
    }

    const resolved = this.optionalBoolean(raw.resolved);
    if (resolved !== undefined) {
      query.resolved = resolved;
    }

    return query;
  }

  private optionalString(value: unknown): string | undefined {
    if (typeof value !== 'string') {
      return undefined;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  private optionalNumber(value: unknown): number | undefined {
    if (typeof value === 'number') {
      return value;
    }

    if (typeof value !== 'string' || value.trim().length === 0) {
      return undefined;
    }

    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  private optionalBoolean(value: unknown): boolean | undefined {
    if (typeof value === 'boolean') {
      return value;
    }

    if (value === 'true') {
      return true;
    }
    if (value === 'false') {
      return false;
    }

    return undefined;
  }

  /**
   * Converts domain error codes thrown by the service into SDK-safe HTTP
   * responses. Unknown errors remain generic to avoid leaking internals.
   */
  private handleError(err: Error, reply: FastifyReply) {
    const code = err.message;
    const errorMap: Record<string, { status: number; message: string }> = {
      INVALID_API_KEY: { status: 401, message: 'Invalid API key' },
      PROJECT_INACTIVE: { status: 403, message: 'Project inactive' },
      RATE_LIMIT_EXCEEDED: { status: 429, message: 'Rate limit exceeded' },
      EMPTY_BATCH: { status: 400, message: 'No events provided' },
      BATCH_TOO_LARGE: { status: 413, message: 'Batch exceeds maximum size' },
      CIRCUIT_OPEN: { status: 503, message: 'Service temporarily unavailable' },
      INVALID_EVENT_TYPE: { status: 400, message: 'Invalid event type for endpoint' },
      INVALID_DATE_RANGE: { status: 400, message: 'Invalid date range' },
    };

    const mapped = errorMap[code];
    if (mapped) {
      return reply.status(mapped.status).send({ 
        error: mapped.message, 
        code 
      });
    }

    return reply.status(500).send({ 
      error: 'Internal server error', 
      code: 'INTERNAL_ERROR' 
    });
  }
}
