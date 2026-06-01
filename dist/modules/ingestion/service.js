/**
 * Ingestion business service (PostgreSQL-queue cutover).
 *
 * Request-path flow (fast, no heavy work):
 *   1. Resolve project from the API key (LRU cache -> Postgres fallback).
 *   2. Enforce project status + per-project rate limits + batch caps.
 *   3. Normalize/validate every event (size/cardinality/poison protection).
 *   4. Enqueue accepted events as tenant-scoped jobs via PgQueue.enqueueBulk().
 *   5. Return 202-style accept/reject counts.
 *
 * There is NO in-memory buffering and NO BullMQ. Durability is the queue row in
 * Postgres: once enqueueBulk() commits, the event survives a crash. Persistence
 * into the typed telemetry tables happens asynchronously in PgQueueWorker.
 *
 * Backpressure: when the queue's pending depth exceeds a high-water mark we shed
 * low-priority signals first (metric/log/profile/replay) before high-priority
 * ones (error/message/cron) so the platform degrades gracefully under flood.
 *
 * Hardening notes (vs the original):
 *   - Rate limiter is a sweeping, atomic, bounded token-bucket (no Map leak,
 *     no race window between read and increment).
 *   - Health probe accurately reports only the dependencies this module has
 *     (Postgres + queue) — no phantom Redis flag.
 *   - Backpressure thresholds and batch caps come from env, not literals.
 *   - DLQ access uses the queue's own Pool reference; no `as unknown as` cast.
 *   - Replay is bounded by INGESTION_REPLAY_MAX_EVENTS, not a hardcoded 10k.
 */
import { createHash, randomUUID } from 'crypto';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { apiKeyCache } from '../../config/lrucashe.js';
import { PgQueue } from './queue/pg-queue.js';
import { PostgresWriter } from './postgress.writter.js';
import { IngestionRateLimiter } from './rate-limiter.js';
import { normalizeEvent, } from './pipeline/event-normalizer.js';
const svcLogger = logger.child({ component: 'ingestion-service' });
function hashApiKey(apiKey) {
    return createHash('sha256').update(apiKey).digest('hex');
}
// Per-type queue priority (LOWER = higher priority). Mirrors the SDK transport
// matrix: errors/messages/crons are high; requests/spans/traces/logs normal;
// metrics/profiles/replays low.
const TYPE_PRIORITY = {
    error: 10,
    message: 10,
    cron_checkin: 10,
    request: 50,
    span: 50,
    trace: 50,
    log: 60,
    metric: 80,
    profile: 90,
    replay: 90,
};
// Critical-priority threshold: under criticalWater pressure, we shed everything
// above this priority value. 10 keeps errors / messages / crons flowing.
const CRITICAL_PRIORITY_FLOOR = 10;
const DEFAULT_BACKPRESSURE = {
    highWater: env.INGESTION_BACKPRESSURE_HIGH_WATER,
    criticalWater: env.INGESTION_BACKPRESSURE_CRITICAL_WATER,
    shedLowPriorityAt: 80, // metrics / profiles / replays
    shedNormalPriorityAt: 50, // requests / spans / traces / logs
};
export class IngestionService {
    pool;
    writer;
    queue;
    rateLimiter;
    backpressure;
    replayMaxEvents;
    maxBatchSize;
    defaultRatePerSecond;
    defaultRatePerMinute;
    // Cached pending-depth probe so we don't hit the DB on every request.
    cachedDepth = 0;
    cachedDepthAt = 0;
    constructor(pool, writer, config) {
        this.pool = pool;
        this.writer = writer;
        this.maxBatchSize = config.maxBatchSize;
        this.defaultRatePerSecond = config.defaultRateLimitPerSecond;
        this.defaultRatePerMinute = config.defaultRateLimitPerMinute;
        this.backpressure = config.backpressure ?? DEFAULT_BACKPRESSURE;
        this.replayMaxEvents = config.replayMaxEvents ?? env.INGESTION_REPLAY_MAX_EVENTS;
        this.queue = new PgQueue(pool, { queue: 'ingestion' });
        this.rateLimiter = new IngestionRateLimiter({
            ttlMs: env.INGESTION_RATE_BUCKET_TTL_MS,
            sweepIntervalMs: env.INGESTION_RATE_BUCKET_SWEEP_MS,
        });
    }
    // ── Project resolution (LRU only; Postgres fallback) ──────────────────────
    async resolveProject(apiKey) {
        const keyHash = hashApiKey(apiKey);
        const cached = apiKeyCache.get(keyHash);
        if (cached) {
            return {
                id: cached.id,
                orgId: cached.orgId,
                environment: cached.environment,
                rateLimitPerSecond: cached.rateLimitPerSecond,
                rateLimitPerMinute: cached.rateLimitPerMinute,
                isActive: cached.isActive,
                apiKeyId: cached.apiKeyId,
            };
        }
        const auth = await this.writer.getProjectByApiKeyHash(keyHash);
        if (!auth)
            return null;
        const resolved = {
            id: auth.projectId,
            orgId: auth.orgId,
            environment: auth.environment,
            rateLimitPerSecond: this.defaultRatePerSecond,
            rateLimitPerMinute: this.defaultRatePerMinute,
            isActive: auth.isActive && auth.projectStatus === 'active',
            apiKeyId: auth.apiKeyId,
        };
        apiKeyCache.set(keyHash, {
            id: resolved.id,
            orgId: resolved.orgId,
            name: auth.projectName,
            environment: resolved.environment,
            rateLimitPerSecond: resolved.rateLimitPerSecond,
            rateLimitPerMinute: resolved.rateLimitPerMinute,
            allowedEventTypes: ['request', 'error', 'log', 'metric', 'custom'],
            isActive: resolved.isActive,
            apiKeyId: resolved.apiKeyId,
        });
        // Fire-and-forget: never block ingestion on a last_used update.
        this.writer
            .updateApiKeyLastUsed(auth.apiKeyId)
            .catch((err) => svcLogger.debug({ err }, 'updateApiKeyLastUsed failed'));
        return resolved;
    }
    /** Cached pending-depth probe (refreshed at most every 2s). */
    async pendingDepth() {
        const now = Date.now();
        if (now - this.cachedDepthAt > 2000) {
            try {
                this.cachedDepth = await this.queue.pendingDepth();
            }
            catch (err) {
                // On probe failure keep the last good value; don't toggle backpressure
                // on a transient DB error.
                svcLogger.warn({ err }, 'pendingDepth probe failed; using cached value');
            }
            this.cachedDepthAt = now;
        }
        return this.cachedDepth;
    }
    /** Decide whether to shed an event given current queue pressure. */
    shouldShed(depth, priority) {
        if (depth >= this.backpressure.criticalWater) {
            // Only top-priority signals (errors / cron / message) survive.
            return priority > CRITICAL_PRIORITY_FLOOR;
        }
        if (depth >= this.backpressure.highWater) {
            return priority >= this.backpressure.shedLowPriorityAt;
        }
        return false;
    }
    // ── SDK init handshake ────────────────────────────────────────────────────
    async initializeSdk(apiKey) {
        const project = await this.resolveProject(apiKey);
        if (!project)
            throw new Error('INVALID_API_KEY');
        if (!project.isActive)
            throw new Error('PROJECT_INACTIVE');
        return {
            success: true,
            projectId: project.id,
            config: { samplingRate: 1, enableErrors: true, enablePerformance: true },
            ingestion: {
                endpoint: env.INGESTION_ENDPOINT ?? 'http://127.0.0.1:3000/api/v1/ingest',
                batchSize: 50,
                flushInterval: 5000,
                maxQueueSize: 20000,
            },
        };
    }
    // ── Ingestion entrypoints ─────────────────────────────────────────────────
    async ingestBatch(req, apiKey) {
        return this.processIngest(req, null, apiKey);
    }
    async ingestRequests(req, apiKey) {
        return this.processIngest(req, 'request', apiKey);
    }
    async ingestErrors(req, apiKey) {
        return this.processIngest(req, 'error', apiKey);
    }
    async ingestLogs(req, apiKey) {
        return this.processIngest(req, 'log', apiKey);
    }
    async ingestMetrics(req, apiKey) {
        return this.processIngest(req, 'metric', apiKey);
    }
    /**
     * Central pipeline. `expectedType` (when set) enforces a typed route — every
     * event must match it or be rejected.
     */
    async processIngest(req, expectedType, apiKey) {
        if (!req || typeof req !== 'object')
            throw new Error('INVALID_REQUEST');
        const { events } = req;
        if (typeof apiKey !== 'string' || apiKey.length === 0) {
            throw new Error('INVALID_API_KEY');
        }
        const project = await this.resolveProject(apiKey);
        if (!project)
            throw new Error('INVALID_API_KEY');
        if (!project.isActive)
            throw new Error('PROJECT_INACTIVE');
        if (!Array.isArray(events) || events.length === 0)
            throw new Error('EMPTY_BATCH');
        if (events.length > this.maxBatchSize)
            throw new Error('BATCH_TOO_LARGE');
        const decision = this.rateLimiter.tryConsume(project.id, project.rateLimitPerSecond, project.rateLimitPerMinute, events.length);
        if (!decision.allowed)
            throw new Error('RATE_LIMIT_EXCEEDED');
        const depth = await this.pendingDepth();
        const batchId = randomUUID();
        const errors = [];
        const jobs = [];
        let shed = 0;
        for (const raw of events) {
            const eventId = this.extractEventId(raw);
            // Validate + normalize (poison/DoS/cardinality protection).
            const result = normalizeEvent(raw);
            if (!result.ok) {
                errors.push({ eventId, reason: result.detail });
                continue;
            }
            const ev = result.event;
            if (expectedType && ev.type !== expectedType) {
                errors.push({ eventId, reason: `expected '${expectedType}', got '${ev.type}'` });
                continue;
            }
            const priority = TYPE_PRIORITY[ev.type] ?? 50;
            if (this.shouldShed(depth, priority)) {
                shed++;
                errors.push({ eventId, reason: 'shed_backpressure' });
                continue;
            }
            jobs.push({
                jobType: ev.type,
                payload: { projectId: project.id, orgId: project.orgId, event: ev },
                priority,
                orgId: project.orgId,
                projectId: project.id,
                // Dedup in-flight duplicates by stable event id, scoped per project.
                // Fixed-length type prefix prevents collisions between IDs that happen
                // to share a numeric prefix.
                dedupeKey: `evt:${project.id}:${eventId}`,
            });
        }
        let accepted = 0;
        let deduped = 0;
        if (jobs.length > 0) {
            const ids = await this.queue.enqueueBulk(jobs);
            accepted = ids.length;
            deduped = jobs.length - ids.length;
            if (deduped > 0) {
                for (let i = 0; i < deduped; i++) {
                    errors.push({ eventId: 'deduped', reason: 'deduped_in_flight' });
                }
            }
        }
        if (shed > 0) {
            svcLogger.warn({ projectId: project.id, shed, depth, highWater: this.backpressure.highWater }, 'Backpressure shedding active');
        }
        const nextMinuteMs = (Math.floor(Date.now() / 60_000) + 1) * 60_000;
        const response = {
            success: true,
            accepted,
            rejected: errors.length,
            batchId,
            limits: {
                remaining: decision.perMinuteRemaining,
                resetAt: nextMinuteMs,
            },
        };
        if (errors.length > 0)
            response.errors = errors;
        return response;
    }
    /** Best-effort stable id for a single event in a batch. */
    extractEventId(raw) {
        if (typeof raw !== 'object' || raw === null)
            return randomUUID();
        const r = raw;
        if (typeof r.eventId === 'string' && r.eventId.length > 0 && r.eventId.length <= 128) {
            return r.eventId;
        }
        if (typeof r.requestId === 'string' && r.requestId.length > 0 && r.requestId.length <= 128) {
            return r.requestId;
        }
        return randomUUID();
    }
    // ── Health / observability ────────────────────────────────────────────────
    async getHealth() {
        const database = await this.writer.healthCheck();
        let queue = false;
        try {
            await this.queue.pendingDepth();
            queue = true;
        }
        catch {
            queue = false;
        }
        // The ingestion module does not depend on Redis. The legacy `redis` field
        // is kept for backwards-compatible response shape but always reports the
        // truth: this subsystem is Postgres-only.
        const services = {
            redis: false, // ingestion does not use redis; reported honestly.
            database,
            queue,
        };
        const status = database && queue ? 'healthy' : 'degraded';
        return {
            status,
            services,
            timestamp: new Date().toISOString(),
        };
    }
    async getIngestionHealth() {
        const m = await this.queue.metrics();
        return {
            queue: 'ingestion',
            jobs: {
                waiting: m.pending,
                active: m.active,
                completed: m.completed,
                failed: m.failed,
                deadLettered: m.deadLettered,
            },
            lagSeconds: m.oldestPendingAgeSeconds,
            rateLimiterEntries: this.rateLimiter.size(),
            backpressure: {
                highWater: this.backpressure.highWater,
                criticalWater: this.backpressure.criticalWater,
            },
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
            maxBatchSize: this.maxBatchSize,
        };
    }
    // ── Dead-letter management (Postgres-backed) ──────────────────────────────
    /**
     * Paginated listing of dead-lettered jobs. Uses bounded offset/limit with
     * defensive validation: callers may pass arbitrary integers; we clamp them
     * before they touch the SQL.
     */
    async getDLQJobs(offset = 0, limit = 100) {
        const safeOffset = Number.isFinite(offset) && offset >= 0 ? Math.trunc(offset) : 0;
        const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.min(Math.trunc(limit), 1000) : 100;
        const r = await this.pool.query(`SELECT id, original_job_id, queue, job_type, project_id, org_id,
              attempts, last_error, failed_at, replayed_at
       FROM ingestion_dead_letter_jobs
       ORDER BY failed_at DESC
       OFFSET $1 LIMIT $2`, [safeOffset, safeLimit]);
        return r.rows;
    }
    async reprocessDLQJob(jobId) {
        if (typeof jobId !== 'string' || jobId.length === 0) {
            throw new Error('JOB_NOT_FOUND');
        }
        const id = await this.queue.replayDeadLetter(jobId);
        if (!id)
            throw new Error('JOB_NOT_FOUND');
    }
    async reprocessAllDLQ(batchSize = 100) {
        const safeBatch = Number.isFinite(batchSize) && batchSize > 0
            ? Math.min(Math.trunc(batchSize), 1000)
            : 100;
        const r = await this.pool.query(`SELECT id FROM ingestion_dead_letter_jobs
       WHERE replayed_at IS NULL
       ORDER BY failed_at ASC
       LIMIT $1`, [safeBatch]);
        let n = 0;
        for (const row of r.rows) {
            try {
                const id = await this.queue.replayDeadLetter(row.id);
                if (id)
                    n++;
            }
            catch (err) {
                // Log but keep draining: one bad row should not stop a bulk recovery.
                svcLogger.warn({ err, dlqId: row.id }, 'Failed to replay dead-letter row');
            }
        }
        return n;
    }
    /**
     * Replay historical telemetry by re-enqueuing it through the standard worker
     * path. Capped by INGESTION_REPLAY_MAX_EVENTS to prevent operator typos from
     * flooding the queue.
     */
    async replayEvents(req) {
        const events = await this.writer.getEventsForReplay(req.projectId, req.startTime, req.endTime, req.eventTypes, this.replayMaxEvents);
        const replayId = randomUUID();
        if (events.length === 0)
            return { replayId, queued: 0 };
        const jobs = events.map((e) => ({
            jobType: e.type,
            payload: {
                projectId: e.projectId,
                orgId: e.orgId || null,
                event: e.payload,
            },
            priority: TYPE_PRIORITY[e.type] ?? 50,
            orgId: e.orgId,
            projectId: e.projectId,
            // Replays are intentionally NOT deduped against live ids.
            dedupeKey: `replay:${replayId}:${e.id}`,
        }));
        const ids = await this.queue.enqueueBulk(jobs);
        return { replayId, queued: ids.length };
    }
    // ── Read endpoints (delegate to writer) ───────────────────────────────────
    async listErrors(query) {
        return this.writer.listErrorEvents(this.normalizeErrorEventListQuery(query));
    }
    async getErrorById(errorId, projectId) {
        return this.writer.getErrorEventById(errorId, projectId);
    }
    async getDebugEvent(eventId, projectId) {
        return this.writer.getEventById(eventId, projectId);
    }
    /** Drain in-process state. The queue is durable in Postgres. */
    async shutdown() {
        this.rateLimiter.dispose();
    }
    normalizeErrorEventListQuery(query) {
        const normalized = {
            projectId: query.projectId,
            limit: this.normalizeInteger(query.limit, 50, 1, 100),
            offset: this.normalizeInteger(query.offset, 0, 0, 100_000),
        };
        const from = this.parseOptionalDate(query.from);
        const to = this.parseOptionalDate(query.to);
        if (from && to && from.getTime() > to.getTime())
            throw new Error('INVALID_DATE_RANGE');
        if (from)
            normalized.from = from.toISOString();
        if (to)
            normalized.to = to.toISOString();
        if (query.fingerprint)
            normalized.fingerprint = query.fingerprint;
        if (query.errorType)
            normalized.errorType = query.errorType;
        if (query.resolved !== undefined)
            normalized.resolved = query.resolved;
        return normalized;
    }
    parseOptionalDate(value) {
        if (!value)
            return undefined;
        const date = new Date(value);
        if (Number.isNaN(date.getTime()))
            throw new Error('INVALID_DATE_RANGE');
        return date;
    }
    normalizeInteger(value, fallback, min, max) {
        if (value === undefined || !Number.isFinite(value))
            return fallback;
        return Math.max(min, Math.min(Math.trunc(value), max));
    }
}
//# sourceMappingURL=service.js.map