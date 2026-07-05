/**
 * WorkerRegistry — constructs and supervises the ingestion worker tier.
 *
 * Four worker classes, isolated so a slow signal never starves a fast one:
 *
 *   1. GENERAL workers   — drain the fast path (error, message, request, span,
 *      metric, log, cron_checkin). Many workers, high concurrency, small
 *      visibility timeout. Re-validate the payload, route to the
 *      TelemetryWriter, and fire-and-forget a usage increment.
 *
 *   2. SPECIALIZED workers — isolate heavy signals (profile, replay, trace).
 *      Fewer workers, longer visibility timeout, smaller batches. They claim
 *      ONLY their job types so a 30s profile upload never blocks an error from
 *      being persisted. They use a dedicated PgQueue with a longer lease.
 *
 *   3. RETRY worker      — owns queue maintenance (no job claiming): recover
 *      expired leases, prune completed rows, flush usage counters, flush admin
 *      logs. Runs every INGESTION_RETRY_INTERVAL_MS.
 *
 *   4. MAINTENANCE worker — partition automation + retention for the telemetry
 *      tables (TelemetryMaintenanceWorker). Runs every 6h.
 *
 * The general/specialized workers also report rolling performance stats to the
 * TimescaleDB LogDatabase each retry cycle.
 *
 * SKIP LOCKED makes horizontal scaling safe: run multiple worker processes and
 * each job is still handed to exactly one worker.
 */
import type { Pool } from 'pg';
import type { Logger } from 'pino';
import { randomUUID } from 'crypto';

import { env } from '../../../config/env.js';
import {
  PgQueue,
  GENERAL_JOB_TYPES,
  SPECIALIZED_JOB_TYPES,
} from '../queue/pg-queue.js';
import { PgQueueWorker } from '../queue/pg-queue-worker.js';
import { TelemetryWriter } from '../pipeline/telemetry-writer.js';
import { createIngestionJobHandler } from '../pipeline/ingestion-job-handler.js';
import { UsageCounter } from '../usage/usage-counter.js';
import { LogDatabase } from '../logging/log-database.js';
import { AdminLogger } from '../logging/admin-logger.js';
import { TelemetryMaintenanceWorker } from '../../../workers/telemetry-maintenance.processor.js';
import { BackpressureGauge } from '../../../lib/gauge.js';

export interface WorkerRegistryOptions {
  /** Logical queue name. Default 'ingestion'. */
  queue?: string;
  generalWorkers?: number;
  generalConcurrency?: number;
  generalBatchSize?: number;
  specializedWorkers?: number;
  specializedConcurrency?: number;
  specializedBatchSize?: number;
  visibilityTimeoutMs?: number;
  specializedVisibilityTimeoutMs?: number;
  busyPollMs?: number;
  idlePollMs?: number;
  retryIntervalMs?: number;
  maintenanceIntervalMs?: number;
  completedRetentionMs?: number;
}

export class WorkerRegistry {
  private readonly queueName: string;
  private readonly generalQueue: PgQueue;
  private readonly specializedQueue: PgQueue;
  private readonly writer: TelemetryWriter;
  private readonly usage: UsageCounter;
  private readonly logDb: LogDatabase;
  private readonly adminLogger: AdminLogger;
  private readonly maintenance: TelemetryMaintenanceWorker;
  private readonly gauge: BackpressureGauge;

  private readonly generalPool: PgQueueWorker[] = [];
  private readonly specializedPool: PgQueueWorker[] = [];
  private gaugeBatchCounter = 0;
  private retryTimer: NodeJS.Timeout | null = null;
  private started = false;

  private readonly opts: Required<Omit<WorkerRegistryOptions, 'queue'>>;

  constructor(
    private readonly pool: Pool,
    private readonly log: Logger,
    options: WorkerRegistryOptions = {},
  ) {
    this.queueName = options.queue ?? 'ingestion';
    this.opts = {
      generalWorkers: options.generalWorkers ?? env.INGESTION_GENERAL_WORKERS,
      generalConcurrency: options.generalConcurrency ?? env.INGESTION_GENERAL_CONCURRENCY,
      generalBatchSize: options.generalBatchSize ?? env.INGESTION_GENERAL_BATCH_SIZE,
      specializedWorkers: options.specializedWorkers ?? env.INGESTION_SPECIALIZED_WORKERS,
      specializedConcurrency: options.specializedConcurrency ?? env.INGESTION_SPECIALIZED_CONCURRENCY,
      specializedBatchSize: options.specializedBatchSize ?? env.INGESTION_SPECIALIZED_BATCH_SIZE,
      visibilityTimeoutMs: options.visibilityTimeoutMs ?? env.INGESTION_VISIBILITY_TIMEOUT_MS,
      specializedVisibilityTimeoutMs:
        options.specializedVisibilityTimeoutMs ?? env.INGESTION_SPECIALIZED_VISIBILITY_TIMEOUT_MS,
      busyPollMs: options.busyPollMs ?? env.INGESTION_POLL_MS,
      idlePollMs: options.idlePollMs ?? env.INGESTION_IDLE_POLL_MS,
      retryIntervalMs: options.retryIntervalMs ?? env.INGESTION_RETRY_INTERVAL_MS,
      maintenanceIntervalMs: options.maintenanceIntervalMs ?? env.INGESTION_MAINTENANCE_INTERVAL_MS,
      completedRetentionMs: options.completedRetentionMs ?? env.INGESTION_COMPLETED_RETENTION_MS,
    };

    this.generalQueue = new PgQueue(this.pool, {
      queue: this.queueName,
      visibilityTimeoutMs: this.opts.visibilityTimeoutMs,
    });
    this.specializedQueue = new PgQueue(this.pool, {
      queue: this.queueName,
      visibilityTimeoutMs: this.opts.specializedVisibilityTimeoutMs,
    });

    this.writer = new TelemetryWriter(this.pool);
    this.logDb = new LogDatabase(this.log);
    this.gauge = new BackpressureGauge(this.pool);
    this.usage = new UsageCounter(this.pool, this.log, {
      flushIntervalMs: env.INGESTION_USAGE_FLUSH_MS,
      bufferLimit: env.INGESTION_USAGE_BUFFER_LIMIT,
    });
    this.adminLogger = new AdminLogger(this.pool, this.logDb, this.log, {
      bufferSize: env.INGESTION_ADMIN_LOG_BUFFER_SIZE,
      flushIntervalMs: env.INGESTION_ADMIN_LOG_FLUSH_MS,
    });
    this.maintenance = new TelemetryMaintenanceWorker(this.pool, this.log, {
      intervalMs: this.opts.maintenanceIntervalMs,
    });
  }

  /** Construct + start every worker class. */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;

    await this.logDb.initialize();
    this.usage.start();
    this.adminLogger.start();

    const handler = createIngestionJobHandler(this.writer, this.usage);

    // 1) GENERAL workers — fast path, shared handler, per-worker maintenance
    //    disabled (the retry worker owns it).
    for (let i = 0; i < this.opts.generalWorkers; i++) {
      const w = new PgQueueWorker(this.generalQueue, handler, this.log, {
        workerId: this.workerId('general', i),
        workerType: 'general',
        jobTypes: GENERAL_JOB_TYPES,
        batchSize: this.opts.generalBatchSize,
        handlerConcurrency: this.opts.generalConcurrency,
        busyPollMs: this.opts.busyPollMs,
        idlePollMs: this.opts.idlePollMs,
        enableMaintenance: false,
        onBatchComplete: ({ workerId }) => this.updateGauge(workerId),
      });
      w.start();
      this.generalPool.push(w);
    }

    // 2) SPECIALIZED workers — isolated heavy signals, longer lease.
    for (let i = 0; i < this.opts.specializedWorkers; i++) {
      const w = new PgQueueWorker(this.specializedQueue, handler, this.log, {
        workerId: this.workerId('specialized', i),
        workerType: 'specialized',
        jobTypes: SPECIALIZED_JOB_TYPES,
        batchSize: this.opts.specializedBatchSize,
        handlerConcurrency: this.opts.specializedConcurrency,
        busyPollMs: this.opts.busyPollMs,
        idlePollMs: this.opts.idlePollMs,
        enableMaintenance: false,
        onBatchComplete: ({ workerId }) => this.updateGauge(workerId),
      });
      w.start();
      this.specializedPool.push(w);
    }

    // 3) RETRY worker — maintenance loop (no claiming).
    this.retryTimer = setInterval(() => void this.retryCycle(), this.opts.retryIntervalMs);
    this.retryTimer.unref?.();

    // 4) MAINTENANCE worker — partition automation + retention.
    this.maintenance.start();

    this.adminLogger.info('worker.lifecycle', 'Ingestion worker tier started', {
      workerId: `registry-${process.pid}`,
      metadata: {
        generalWorkers: this.opts.generalWorkers,
        specializedWorkers: this.opts.specializedWorkers,
      },
    });

    this.log.info(
      {
        generalWorkers: this.opts.generalWorkers,
        generalConcurrency: this.opts.generalConcurrency,
        specializedWorkers: this.opts.specializedWorkers,
        specializedConcurrency: this.opts.specializedConcurrency,
        logDb: this.logDb.isEnabled(),
      },
      'WorkerRegistry started',
    );
  }

  /**
   * Retry/maintenance cycle: recover expired leases, prune completed rows,
   * flush usage counters + admin logs, and report per-worker performance to the
   * logging database.
   */
  private async retryCycle(): Promise<void> {
    try {
      const recovered = await this.generalQueue.recoverStuck(500);
      const pruned = await this.generalQueue.pruneCompleted(this.opts.completedRetentionMs, 5000);
      if (recovered > 0 || pruned > 0) {
        this.adminLogger.debug('queue.maintenance', 'Recovery/prune cycle', {
          metadata: { recovered, pruned },
        });
      }
    } catch (err) {
      this.log.error({ err }, 'Retry cycle maintenance failed');
    }

    // Usage + admin logs flush opportunistically (they also self-flush on their
    // own timers; this just tightens the window under load).
    void this.usage.flush();
    void this.adminLogger.flush();

    // Per-worker performance reporting to TimescaleDB.
    if (this.logDb.isEnabled()) {
      const all = [...this.generalPool, ...this.specializedPool];
      for (const w of all) {
        const s = w.drainStats();
        if (s.jobsProcessed === 0 && s.jobsFailed === 0) continue;
        void this.logDb.writeWorkerPerformance({
          workerId: s.workerId,
          workerType: s.workerType,
          jobsProcessed: s.jobsProcessed,
          jobsFailed: s.jobsFailed,
          avgDurationMs: s.avgDurationMs,
          p95DurationMs: s.p95DurationMs,
          pollCycles: s.pollCycles,
        });
      }
      // Queue-depth metric snapshot comes from the gauge, not a request-time count.
      void this.gauge
        .read()
        .then((state) => {
          if (!state) return;
          void this.logDb.writeMetric('queue.pending_depth', state.pendingDepth);
          void this.logDb.writeMetric('backpressure_gauge.age_ms', Date.now() - state.updatedAt.getTime());
        })
        .catch(() => {});
    }
  }

  private async updateGauge(workerId: string): Promise<void> {
    this.gaugeBatchCounter++;
    if (this.gaugeBatchCounter % env.GAUGE_UPDATE_INTERVAL_BATCHES !== 0) return;

    const pendingDepth = await this.generalQueue.pendingDepthEstimate();
    await this.gauge.update(pendingDepth, workerId);
    this.log.debug({ workerId, pendingDepth }, 'Backpressure gauge updated');
  }

  private workerId(type: string, index: number): string {
    return `${type}-${process.pid}-${index}-${randomUUID().slice(0, 8)}`;
  }

  /** Drain all workers and close logging resources. */
  async stop(): Promise<void> {
    if (this.retryTimer) {
      clearInterval(this.retryTimer);
      this.retryTimer = null;
    }
    this.maintenance.stop();
    await Promise.all([
      ...this.generalPool.map((w) => w.stop()),
      ...this.specializedPool.map((w) => w.stop()),
    ]);
    await this.usage.stop();
    await this.adminLogger.stop();
    await this.logDb.end();
    this.log.info('WorkerRegistry stopped');
  }
}
