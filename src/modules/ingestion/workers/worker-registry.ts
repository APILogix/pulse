/**
 * WorkerRegistry — one dedicated PGMQ worker per SDK event type.
 *
 * For EACH SdkEventType it registers a `PgmqWorker` so pipelines scale,
 * retry and dead-letter independently. It also owns:
 *
 *   - TENANT FAIRNESS gate (per process): a Map<orgId, inFlight> budgets how
 *     many jobs one tenant may process concurrently (TENANT_INFLIGHT_LIMIT[planTier]).
 *     Over-budget jobs are deferred by re-sending to pgmq with an aged delay.
 *   - DLQ intake worker: persists dead-lettered jobs into `ingestion_dead_letter_jobs`.
 *   - UsageRollup singleton cron and the MetricsServer.
 */
import { createHash } from 'crypto';
import type { Pool } from 'pg';
import type { Logger } from 'pino';
import { env } from '../../../config/env.js';
import { pgmq, type PgmqMessage } from '../../../lib/pgmq.js';
import { PgmqWorker } from '../../../lib/pgmq-worker.js';
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
import {
  INGESTION_JOB_ABORTED,
  throwIfIngestionAborted,
} from '../pipeline/ingestion-abort.js';
import { EventProcessor, stableStringify } from './event-processor.js';
import { UsageRollup } from './usage-rollup.js';
import { MetricsServer, WorkerMetrics } from './metrics-server.js';

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
  if (code === INGESTION_JOB_ABORTED) return 'job_aborted';
  if (code === '55P03') return 'db_lock_timeout';
  if (code === '57014') return 'db_statement_timeout';
  if (code === '25P03') return 'db_idle_transaction_timeout';
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
  if (message.includes('idle-in-transaction timeout') || message.includes('idle_in_transaction_session_timeout')) {
    return 'db_idle_transaction_timeout';
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

  /** Active PGMQ Workers */
  private readonly workers: PgmqWorker[] = [];
  private started = false;
  private startPromise: Promise<void> | null = null;

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
    if (!this.startPromise) {
      this.startPromise = this.startInternal().finally(() => {
        this.startPromise = null;
      });
    }
    await this.startPromise;
  }

  private async startInternal(): Promise<void> {
    let rollupStartAttempted = false;
    let processorStarted = false;
    let metricsServerStarted = false;

    try {
      await provisionIngestQueues();

      // 1) One PGMQ worker per SDK event type (registered in parallel)
      await Promise.all(
        SDK_EVENT_TYPES.map(async (type) => {
          const queue = INGEST_QUEUES[type];
          this.metrics.setWorkerCapacity(
            queue,
            type,
            env.INGESTION_TYPE_WORKER_CONCURRENCY * env.INGESTION_TYPE_WORKER_BATCH_SIZE,
          );

          const worker = new PgmqWorker(
            pgmq,
            async (msg: PgmqMessage<IngestJobPayload>, signal?: AbortSignal) => {
              await this.handleSingleIngestJob(queue, type, msg, signal);
            },
            {
              queue,
              batchSize: env.INGESTION_TYPE_WORKER_BATCH_SIZE,
              concurrency: env.INGESTION_TYPE_WORKER_CONCURRENCY,
              visibilityTimeoutSeconds: env.INGESTION_JOB_EXPIRE_SECONDS,
              maxAttempts: env.INGESTION_JOB_RETRY_LIMIT,
              deadLetterQueue: INGEST_DLQ_INTAKE_QUEUE,
              logger: this.log.child({ component: 'ingestion-worker', queue, eventType: type }),
              onJobFailure: (job, err) => {
                const payload = job.message as Partial<IngestJobPayload> | undefined;
                this.metrics.recordFailed(
                  queue,
                  Array.isArray(payload?.events) ? payload.events.length : 0,
                  type,
                  failureReason(err),
                );
              },
            },
          );

          await worker.start();
          this.workers.push(worker);
        }),
      );

      // 2) DLQ intake worker — persists dead-lettered messages
      const dlqWorker = new PgmqWorker(
        pgmq,
        async (msg: PgmqMessage<unknown>) => {
          await this.persistDeadLetter(msg);
          this.metrics.recordDlqIntake();
        },
        {
          queue: INGEST_DLQ_INTAKE_QUEUE,
          batchSize: 10,
          concurrency: 2,
          visibilityTimeoutSeconds: 60,
          logger: this.log.child({ component: 'dlq-worker', queue: INGEST_DLQ_INTAKE_QUEUE }),
        },
      );
      await dlqWorker.start();
      this.workers.push(dlqWorker);

      // 3) Usage rollup & metrics
      rollupStartAttempted = true;
      await this.rollup.start();
      this.processor.start();
      processorStarted = true;
      this.metricsServer.start();
      metricsServerStarted = true;
      this.started = true;

      this.log.info(
        {
          queues: ALL_INGEST_QUEUES.length,
          typeConcurrency: env.INGESTION_TYPE_WORKER_CONCURRENCY,
          typeBatchSize: env.INGESTION_TYPE_WORKER_BATCH_SIZE,
          fairnessMaxDefers: env.INGESTION_FAIRNESS_MAX_DEFERS,
          metricsPort: env.INGESTION_WORKER_METRICS_PORT,
        },
        'WorkerRegistry started with Supabase PGMQ workers',
      );
    } catch (err) {
      this.started = false;
      await this.stop();
      if (metricsServerStarted) await this.metricsServer.stop().catch(() => {});
      if (processorStarted) await this.processor.stop().catch(() => {});
      if (rollupStartAttempted) await this.rollup.stop().catch(() => {});
      throw err;
    }
  }

  /** Stop every PGMQ worker and drain running services. */
  async stop(): Promise<void> {
    if (this.startPromise) await this.startPromise.catch(() => undefined);
    const drainServices = this.started;
    this.started = false;

    await Promise.resolve(this.rollup.stop()).catch((err) => this.log.warn({ err }, 'usage rollup stop failed'));

    // Drain all PGMQ workers
    await Promise.all(this.workers.map((w) => w.stop().catch((err) => this.log.warn({ err }, 'worker stop failed'))));
    this.workers.length = 0;

    if (drainServices) {
      await Promise.resolve(this.processor.stop()).catch((err) => this.log.warn({ err }, 'usage counter drain failed'));
      await Promise.resolve(this.metricsServer.stop()).catch((err) => this.log.warn({ err }, 'metrics server stop failed'));
      this.log.info('WorkerRegistry stopped');
    }
  }

  // ── Single job execution + fairness gate ───────────────────────────────────

  private async handleSingleIngestJob(
    queue: string,
    type: SdkEventType,
    msg: PgmqMessage<IngestJobPayload>,
    signal?: AbortSignal,
  ): Promise<void> {
    const pickedAt = Date.now();
    if (msg.readCt > 1) {
      this.metrics.recordRetry(queue, 1);
    }
    if (msg.enqueuedAt) {
      this.metrics.recordStage('worker_wait', type, Math.max(0, pickedAt - msg.enqueuedAt.getTime()));
    }

    const payload = msg.message;
    await this.runOne(queue, type, payload, signal);
  }

  private async runOne(
    queue: string,
    type: SdkEventType,
    payload: IngestJobPayload,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    throwIfIngestionAborted(signal, 'worker dispatch');
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
        throwIfIngestionAborted(signal, 'fairness defer');
        const copy: IngestJobPayload = {
          ...payload,
          metadata: { ...payload.metadata, deferCount: deferCount + 1 },
        };

        // Re-enqueue with delay
        await pgmq.send(queue, copy, {
          delaySeconds: env.INGESTION_FAIRNESS_DEFER_DELAY_SECONDS,
        });

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

      throwIfIngestionAborted(signal, 'tenant admission');
      this.inFlight.set(orgId, current + 1);
      this.metrics.setOrgInFlight(orgId, current + 1);
      try {
        await this.processor.process(payload, queue, signal);
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

  private async persistDeadLetter(job: PgmqMessage<unknown>): Promise<void> {
    const data = job.message as Record<string, unknown> | null;
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
      originalJobId: asUuid(job.msgId),
      queue,
      jobType: type ?? 'unknown',
      orgId: p.organizationId,
      projectId: p.projectId,
      payload: data,
      attempts: Math.min(job.readCt ?? env.INGESTION_JOB_RETRY_LIMIT, 32767),
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
}
