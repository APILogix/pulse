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
}

export class PgQueueWorker {
  private running = false;
  private draining = false;
  private inFlight = 0;
  private pollTimer: NodeJS.Timeout | null = null;
  private maintenanceTimer: NodeJS.Timeout | null = null;

  private readonly workerId: string;
  private readonly batchSize: number;
  private readonly busyPollMs: number;
  private readonly idlePollMs: number;
  private readonly maintenanceMs: number;
  private readonly completedRetentionMs: number;
  private readonly handlerConcurrency: number;

  constructor(
    private readonly queue: PgQueue,
    private readonly handler: JobHandler,
    private readonly log: Logger,
    opts: PgQueueWorkerOptions,
  ) {
    this.workerId = opts.workerId;
    this.batchSize = opts.batchSize ?? 50;
    this.busyPollMs = opts.busyPollMs ?? 25;
    this.idlePollMs = opts.idlePollMs ?? 500;
    this.maintenanceMs = opts.maintenanceMs ?? 15_000;
    this.completedRetentionMs = opts.completedRetentionMs ?? 60 * 60_000;
    // Keep this well under the Postgres pool size so concurrent workers + their
    // in-flight handlers never exhaust connections.
    this.handlerConcurrency = opts.handlerConcurrency ?? 8;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.log.info({ workerId: this.workerId }, 'PgQueueWorker started');
    void this.loop();
    this.maintenanceTimer = setInterval(() => void this.maintenance(), this.maintenanceMs);
    // Don't keep the process alive solely for maintenance.
    this.maintenanceTimer.unref?.();
  }

  private async loop(): Promise<void> {
    if (!this.running) return;
    let nextDelay = this.idlePollMs;

    try {
      const jobs = await this.queue.claim(this.workerId, this.batchSize);
      if (jobs.length > 0) {
        nextDelay = this.busyPollMs;
        // Process the claimed batch with BOUNDED concurrency. An unbounded
        // Promise.all over a large batch can open more DB connections than the
        // pool allows (pool max ~20), causing connection-timeout failures under
        // load. We cap in-flight handlers per poll cycle.
        await this.runBounded(jobs, this.handlerConcurrency);
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
    try {
      await this.handler(job);
      await this.queue.complete(job.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      try {
        const outcome = await this.queue.fail(job, msg);
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
