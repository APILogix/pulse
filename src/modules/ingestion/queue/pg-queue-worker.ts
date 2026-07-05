/**
 * PgQueueWorker — polling consumer for the PostgreSQL ingestion queue.
 *
 * Replaces the BullMQ Worker. Mechanics:
 *   - Poll loop claims a batch of jobs with FOR UPDATE SKIP LOCKED (via PgQueue).
 *   - Each job's payload is a normalized, tenant-scoped event (or a batch of
 *     them); the handler persists it through TelemetryWriter.
 *   - Success -> queue.complete(); failure -> queue.fail() (retry w/ backoff or
 *     dead-letter).
 *   - A background timer recovers stuck jobs (crashed workers) and prunes
 *     completed rows.
 *   - Adaptive idle backoff: when the queue is empty the loop sleeps longer to
 *     avoid hammering Postgres; under load it polls tightly.
 *   - Graceful shutdown drains in-flight jobs before exiting.
 *
 * Horizontal scaling: run N of these across processes/nodes. SKIP LOCKED
 * guarantees a job is handed to exactly one worker at a time.
 */
import type { Logger } from 'pino';
import { PgQueue, type ClaimedJob } from './pg-queue.js';

export type JobHandler = (job: ClaimedJob) => Promise<void>;

export interface PgQueueWorkerOptions {
  workerId: string;
  /** Max jobs claimed per poll. */
  batchSize?: number;
  /** Poll interval when the queue had work last cycle. */
  busyPollMs?: number;
  /** Poll interval when the queue was empty (adaptive idle backoff). */
  idlePollMs?: number;
  /** How often to run stuck-job recovery + prune. */
  maintenanceMs?: number;
  /** Retention for completed jobs before pruning. */
  completedRetentionMs?: number;
  /** Max handlers running at once per poll cycle (bounds DB connections). */
  handlerConcurrency?: number;
  /**
   * Restrict this worker to a subset of job types (general vs specialized lane
   * isolation). When omitted the worker claims any pending job.
   */
  jobTypes?: readonly string[];
  /**
   * Whether this worker runs the background stuck-recovery + prune timer.
   * Default true. Set false when a dedicated RETRY worker owns maintenance so
   * the work isn't duplicated across every consumer.
   */
  enableMaintenance?: boolean;
  /** Logical worker type label for performance reporting (e.g. 'general'). */
  workerType?: string;
  /** Invoked after a claimed batch completes; errors are logged and ignored. */
  onBatchComplete?: (summary: {
    workerId: string;
    workerType: string;
    claimed: number;
    processed: number;
    failed: number;
  }) => Promise<void>;
}

/** Rolling per-worker processing stats, drained for performance reporting. */
export interface WorkerStats {
  workerId: string;
  workerType: string;
  jobsProcessed: number;
  jobsFailed: number;
  pollCycles: number;
  avgDurationMs: number;
  p95DurationMs: number;
}

export class PgQueueWorker {
  private running = false;
  private draining = false;
  private inFlight = 0;
  private pollTimer: NodeJS.Timeout | null = null;
  private maintenanceTimer: NodeJS.Timeout | null = null;

  private readonly workerId: string;
  private readonly workerType: string;
  private readonly batchSize: number;
  private readonly busyPollMs: number;
  private readonly idlePollMs: number;
  private readonly maintenanceMs: number;
  private readonly completedRetentionMs: number;
  private readonly handlerConcurrency: number;
  private readonly jobTypes: readonly string[] | undefined;
  private readonly enableMaintenance: boolean;
  private readonly onBatchComplete: PgQueueWorkerOptions['onBatchComplete'];

  // Rolling stats since the last drainStats() call.
  private jobsProcessed = 0;
  private jobsFailed = 0;
  private pollCycles = 0;
  private durations: number[] = [];

  constructor(
    private readonly queue: PgQueue,
    private readonly handler: JobHandler,
    private readonly log: Logger,
    opts: PgQueueWorkerOptions,
  ) {
    this.workerId = opts.workerId;
    this.workerType = opts.workerType ?? 'general';
    this.batchSize = opts.batchSize ?? 50;
    this.busyPollMs = opts.busyPollMs ?? 25;
    this.idlePollMs = opts.idlePollMs ?? 500;
    this.maintenanceMs = opts.maintenanceMs ?? 15_000;
    this.completedRetentionMs = opts.completedRetentionMs ?? 60 * 60_000;
    // Keep this well under the Postgres pool size so concurrent workers + their
    // in-flight handlers never exhaust connections.
    this.handlerConcurrency = opts.handlerConcurrency ?? 8;
    this.jobTypes = opts.jobTypes && opts.jobTypes.length > 0 ? opts.jobTypes : undefined;
    this.enableMaintenance = opts.enableMaintenance ?? true;
    this.onBatchComplete = opts.onBatchComplete;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.log.info({ workerId: this.workerId, workerType: this.workerType }, 'PgQueueWorker started');
    void this.loop();
    if (this.enableMaintenance) {
      this.maintenanceTimer = setInterval(() => void this.maintenance(), this.maintenanceMs);
      // Don't keep the process alive solely for maintenance.
      this.maintenanceTimer.unref?.();
    }
  }

  /** Drain and reset rolling stats (called periodically for perf reporting). */
  drainStats(): WorkerStats {
    const sorted = [...this.durations].sort((a, b) => a - b);
    const avg = sorted.length ? sorted.reduce((s, v) => s + v, 0) / sorted.length : 0;
    const p95 = sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]! : 0;
    const stats: WorkerStats = {
      workerId: this.workerId,
      workerType: this.workerType,
      jobsProcessed: this.jobsProcessed,
      jobsFailed: this.jobsFailed,
      pollCycles: this.pollCycles,
      avgDurationMs: Math.round(avg),
      p95DurationMs: Math.round(p95),
    };
    this.jobsProcessed = 0;
    this.jobsFailed = 0;
    this.pollCycles = 0;
    this.durations = [];
    return stats;
  }

  private async loop(): Promise<void> {
    if (!this.running) return;
    let nextDelay = this.idlePollMs;
    this.pollCycles++;

    try {
      const jobs = await this.queue.claim(this.workerId, this.batchSize, this.jobTypes);
      if (jobs.length > 0) {
        nextDelay = this.busyPollMs;
        const beforeProcessed = this.jobsProcessed;
        const beforeFailed = this.jobsFailed;
        // Process the claimed batch with BOUNDED concurrency. An unbounded
        // Promise.all over a large batch can open more DB connections than the
        // pool allows (pool max ~20), causing connection-timeout failures under
        // load. We cap in-flight handlers per poll cycle.
        await this.runBounded(jobs, this.handlerConcurrency);
        await this.notifyBatchComplete({
          claimed: jobs.length,
          processed: this.jobsProcessed - beforeProcessed,
          failed: this.jobsFailed - beforeFailed,
        });
      }
    } catch (err) {
      this.log.error({ err, workerId: this.workerId }, 'Poll cycle failed');
      nextDelay = this.idlePollMs;
    }

    if (this.running && !this.draining) {
      this.pollTimer = setTimeout(() => void this.loop(), nextDelay);
      this.pollTimer.unref?.();
    }
  }

  private async notifyBatchComplete(summary: {
    claimed: number;
    processed: number;
    failed: number;
  }): Promise<void> {
    if (!this.onBatchComplete) return;
    try {
      await this.onBatchComplete({
        workerId: this.workerId,
        workerType: this.workerType,
        ...summary,
      });
    } catch (err) {
      this.log.warn({ err, workerId: this.workerId }, 'Batch completion hook failed');
    }
  }

  /** Run handlers over jobs with a bounded number in flight at once. */
  private async runBounded(jobs: ClaimedJob[], limit: number): Promise<void> {
    let cursor = 0;
    const runNext = async (): Promise<void> => {
      while (cursor < jobs.length) {
        const job = jobs[cursor++]!;
        await this.process(job);
      }
    };
    const lanes = Array.from({ length: Math.min(limit, jobs.length) }, () => runNext());
    await Promise.all(lanes);
  }

  private async process(job: ClaimedJob): Promise<void> {
    this.inFlight++;
    const startedAt = Date.now();
    try {
      await this.handler(job);
      const durationMs = Date.now() - startedAt;
      await this.queue.complete(job.id, { processedBy: this.workerId, durationMs });
      this.jobsProcessed++;
      this.durations.push(durationMs);
    } catch (err) {
      this.jobsFailed++;
      const msg = err instanceof Error ? err.message : String(err);
      const code = err instanceof Error ? err.name : undefined;
      try {
        const outcome = await this.queue.fail(job, msg, code);
        this.log.warn({ jobId: job.id, jobType: job.jobType, outcome, err: msg }, 'Job failed');
      } catch (failErr) {
        this.log.error({ jobId: job.id, err: failErr }, 'Failed to record job failure');
      }
    } finally {
      this.inFlight--;
    }
  }

  private async maintenance(): Promise<void> {
    try {
      await this.queue.recoverStuck(500);
      await this.queue.pruneCompleted(this.completedRetentionMs, 5000);
    } catch (err) {
      this.log.error({ err }, 'Queue maintenance cycle failed');
    }
  }

  /** Stop claiming new work and wait for in-flight jobs to settle. */
  async stop(timeoutMs = 15_000): Promise<void> {
    this.draining = true;
    this.running = false;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    if (this.maintenanceTimer) clearInterval(this.maintenanceTimer);

    const deadline = Date.now() + timeoutMs;
    while (this.inFlight > 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100));
    }
    this.log.info(
      { workerId: this.workerId, remaining: this.inFlight },
      'PgQueueWorker stopped',
    );
  }
}
