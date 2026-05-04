/**
 * Ingestion business service.
 *
 * End-to-end flow:
 * 1. Hash the SDK API key and resolve the owning project from Redis first, then
 *    Postgres on cache miss.
 * 2. Enforce project status and per-project rate limits before accepting data.
 * 3. Validate batch size and event type permissions.
 * 4. Apply idempotency per event id to avoid duplicate queue work.
 * 5. Enrich accepted events with project/org/batch metadata and push them into
 *    the in-memory buffer for BullMQ delivery.
 *
 * This class owns ingestion policy, but it does not write events directly; the
 * worker side persists queued events through PostgresWriter.
 */
import { Queue, Job } from 'bullmq';
import { RedisCache } from '../../db/redis/cache.js';
import { PostgresWriter } from './postgress.writter.js';
import { IngestionBuffer } from './buffer.js';
import { createHash } from 'crypto';
import { randomUUID } from 'crypto';
function hashApiKey(apiKey) {
    // API keys are never looked up by plaintext. The same SHA-256 hash is stored
    // in project_api_keys and used as the cache key.
    return createHash('sha256').update(apiKey).digest('hex');
}
export class IngestionService {
    queue;
    cache;
    writer;
    config;
    buffer;
    circuitThreshold = 10;
    constructor(queue, cache, writer, config) {
        this.queue = queue;
        this.cache = cache;
        this.writer = writer;
        this.config = config;
        this.buffer = new IngestionBuffer(queue, {
            maxSize: 100,
            flushIntervalMs: 50,
        });
    }
    /**
     * Resolve project by API key.
     * Redis cache first -> Postgres fallback -> Cache fill
     */
    async resolveProject(apiKey) {
        const keyHash = hashApiKey(apiKey);
        // 1. Redis cache (sub-millisecond)
        let project = await this.cache.getProjectByApiKeyHash(keyHash);
        // 2. Postgres fallback (cache miss)
        if (!project) {
            const auth = await this.writer.getProjectByApiKeyHash(keyHash);
            if (!auth)
                return null;
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
    async initializeSdk(apiKey) {
        const project = await this.resolveProject(apiKey);
        if (!project)
            throw new Error('INVALID_API_KEY');
        if (!project.isActive)
            throw new Error('PROJECT_INACTIVE');
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
    async ingestBatch(req) {
        return this.processIngest(req);
    }
    /** Typed endpoints */
    async ingestRequests(req) {
        // Typed routes provide a stricter contract than the generic ingest endpoint:
        // every event in the request must match the route-specific type.
        req.events.forEach((e) => {
            if (e.type !== 'request')
                throw new Error('INVALID_EVENT_TYPE');
        });
        return this.processIngest(req);
    }
    async ingestErrors(req) {
        req.events.forEach((e) => {
            if (e.type !== 'error')
                throw new Error('INVALID_EVENT_TYPE');
        });
        return this.processIngest(req);
    }
    async ingestLogs(req) {
        req.events.forEach((e) => {
            if (e.type !== 'log')
                throw new Error('INVALID_EVENT_TYPE');
        });
        return this.processIngest(req);
    }
    async ingestMetrics(req) {
        req.events.forEach((e) => {
            if (e.type !== 'metric')
                throw new Error('INVALID_EVENT_TYPE');
        });
        return this.processIngest(req);
    }
    /** Central processing pipeline */
    async processIngest(req) {
        const { apiKey, events } = req;
        console.log(apiKey, events, "logging api keys and events");
        // 1. Auth and project resolution. The project carries rate limits,
        // environment, org ownership, and the allowed event-type policy.
        const project = await this.resolveProject(apiKey);
        if (!project)
            throw new Error('INVALID_API_KEY');
        if (!project.isActive)
            throw new Error('PROJECT_INACTIVE');
        console.log("project resolved", project);
        // 2. Fast per-second rate limiting protects the queue and database from
        // sudden spikes.
        const secondLimit = await this.cache.checkRateLimit(project.id, project.rateLimitPerSecond, 1);
        if (!secondLimit.allowed)
            throw new Error('RATE_LIMIT_EXCEEDED');
        console.log("rate limit pahse 1 ");
        // 3. Per-minute limiting smooths sustained load while still allowing short
        // bursts that pass the one-second check.
        const minuteLimit = await this.cache.checkRateLimit(project.id, project.rateLimitPerMinute, 60);
        if (!minuteLimit.allowed)
            throw new Error('RATE_LIMIT_EXCEEDED');
        console.log("ratelimit per minute");
        // 4. Batch validation rejects empty work and oversized client flushes before
        // idempotency or queue writes are attempted.
        if (!events || events.length === 0)
            throw new Error('EMPTY_BATCH');
        if (events.length > this.config.maxBatchSize)
            throw new Error('BATCH_TOO_LARGE');
        // 5. Circuit breaker check stops acceptance when a dependency is already
        // marked unhealthy. This prevents the buffer from hiding a persistent outage.
        if (await this.cache.isCircuitOpen('database')) {
            throw new Error('CIRCUIT_OPEN');
        }
        // 6. Enrich and deduplicate. Each accepted event receives stable storage
        // metadata; duplicates and disallowed types are reported as rejected items
        // without failing the whole batch.
        const batchId = randomUUID();
        const enriched = [];
        const errors = [];
        for (const event of events) {
            const eventId = event.requestId || randomUUID();
            // Type validation is project-scoped because different projects/plans may
            // allow different telemetry categories.
            if (!project.allowedEventTypes.includes(event.type)) {
                errors.push({ eventId, reason: `Event type '${event.type}' not allowed` });
                continue;
            }
            // Idempotency protects queue workers and database inserts from retries
            // sent by SDKs after network failures.
            const isNew = await this.cache.checkIdempotency(eventId);
            if (!isNew) {
                errors.push({ eventId, reason: 'Duplicate event' });
                continue;
            }
            console.log("idopodency check");
            const enrichedEvent = {
                id: eventId,
                type: event.type,
                projectId: project.id,
                orgId: project.orgId,
                receivedAt: Date.now(),
                batchId,
                payload: event,
            };
            if (event.requestId !== undefined) {
                enrichedEvent.requestId = event.requestId;
            }
            enriched.push(enrichedEvent);
        }
        console.log("event push");
        // 7. Push to buffer. The API returns once events are accepted into the
        // internal queueing path; database persistence happens asynchronously.
        if (enriched.length > 0) {
            await Promise.all(enriched.map((e) => this.buffer.add(e)));
            await Promise.all([
                this.cache.incrementIngestCounter(project.id, 'total'),
                this.cache.recordLastIngest(project.id),
            ]);
        }
        console.log("all thing done");
        const response = {
            success: true,
            accepted: enriched.length,
            rejected: errors.length,
            batchId,
            limits: {
                remaining: minuteLimit.remaining,
                resetAt: minuteLimit.resetAt,
            },
        };
        if (errors.length > 0) {
            response.errors = errors;
        }
        return response;
    }
    async getHealth() {
        // Health is dependency-based: Redis powers cache/rate limits, Postgres powers
        // project lookup and event storage, and BullMQ powers async ingestion.
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
    async getIngestionHealth() {
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
    async getLimits(apiKey) {
        const project = await this.resolveProject(apiKey);
        if (!project)
            throw new Error('INVALID_API_KEY');
        return {
            perSecond: project.rateLimitPerSecond,
            perMinute: project.rateLimitPerMinute,
            maxBatchSize: this.config.maxBatchSize,
        };
    }
    async getDLQJobs(start = 0, end = 100) {
        return this.queue.getFailed(start, end);
    }
    async reprocessDLQJob(jobId) {
        const job = await this.queue.getJob(jobId);
        if (!job)
            throw new Error('JOB_NOT_FOUND');
        await job.retry();
    }
    async reprocessAllDLQ(batchSize = 100) {
        const failed = await this.queue.getFailed(0, batchSize);
        await Promise.all(failed.map((job) => job.retry()));
        return failed.length;
    }
    async replayEvents(req) {
        // Replay intentionally uses queue jobs instead of direct writes so historical
        // events pass through the same worker processing path as live ingestion.
        const { projectId, startTime, endTime, eventTypes } = req;
        const events = await this.writer.getEventsForReplay(projectId, startTime, endTime, eventTypes);
        if (events.length === 0)
            return { replayId: randomUUID(), queued: 0 };
        const replayId = randomUUID();
        await this.queue.addBulk(events.map((event) => ({
            name: `replay:${event.type}`,
            data: { ...event, replayId, isReplay: true },
            opts: {
                jobId: `replay:${event.id}:${Date.now()}`,
                attempts: 3,
            },
        })));
        return { replayId, queued: events.length };
    }
    async listErrors(query) {
        return this.writer.listErrorEvents(this.normalizeErrorEventListQuery(query));
    }
    async getErrorById(errorId, projectId) {
        return this.writer.getErrorEventById(errorId, projectId);
    }
    async getDebugEvent(eventId, projectId) {
        return this.writer.getEventById(eventId, projectId);
    }
    async shutdown() {
        await this.buffer.destroy();
    }
    normalizeErrorEventListQuery(query) {
        const normalized = {
            projectId: query.projectId,
            limit: this.normalizeInteger(query.limit, 50, 1, 100),
            offset: this.normalizeInteger(query.offset, 0, 0, 100_000),
        };
        const from = this.parseOptionalDate(query.from);
        const to = this.parseOptionalDate(query.to);
        if (from && to && from.getTime() > to.getTime()) {
            throw new Error('INVALID_DATE_RANGE');
        }
        if (from) {
            normalized.from = from.toISOString();
        }
        if (to) {
            normalized.to = to.toISOString();
        }
        if (query.fingerprint) {
            normalized.fingerprint = query.fingerprint;
        }
        if (query.errorType) {
            normalized.errorType = query.errorType;
        }
        if (query.resolved !== undefined) {
            normalized.resolved = query.resolved;
        }
        return normalized;
    }
    parseOptionalDate(value) {
        if (!value) {
            return undefined;
        }
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) {
            throw new Error('INVALID_DATE_RANGE');
        }
        return date;
    }
    normalizeInteger(value, fallback, min, max) {
        if (value === undefined || !Number.isFinite(value)) {
            return fallback;
        }
        return Math.max(min, Math.min(Math.trunc(value), max));
    }
}
//# sourceMappingURL=service.js.map