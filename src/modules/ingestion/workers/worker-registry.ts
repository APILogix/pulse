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
import type { Pool } from 'pg';
import type { Logger } from 'pino';
import { env } from '../../../config/env.js';
import { pgboss } from '../../../lib/pgboss.js';
import {
  ALL_INGEST_QUEUES,
  INGEST_DLQ_INTAKE_QUEUE,
  INGEST_QUEUES,
  TENANT_INFLIGHT_LIMIT,
  ingestQueueFor,
  jobPriority,
  normalizePlanTier,
  provisionIngestQueues,
  type DlqIntakePayload,
  type IngestJobPayload,
} from '../queue/ingest-queues.js';
import { SDK_EVENT_TYPES, type SdkEventType } from '../pipeline/event-normalizer.js';
import { EventProcessor, stableStringify } from './event-processor.js';
import { UsageRollup } from './usage-rollup.js';
import { MetricsServer, WorkerMetrics } from './metrics-server.js';

/** pg-boss v12 perJobResults outcome (subset of JobResult we produce). */
interface JobOutcome {
  id: string;
  status: 'completed' | 'failed';
  output?: unknown;
}

/** Shape of a delivered job (metadata included where includeMetadata is set). */
interface DeliveredJob {
  id: string;
  data: unknown;
  retryCount?: number;
  createdOn?: Date | string | number;
  startAfter?: Date | string | number;
  startedOn?: Date | string | number;
}

/** v12 handlers always receive an array; tolerate a bare job defensively. */
function normalizeJobs(arg: unknown): DeliveredJob[] {
  if (Array.isArray(arg)) return arg as DeliveredJob[];
  return arg ? [arg as DeliveredJob] : [];
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function asUuid(v: unknown): string | null {
  return typeof v === 'string' && UUID_RE.test(v) ? v : null;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function errorCode(err: unknown): string | null {
  if (!err || typeof err !== 'object') return null;
  const value = (err as { code?: unknown }).code;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function failureReason(err: unknown): string {
  const code = errorCode(err);
  if (code === '55P03') return 'db_lock_timeout';
  if (code === '57014') return 'db_statement_timeout';
  if (code === '53300' || code === '08000' || code === '08003' || code === '08006') return 'db_connection';
  if (code && code.startsWith('23')) return 'idempotency';

  const message = errMsg(err).toLowerCase();
  if (message.includes('invalid') || message.includes('validation') || message.includes('no_persistable_events')) {
    return 'validation';
  }
  if (message.includes('lock timeout') || message.includes('canceling statement due to lock timeout')) {
    return 'db_lock_timeout';
  }
  if (message.includes('statement timeout') || message.includes('canceling statement due to statement timeout')) {
    return 'db_statement_timeout';
  }
  if (message.includes('timeout') || message.includes('connection') || message.includes('econn') || message.includes('terminating connection')) {
    return 'db_connection';
  }
  if (message.includes('duplicate') || message.includes('conflict')) {
    return 'idempotency';
  }
  if (message.includes('quota') || message.includes('rate_limit')) {
    return 'admission_control';
  }
  if (message.includes('dlq') || message.includes('dead-letter')) {
    return 'dead_letter';
  }
  return 'unknown';
}

function timestampMs(v: unknown): number | null {
  if (v instanceof Date) {
    const n = v.getTime();
    return Number.isFinite(n) ? n : null;
  }
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.length > 0) {
    const n = Date.parse(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

interface DeadLetterRow {
  originalJobId: string | null;
  queue: string;
  jobType: string;
  orgId: unknown;
  projectId: unknown;
  payload: unknown;
  attempts: number;
  lastError: string;
  errorCode: string;
  failedAt: unknown;
}

export class WorkerRegistry {
  private readonly metrics = new WorkerMetrics();
  private readonly processor: EventProcessor;
  private readonly rollup: UsageRollup;
  private readonly metricsServer: MetricsServer;

  /** Tenant fairness: per-org in-flight job count for THIS process. */
  private readonly inFlight = new Map<string, number>();
  private readonly workerInFlight = new Map<string, number>();
  private readonly registeredQueues: string[] = [];
  private started = false;

  constructor(
    private readonly pool: Pool,
    private readonly log: Logger,
    telemetryPool: Pool = pool,
  ) {
    this.processor = new EventProcessor(
      telemetryPool,
      this.metrics,
      log.child({ component: 'event-processor' }),
      pool,
    );
    this.rollup = new UsageRollup(pool, this.metrics, log.child({ component: 'usage-rollup' }));
    this.metricsServer = new MetricsServer(
      this.metrics,
      pool,
      log.child({ component: 'metrics-server' }),
      [
        { name: 'primary', pool },
        { name: 'telemetry', pool: telemetryPool },
      ],
    );
  }

  /** Provision queues, then register every worker + cron + metrics. */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;

    await provisionIngestQueues();

    // 1) One worker pool per event type.
    for (const type of SDK_EVENT_TYPES) {
      const queue = INGEST_QUEUES[type];
      this.metrics.setWorkerCapacity(
        queue,
        type,
        env.INGESTION_TYPE_WORKER_CONCURRENCY * env.INGESTION_TYPE_WORKER_BATCH_SIZE,
      );
      await pgboss.work(
        queue,
        {
          localConcurrency: env.INGESTION_TYPE_WORKER_CONCURRENCY,
          batchSize: env.INGESTION_TYPE_WORKER_BATCH_SIZE,
          perJobResults: true,
          includeMetadata: true,
        } as never,
        ((jobs: unknown) => this.handleIngestBatch(queue, type, jobs)) as never,
      );
      this.registeredQueues.push(queue);
    }

    // 2) DLQ intake — persists exhausted/rejected jobs for ops replay.
    await pgboss.work(
      INGEST_DLQ_INTAKE_QUEUE,
      { localConcurrency: 2, batchSize: 10, perJobResults: true, includeMetadata: true } as never,
      ((jobs: unknown) => this.handleDlqBatch(jobs)) as never,
    );
    this.registeredQueues.push(INGEST_DLQ_INTAKE_QUEUE);

    // 3) Singleton usage-rollup cron + 4) metrics collectors.
    await this.rollup.start();
    this.processor.start();
    this.metricsServer.start();

    this.log.info(
      {
        queues: ALL_INGEST_QUEUES.length,
        typeConcurrency: env.INGESTION_TYPE_WORKER_CONCURRENCY,
        typeBatchSize: env.INGESTION_TYPE_WORKER_BATCH_SIZE,
        fairnessMaxDefers: env.INGESTION_FAIRNESS_MAX_DEFERS,
        metricsPort: env.INGESTION_WORKER_METRICS_PORT,
      },
      'WorkerRegistry started',
    );
  }

  /** offWork every queue (waiting for in-flight jobs), then drain the rest. */
  async stop(): Promise<void> {
    if (!this.started) return;
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

  private async handleIngestBatch(queue: string, type: SdkEventType, arg: unknown): Promise<JobOutcome[]> {
    const jobs = normalizeJobs(arg);
    const pickedAt = Date.now();
    const retriedJobs = jobs.filter((job) => (job.retryCount ?? 0) > 0).length;
    if (retriedJobs > 0) this.metrics.recordRetry(queue, retriedJobs);
    for (const job of jobs) {
      const createdOnMs = timestampMs(job.createdOn);
      if (createdOnMs != null) {
        this.metrics.recordStage('worker_wait', type, Math.max(0, pickedAt - createdOnMs));
      }
      const startAfterMs = timestampMs(job.startAfter);
      if (startAfterMs != null) {
        this.metrics.recordStage('worker_ready_wait', type, Math.max(0, pickedAt - startAfterMs));
      }
    }
    this.log.debug(
      {
        queue,
        eventType: type,
        jobs: jobs.length,
        events: jobs.reduce((count, job) => {
          const payload = job.data as Partial<IngestJobPayload> | undefined;
          return count + (Array.isArray(payload?.events) ? payload.events.length : 0);
        }, 0),
        jobIds: jobs.map((job) => job.id),
      },
      'ingestion worker picked jobs',
    );
    const outcomes = await Promise.all(
      jobs.map(async (job): Promise<JobOutcome> => {
        try {
          const output = await this.runOne(queue, type, job.data as IngestJobPayload);
          return { id: job.id, status: 'completed', output };
        } catch (err) {
          const payload = job.data as Partial<IngestJobPayload> | undefined;
          this.metrics.recordFailed(
            queue,
            Array.isArray(payload?.events) ? payload.events.length : 0,
            type,
            failureReason(err),
          );
          this.log.error({ err, queue, jobId: job.id }, 'ingest job failed');
          return { id: job.id, status: 'failed', output: errMsg(err) };
        }
      }),
    );
    return this.settle(queue, outcomes);
  }

  /**
   * Per-job wrapper: fairness gate → process. Deferred jobs resolve
   * 'completed' (the re-enqueued copy carries the work); admitted jobs release
   * their in-flight slot in `finally`.
   */
  private async runOne(queue: string, type: SdkEventType, payload: IngestJobPayload): Promise<Record<string, unknown>> {
    const workerKey = `${queue}|${type}`;
    const workerCount = (this.workerInFlight.get(workerKey) ?? 0) + 1;
    this.workerInFlight.set(workerKey, workerCount);
    this.metrics.setWorkerInFlight(queue, type, workerCount);
    const orgId = typeof payload?.organizationId === 'string' && payload.organizationId.length > 0
      ? payload.organizationId
      : 'unknown';
    const meta = payload?.metadata;
    const planTier = normalizePlanTier(meta?.planTier);
    const deferCount = typeof meta?.deferCount === 'number' ? meta.deferCount : 0;
    const limit = TENANT_INFLIGHT_LIMIT[planTier];
    const current = this.inFlight.get(orgId) ?? 0;
    const eventCount = Array.isArray(payload?.events) ? payload.events.length : 0;

    try {
      if (current >= limit && deferCount < env.INGESTION_FAIRNESS_MAX_DEFERS) {
        // Re-enqueue a copy with an aged priority boost, then complete the
        // original — if the send throws, the original FAILS and retries, so the
        // events are never lost.
        const copy: IngestJobPayload = {
          ...payload,
          metadata: { ...payload.metadata, deferCount: deferCount + 1 },
        };
        await pgboss.send(queue, copy, {
          startAfter: env.INGESTION_FAIRNESS_DEFER_DELAY_SECONDS,
          priority: jobPriority(planTier, type, deferCount + 1),
        } as never);
        this.metrics.recordDeferred(queue, eventCount);
        this.log.info(
          {
            queue,
            eventType: type,
            batchId: meta?.batchId,
            events: eventCount,
            deferCount: deferCount + 1,
            limit,
          },
          'ingestion worker deferred job for tenant fairness',
        );
        return { deferred: true, deferCount: deferCount + 1 };
      }
      if (current >= limit && deferCount >= env.INGESTION_FAIRNESS_MAX_DEFERS) {
        this.metrics.recordFairnessStarvationAdmission(queue, type);
        this.log.warn(
          {
            queue,
            eventType: type,
            batchId: meta?.batchId,
            events: eventCount,
            deferCount,
            limit,
          },
          'ingestion worker admitted job after fairness max defers',
        );
      }

      this.inFlight.set(orgId, current + 1);
      this.metrics.setOrgInFlight(orgId, current + 1);
      try {
        await this.processor.process(payload, queue);
        this.metrics.recordFairnessProcessed();
        return { deferred: false, deferCount };
      } finally {
        const next = (this.inFlight.get(orgId) ?? 1) - 1;
        if (next <= 0) this.inFlight.delete(orgId);
        else this.inFlight.set(orgId, next);
        this.metrics.setOrgInFlight(orgId, next);
      }
    } finally {
      const nextWorkerCount = (this.workerInFlight.get(workerKey) ?? 1) - 1;
      if (nextWorkerCount <= 0) this.workerInFlight.delete(workerKey);
      else this.workerInFlight.set(workerKey, nextWorkerCount);
      this.metrics.setWorkerInFlight(queue, type, nextWorkerCount);
    }
  }

  // ── DLQ intake ────────────────────────────────────────────────────────────

  private async handleDlqBatch(arg: unknown): Promise<JobOutcome[]> {
    const jobs = normalizeJobs(arg);
    const outcomes = await Promise.all(
      jobs.map(async (job): Promise<JobOutcome> => {
        try {
          await this.persistDeadLetter(job);
          this.metrics.recordDlqIntake();
          return { id: job.id, status: 'completed' };
        } catch (err) {
          this.log.error({ err, jobId: job.id }, 'DLQ intake persist failed');
          return { id: job.id, status: 'failed', output: errMsg(err) };
        }
      }),
    );
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
  private async persistDeadLetter(job: DeliveredJob): Promise<void> {
    const data = job.data as Record<string, unknown> | null;
    if (data != null && typeof data === 'object' && 'sourceQueue' in data) {
      const d = data as unknown as DlqIntakePayload;
      await this.insertDeadLetter({
        originalJobId: null,
        queue: typeof d.sourceQueue === 'string' ? d.sourceQueue : 'unknown',
        jobType: typeof d.eventType === 'string' ? d.eventType : 'unknown',
        orgId: d.organizationId,
        projectId: d.projectId,
        payload: d,
        attempts: 1,
        lastError: typeof d.error === 'string' ? d.error : 'validation failed',
        errorCode: 'validation_failed',
        failedAt: d.failedAt,
      });
      return;
    }

    const p = (data ?? {}) as Partial<IngestJobPayload>;
    const type = typeof p.eventType === 'string' ? (p.eventType as SdkEventType) : undefined;
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

  private async insertDeadLetter(row: DeadLetterRow): Promise<void> {
    const dedupeKey = createHash('sha256')
      .update(`${row.queue}|${String(row.orgId ?? '')}|${String(row.projectId ?? '')}|${stableStringify(row.payload)}`)
      .digest('hex')
      .slice(0, 128);
    await this.pool.query(
      `INSERT INTO ingestion_dead_letter_jobs
         (original_job_id, queue, job_type, org_id, project_id, payload,
          dedupe_key, attempts, last_error, error_code, failed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
               COALESCE($11::timestamptz, NOW()))`,
      [
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
      ],
    );
  }

  // ── Shared settle logic ───────────────────────────────────────────────────

  /**
   * Per-job isolation: resolve a JobResult[] so pg-boss settles each job
   * individually (failed jobs are retried, completed ones are not). When EVERY
   * job in the batch failed, throw the first error instead — the outcome is
   * identical (whole batch retried) and matches the plain-throw idiom used by
   * the other pg-boss processors.
   */
  private settle(queue: string, outcomes: JobOutcome[]): JobOutcome[] {
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
