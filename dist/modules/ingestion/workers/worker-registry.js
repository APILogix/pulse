/**
 * WorkerRegistry — one dedicated pg-boss worker pool per SDK event type.
 *
 * Replaces the old general/specialized PgQueue pools. For EACH SdkEventType it
 * registers `pgboss.work(INGEST_QUEUES[type], { localConcurrency, batchSize,
 * perJobResults: true })` so pipelines scale, retry and dead-letter
 * independently. It also owns:
 *
 *   - TENANT FAIRNESS gate (per process): a Map<orgId, inFlight> budgets how
 *     many jobs one tenant may process concurrently
 *     (TENANT_INFLIGHT_LIMIT[planTier]). Over-budget jobs are deferred — a
 *     copy of the payload is re-enqueued with metadata.deferCount+1, a small
 *     delay and an aged priority boost (FAIRNESS_AGE_BOOST) — and the original
 *     completes WITHOUT processing (the copy carries it; nothing is lost).
 *     Once deferCount hits INGESTION_FAIRNESS_MAX_DEFERS the job is processed
 *     anyway (aging/starvation guard). The slot is released in `finally`.
 *   - DLQ intake worker: persists dead-lettered jobs into
 *     ingestion_dead_letter_jobs. Handles BOTH payload shapes: DlqIntakePayload
 *     (validation rejects routed by the EventProcessor — detected by the
 *     `sourceQueue` field) and the raw IngestJobPayload that pg-boss delivers
 *     after retries/expiry are exhausted (pg-boss keeps the original job id).
 *   - UsageRollup singleton cron (billing counters) and the MetricsServer.
 *
 * v12 array-handler semantics: handlers receive an ARRAY of jobs. We process
 * jobs concurrently with Promise.all over per-job wrappers and resolve a
 * perJobResults JobResult[] so pg-boss settles each job INDIVIDUALLY — one
 * poisoned job never drags its batchmates into retry. If EVERY job in the
 * batch failed we throw the first error instead (identical outcome: the whole
 * batch is retried).
 */
import { createHash } from 'crypto';
import { env } from '../../../config/env.js';
import { pgboss } from '../../../lib/pgboss.js';
import { ALL_INGEST_QUEUES, INGEST_DLQ_INTAKE_QUEUE, INGEST_QUEUES, TENANT_INFLIGHT_LIMIT, ingestQueueFor, jobPriority, normalizePlanTier, provisionIngestQueues, } from '../queue/ingest-queues.js';
import { SDK_EVENT_TYPES } from '../pipeline/event-normalizer.js';
import { EventProcessor, stableStringify } from './event-processor.js';
import { UsageRollup } from './usage-rollup.js';
import { MetricsServer, WorkerMetrics } from './metrics-server.js';
/** v12 handlers always receive an array; tolerate a bare job defensively. */
function normalizeJobs(arg) {
    if (Array.isArray(arg))
        return arg;
    return arg ? [arg] : [];
}
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function asUuid(v) {
    return typeof v === 'string' && UUID_RE.test(v) ? v : null;
}
function errMsg(err) {
    return err instanceof Error ? err.message : String(err);
}
export class WorkerRegistry {
    pool;
    log;
    metrics = new WorkerMetrics();
    processor;
    rollup;
    metricsServer;
    /** Tenant fairness: per-org in-flight job count for THIS process. */
    inFlight = new Map();
    registeredQueues = [];
    started = false;
    constructor(pool, log) {
        this.pool = pool;
        this.log = log;
        this.processor = new EventProcessor(pool, this.metrics, log.child({ component: 'event-processor' }));
        this.rollup = new UsageRollup(pool, this.metrics, log.child({ component: 'usage-rollup' }));
        this.metricsServer = new MetricsServer(this.metrics, pool, log.child({ component: 'metrics-server' }));
    }
    /** Provision queues, then register every worker + cron + metrics. */
    async start() {
        if (this.started)
            return;
        this.started = true;
        await provisionIngestQueues();
        // 1) One worker pool per event type.
        for (const type of SDK_EVENT_TYPES) {
            const queue = INGEST_QUEUES[type];
            await pgboss.work(queue, {
                localConcurrency: env.INGESTION_TYPE_WORKER_CONCURRENCY,
                batchSize: env.INGESTION_TYPE_WORKER_BATCH_SIZE,
                perJobResults: true,
            }, ((jobs) => this.handleIngestBatch(queue, type, jobs)));
            this.registeredQueues.push(queue);
        }
        // 2) DLQ intake — persists exhausted/rejected jobs for ops replay.
        await pgboss.work(INGEST_DLQ_INTAKE_QUEUE, { localConcurrency: 2, batchSize: 10, perJobResults: true, includeMetadata: true }, ((jobs) => this.handleDlqBatch(jobs)));
        this.registeredQueues.push(INGEST_DLQ_INTAKE_QUEUE);
        // 3) Singleton usage-rollup cron + 4) metrics collectors.
        await this.rollup.start();
        this.processor.start();
        this.metricsServer.start();
        this.log.info({
            queues: ALL_INGEST_QUEUES.length,
            typeConcurrency: env.INGESTION_TYPE_WORKER_CONCURRENCY,
            typeBatchSize: env.INGESTION_TYPE_WORKER_BATCH_SIZE,
            fairnessMaxDefers: env.INGESTION_FAIRNESS_MAX_DEFERS,
            metricsPort: env.INGESTION_WORKER_METRICS_PORT,
        }, 'WorkerRegistry started');
    }
    /** offWork every queue (waiting for in-flight jobs), then drain the rest. */
    async stop() {
        if (!this.started)
            return;
        this.started = false;
        await this.rollup.stop();
        for (const queue of this.registeredQueues) {
            await pgboss
                .offWork(queue, { wait: true })
                .catch((err) => this.log.warn({ err, queue }, 'offWork failed during stop'));
        }
        await this.processor.stop().catch((err) => this.log.warn({ err }, 'usage counter drain failed'));
        await this.metricsServer.stop().catch((err) => this.log.warn({ err }, 'metrics server stop failed'));
        this.log.info('WorkerRegistry stopped');
    }
    // ── Per-type ingest batch handler ─────────────────────────────────────────
    async handleIngestBatch(queue, type, arg) {
        const jobs = normalizeJobs(arg);
        const outcomes = await Promise.all(jobs.map(async (job) => {
            try {
                const output = await this.runOne(queue, type, job.data);
                return { id: job.id, status: 'completed', output };
            }
            catch (err) {
                const payload = job.data;
                this.metrics.recordFailed(queue, Array.isArray(payload?.events) ? payload.events.length : 0);
                this.log.error({ err, queue, jobId: job.id }, 'ingest job failed');
                return { id: job.id, status: 'failed', output: errMsg(err) };
            }
        }));
        return this.settle(queue, outcomes);
    }
    /**
     * Per-job wrapper: fairness gate → process. Deferred jobs resolve
     * 'completed' (the re-enqueued copy carries the work); admitted jobs release
     * their in-flight slot in `finally`.
     */
    async runOne(queue, type, payload) {
        const orgId = typeof payload?.organizationId === 'string' && payload.organizationId.length > 0
            ? payload.organizationId
            : 'unknown';
        const meta = payload?.metadata;
        const planTier = normalizePlanTier(meta?.planTier);
        const deferCount = typeof meta?.deferCount === 'number' ? meta.deferCount : 0;
        const limit = TENANT_INFLIGHT_LIMIT[planTier];
        const current = this.inFlight.get(orgId) ?? 0;
        if (current >= limit && deferCount < env.INGESTION_FAIRNESS_MAX_DEFERS) {
            // Re-enqueue a copy with an aged priority boost, then complete the
            // original — if the send throws, the original FAILS and retries, so the
            // events are never lost.
            const copy = {
                ...payload,
                metadata: { ...payload.metadata, deferCount: deferCount + 1 },
            };
            await pgboss.send(queue, copy, {
                startAfter: env.INGESTION_FAIRNESS_DEFER_DELAY_SECONDS,
                priority: jobPriority(planTier, type, deferCount + 1),
            });
            this.metrics.recordDeferred(queue, Array.isArray(payload?.events) ? payload.events.length : 0);
            return { deferred: true, deferCount: deferCount + 1 };
        }
        this.inFlight.set(orgId, current + 1);
        this.metrics.setOrgInFlight(orgId, current + 1);
        try {
            await this.processor.process(payload, queue);
            this.metrics.recordFairnessProcessed();
            return { deferred: false, deferCount };
        }
        finally {
            const next = (this.inFlight.get(orgId) ?? 1) - 1;
            if (next <= 0)
                this.inFlight.delete(orgId);
            else
                this.inFlight.set(orgId, next);
            this.metrics.setOrgInFlight(orgId, next);
        }
    }
    // ── DLQ intake ────────────────────────────────────────────────────────────
    async handleDlqBatch(arg) {
        const jobs = normalizeJobs(arg);
        const outcomes = await Promise.all(jobs.map(async (job) => {
            try {
                await this.persistDeadLetter(job);
                this.metrics.recordDlqIntake();
                return { id: job.id, status: 'completed' };
            }
            catch (err) {
                this.log.error({ err, jobId: job.id }, 'DLQ intake persist failed');
                return { id: job.id, status: 'failed', output: errMsg(err) };
            }
        }));
        return this.settle(INGEST_DLQ_INTAKE_QUEUE, outcomes);
    }
    /**
     * Both dead-letter shapes land here:
     *   - DlqIntakePayload (has `sourceQueue`): validation rejects routed by the
     *     EventProcessor. The intake job is freshly sent, so the original
     *     ingest-job id is unknown (original_job_id = null).
     *   - Raw IngestJobPayload: pg-boss redelivers the original job (same job
     *     id) after retries/expiry are exhausted → original_job_id = job.id.
     */
    async persistDeadLetter(job) {
        const data = job.data;
        if (data != null && typeof data === 'object' && 'sourceQueue' in data) {
            const d = data;
            await this.insertDeadLetter({
                originalJobId: null,
                queue: typeof d.sourceQueue === 'string' ? d.sourceQueue : 'unknown',
                jobType: typeof d.eventType === 'string' ? d.eventType : 'unknown',
                orgId: d.organizationId,
                projectId: d.projectId,
                payload: d.payload ?? null,
                attempts: 1,
                lastError: typeof d.error === 'string' ? d.error : 'validation failed',
                errorCode: 'validation_failed',
                failedAt: d.failedAt,
            });
            return;
        }
        const p = (data ?? {});
        const type = typeof p.eventType === 'string' ? p.eventType : undefined;
        const queue = type && INGEST_QUEUES[type] ? ingestQueueFor(type) : 'unknown';
        await this.insertDeadLetter({
            originalJobId: asUuid(job.id),
            queue,
            jobType: type ?? 'unknown',
            orgId: p.organizationId,
            projectId: p.projectId,
            payload: data,
            attempts: Math.min(job.retryCount ?? env.INGESTION_JOB_RETRY_LIMIT, 32767),
            lastError: 'job exhausted retries or expired before completion',
            errorCode: 'retries_exhausted',
            failedAt: new Date().toISOString(),
        });
    }
    async insertDeadLetter(row) {
        const dedupeKey = createHash('sha256')
            .update(`${row.queue}|${String(row.orgId ?? '')}|${String(row.projectId ?? '')}|${stableStringify(row.payload)}`)
            .digest('hex')
            .slice(0, 128);
        await this.pool.query(`INSERT INTO ingestion_dead_letter_jobs
         (original_job_id, queue, job_type, org_id, project_id, payload,
          dedupe_key, attempts, last_error, error_code, failed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
               COALESCE($11::timestamptz, NOW()))`, [
            asUuid(row.originalJobId),
            String(row.queue).slice(0, 64),
            String(row.jobType).slice(0, 64),
            asUuid(row.orgId),
            asUuid(row.projectId),
            JSON.stringify(row.payload ?? null),
            dedupeKey,
            Math.max(0, Math.min(row.attempts, 32767)),
            String(row.lastError).slice(0, 4000),
            row.errorCode.slice(0, 64),
            typeof row.failedAt === 'string' ? row.failedAt : null,
        ]);
    }
    // ── Shared settle logic ───────────────────────────────────────────────────
    /**
     * Per-job isolation: resolve a JobResult[] so pg-boss settles each job
     * individually (failed jobs are retried, completed ones are not). When EVERY
     * job in the batch failed, throw the first error instead — the outcome is
     * identical (whole batch retried) and matches the plain-throw idiom used by
     * the other pg-boss processors.
     */
    settle(queue, outcomes) {
        const failed = outcomes.filter((o) => o.status === 'failed');
        if (outcomes.length > 0 && failed.length === outcomes.length) {
            throw new Error(`all ${outcomes.length} job(s) in batch on ${queue} failed; first: ${String(failed[0]?.output)}`);
        }
        if (failed.length > 0) {
            this.log.warn({ queue, failed: failed.length, total: outcomes.length }, 'partial batch failure — failed jobs will be retried individually');
        }
        return outcomes;
    }
}
//# sourceMappingURL=worker-registry.js.map