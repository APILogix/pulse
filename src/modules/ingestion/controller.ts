import type { FastifyRequest, FastifyReply } from 'fastify';
import { IngestionService } from './service.js';

export class IngestionController {
  constructor(private service: IngestionService) {}

  async init(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { apiKey } = request.body as { apiKey: string };
      console.log(request.body)
      console.log("api key found",apiKey)
      if(!apiKey){
        throw new Error("key not found")
      }
      const result = await this.service.initializeSdk(apiKey);
      return reply.send(result);
    } catch (err: any) {
      console.log(err)
      return this.handleError(err, reply);
    }
  }

  async ingest(request: FastifyRequest, reply: FastifyReply) {
    try {
      console.log(request.body)
      const result = await this.service.ingestBatch(request.body as any);
      return reply.status(202).send(result);
    } catch (err: any) {
      return this.handleError(err, reply);
    }
  }

  async ingestRequests(request: FastifyRequest, reply: FastifyReply) {
    try {
      const result = await this.service.ingestRequests(request.body as any);
      return reply.status(202).send(result);
    } catch (err: any) {
      return this.handleError(err, reply);
    }
  }

  async ingestErrors(request: FastifyRequest, reply: FastifyReply) {
    try {
      const result = await this.service.ingestErrors(request.body as any);
      return reply.status(202).send(result);
    } catch (err: any) {
      return this.handleError(err, reply);
    }
  }

  async ingestLogs(request: FastifyRequest, reply: FastifyReply) {
    try {
      const result = await this.service.ingestLogs(request.body as any);
      return reply.status(202).send(result);
    } catch (err: any) {
      return this.handleError(err, reply);
    }
  }

  async ingestMetrics(request: FastifyRequest, reply: FastifyReply) {
    try {
      const result = await this.service.ingestMetrics(request.body as any);
      return reply.status(202).send(result);
    } catch (err: any) {
      return this.handleError(err, reply);
    }
  }

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

  async getIngestionHealth(request: FastifyRequest, reply: FastifyReply) {
    try {
      const result = await this.service.getIngestionHealth();
      return reply.send(result);
    } catch {
      return reply.status(503).send({ status: 'unhealthy' });
    }
  }

  async getLimits(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { apiKey } = request.query as { apiKey: string };
      const result = await this.service.getLimits(apiKey);
      return reply.send(result);
    } catch (err: any) {
      return this.handleError(err, reply);
    }
  }

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

  async reprocessAllDLQ(request: FastifyRequest, reply: FastifyReply) {
    try {
      const count = await this.service.reprocessAllDLQ();
      return reply.send({ success: true, reprocessed: count });
    } catch {
      return reply.status(500).send({ error: 'Bulk reprocess failed' });
    }
  }

  async replay(request: FastifyRequest, reply: FastifyReply) {
    try {
      const result = await this.service.replayEvents(request.body as any);
      return reply.status(202).send(result);
    } catch {
      return reply.status(500).send({ error: 'Replay failed' });
    }
  }

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