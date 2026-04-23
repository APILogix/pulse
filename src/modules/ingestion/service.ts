import { Queue, Job } from 'bullmq';
import { RedisCache } from '../../db/redis/cache.js';
import { PostgresWriter } from './postgress.writter.js';
import { IngestionBuffer } from './buffer.js';
import type {
  IngestRequest,
  IngestResponse,
  EnrichedEvent,
  ReplayRequest,
  HealthStatus,
  SDKEvent,
  SDKInitResponse,
} from './types.js';
import { createHash } from 'crypto';
import { randomUUID } from 'crypto';


function hashApiKey(apiKey: string): string {
  return createHash('sha256').update(apiKey).digest('hex');
}

export class IngestionService {
  private buffer: IngestionBuffer;
  private readonly circuitThreshold = 10;

  constructor(
    private queue: Queue,
    private cache: RedisCache,
    private writer: PostgresWriter,
    private config: {
      maxBatchSize: number;
      defaultRateLimitPerSecond: number;
      defaultRateLimitPerMinute: number;
    }
  ) {
    this.buffer = new IngestionBuffer(queue, {
      maxSize: 100,
      flushIntervalMs: 50,
    });
  }

  /** 
   * Resolve project by API key.
   * Redis cache first -> Postgres fallback -> Cache fill
   */
  private async resolveProject(apiKey: string) {
    const keyHash = hashApiKey(apiKey);

    // 1. Redis cache (sub-millisecond)
    let project = await this.cache.getProjectByApiKeyHash(keyHash);

    // 2. Postgres fallback (cache miss)
    if (!project) {
      const auth = await this.writer.getProjectByApiKeyHash(keyHash);
      if (!auth) return null;

      project = {
        id: auth.projectId,
        orgId: auth.orgId,
        name: auth.projectName,
        environment: auth.environment,
        rateLimitPerSecond: this.config.defaultRateLimitPerSecond,
        rateLimitPerMinute: this.config.defaultRateLimitPerMinute,
        allowedEventTypes: ['request', 'error', 'log', 'metric', 'custom'],
        isActive: auth.isActive,
        apiKeyId: auth.apiKeyId,
      };

      // Cache for fast subsequent lookups
      await this.cache.setProjectByApiKeyHash(keyHash, project);

      // Async last_used update (fire-and-forget)
      this.writer.updateApiKeyLastUsed(auth.apiKeyId).catch(() => { });
    }

    return project;
  }

  /** Initialize SDK — Returns exact contract your SDK expects */
  async initializeSdk(apiKey: string): Promise<SDKInitResponse> {
    const project = await this.resolveProject(apiKey);
    if (!project) throw new Error('INVALID_API_KEY');
    if (!project.isActive) throw new Error('PROJECT_INACTIVE');

    return {
      success: true,
      projectId: project.id,
      config: {
        samplingRate: 1,
        enableErrors: true,
        enablePerformance: true,
      },
      ingestion: {
        endpoint: process.env.INGESTION_ENDPOINT || 'http://127.0.0.1:3000/api/v1/ingest',
        batchSize: 50,
        flushInterval: 5000,
        maxQueueSize: 20000,
      },
    };
  }

  /** Main batch ingestion */
  async ingestBatch(req: IngestRequest): Promise<IngestResponse> {
    return this.processIngest(req);
  }

  /** Typed endpoints */
  async ingestRequests(req: IngestRequest): Promise<IngestResponse> {
    req.events.forEach((e) => {
      if (e.type !== 'request') throw new Error('INVALID_EVENT_TYPE');
    });
    return this.processIngest(req);
  }

  async ingestErrors(req: IngestRequest): Promise<IngestResponse> {
    req.events.forEach((e) => {
      if (e.type !== 'error') throw new Error('INVALID_EVENT_TYPE');
    });
    return this.processIngest(req);
  }

  async ingestLogs(req: IngestRequest): Promise<IngestResponse> {
    req.events.forEach((e) => {
      if (e.type !== 'log') throw new Error('INVALID_EVENT_TYPE');
    });
    return this.processIngest(req);
  }

  async ingestMetrics(req: IngestRequest): Promise<IngestResponse> {
    req.events.forEach((e) => {
      if (e.type !== 'metric') throw new Error('INVALID_EVENT_TYPE');
    });
    return this.processIngest(req);
  }

  /** Central processing pipeline */
  private async processIngest(req: IngestRequest): Promise<IngestResponse> {
    const { apiKey, events } = req;
    console.log(apiKey,events)

    // 1. Auth & Project Resolution
    const project = await this.resolveProject(apiKey);
    if (!project) throw new Error('INVALID_API_KEY');
    if (!project.isActive) throw new Error('PROJECT_INACTIVE');

    // 2. Rate limiting (per second)
    const secondLimit = await this.cache.checkRateLimit(
      project.id,
      project.rateLimitPerSecond,
      1
    );
    if (!secondLimit.allowed) throw new Error('RATE_LIMIT_EXCEEDED');

    // 3. Rate limiting (per minute)
    const minuteLimit = await this.cache.checkRateLimit(
      project.id,
      project.rateLimitPerMinute,
      60
    );
    if (!minuteLimit.allowed) throw new Error('RATE_LIMIT_EXCEEDED');

    // 4. Validation
    if (!events || events.length === 0) throw new Error('EMPTY_BATCH');
    if (events.length > this.config.maxBatchSize) throw new Error('BATCH_TOO_LARGE');

    // 5. Circuit breaker check
    if (await this.cache.isCircuitOpen('database')) {
      throw new Error('CIRCUIT_OPEN');
    }

    // 6. Enrich & dedup
    const batchId = randomUUID();
    const enriched: EnrichedEvent[] = [];
    const errors: Array<{ eventId: string; reason: string }> = [];

    for (const event of events) {
      const eventId = event.requestId || randomUUID();

      // Type validation
      if (!project.allowedEventTypes.includes(event.type)) {
        errors.push({ eventId, reason: `Event type '${event.type}' not allowed` });
        continue;
      }

      // Idempotency check
      const isNew = await this.cache.checkIdempotency(eventId);
      if (!isNew) {
        errors.push({ eventId, reason: 'Duplicate event' });
        continue;
      }

      enriched.push({
        id: eventId,
        type: event.type,
        projectId: project.id,
        orgId: project.orgId,
        requestId: event.requestId,
        receivedAt: Date.now(),
        batchId,
        payload: event,
      });
    }

    // 7. Push to buffer (non-blocking)
    if (enriched.length > 0) {
      await Promise.all(enriched.map((e) => this.buffer.add(e)));
      await Promise.all([
        this.cache.incrementIngestCounter(project.id, 'total'),
        this.cache.recordLastIngest(project.id),
      ]);
    }

    return {
      success: true,
      accepted: enriched.length,
      rejected: errors.length,
      batchId,
      limits: {
        remaining: minuteLimit.remaining,
        resetAt: minuteLimit.resetAt,
      },
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  async getHealth(): Promise<HealthStatus> {
    const [redis, database, queue] = await Promise.all([
      this.cache.ping().then(() => true).catch(() => false),
      this.writer.healthCheck(),
      this.queue.client
        .then((client) => client.ping().then(() => true))
        .catch(() => false),
    ]);

    const status = redis && database && queue ? 'healthy' : 'degraded';

    return {
      status,
      services: { redis, database, queue },
      timestamp: new Date().toISOString(),
    };
  }

  async getIngestionHealth(): Promise<any> {
    const [waiting, active, completed, failed] = await Promise.all([
      this.queue.getWaitingCount(),
      this.queue.getActiveCount(),
      this.queue.getCompletedCount(),
      this.queue.getFailedCount(),
    ]);

    return {
      queue: 'ingestion',
      jobs: { waiting, active, completed, failed },
      buffer: this.buffer.metrics,
      timestamp: new Date().toISOString(),
    };
  }

  async getLimits(apiKey: string) {
    const project = await this.resolveProject(apiKey);
    if (!project) throw new Error('INVALID_API_KEY');

    return {
      perSecond: project.rateLimitPerSecond,
      perMinute: project.rateLimitPerMinute,
      maxBatchSize: this.config.maxBatchSize,
    };
  }

  async getDLQJobs(start = 0, end = 100): Promise<Job[]> {
    return this.queue.getFailed(start, end);
  }

  async reprocessDLQJob(jobId: string): Promise<void> {
    const job = await this.queue.getJob(jobId);
    if (!job) throw new Error('JOB_NOT_FOUND');
    await job.retry();
  }

  async reprocessAllDLQ(batchSize = 100): Promise<number> {
    const failed = await this.queue.getFailed(0, batchSize);
    await Promise.all(failed.map((job) => job.retry()));
    return failed.length;
  }

  async replayEvents(req: ReplayRequest): Promise<{ replayId: string; queued: number }> {
    const { projectId, startTime, endTime, eventTypes } = req;

    const events = await this.writer.getEventsForReplay(
      projectId,
      startTime,
      endTime,
      eventTypes
    );

    if (events.length === 0) return { replayId: randomUUID(), queued: 0 };

    const replayId = randomUUID();
    await this.queue.addBulk(
      events.map((event) => ({
        name: `replay:${event.type}`,
        data: { ...event, replayId, isReplay: true },
        opts: {
          jobId: `replay:${event.id}:${Date.now()}`,
          attempts: 3,
        },
      }))
    );

    return { replayId, queued: events.length };
  }

  async getDebugEvent(eventId: string, projectId: string) {
    return this.writer.getEventById(eventId, projectId);
  }

  async shutdown(): Promise<void> {
    await this.buffer.destroy();
  }
}