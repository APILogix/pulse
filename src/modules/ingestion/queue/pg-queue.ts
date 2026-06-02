/**
 * PgQueue — PostgreSQL-native job queue (pg-boss style).
 *
 * Why this exists:
 *   The ingestion pipeline is moving off BullMQ/Redis to a Postgres-native
 *   queue so the queue shares the same durability, backup, and transactional
 *   guarantees as the data it produces. There is no second datastore to operate
 *   or keep consistent.
 *
 * Core mechanics:
 *   - enqueue / enqueueBulk: insert pending jobs (optionally delayed, prioritized,
 *     deduplicated).
 *   - claim: atomically lease N ready jobs using FOR UPDATE SKIP LOCKED so many
 *     workers across many nodes never hand the same job to two consumers.
 *   - complete: mark a leased job done.
 *   - retry: on failure, either reschedule with exponential backoff or move the
 *     job to the dead-letter table once max_attempts is exhausted.
 *   - heartbeat: extend a job's lease while a long task is still running.
 *   - recoverStuck: return leases that expired (crashed/stalled workers) to the
 *     pending pool — the at-least-once guarantee.
 *
 * Delivery semantics: at-least-once. Consumers MUST be idempotent. The event
 * pipeline already dedupes by event id at the storage layer, and `dedupe_key`
 * prevents duplicate enqueues while a job is in flight.
 */
import type { Pool, PoolClient } from 'pg';
import { logger } from '../../../config/logger.js';

const queueLogger = logger.child({ component: 'pg-queue' });

export interface EnqueueJob {
  jobType: string;
  payload: unknown;
  /** LOWER = higher priority. Default 100. */
  priority?: number;
  orgId?: string | null;
  projectId?: string | null;
  /** Idempotency key — duplicate enqueues while in-flight are ignored. */
  dedupeKey?: string | null;
  /** Delay before the job becomes claimable, in milliseconds. */
  delayMs?: number;
  maxAttempts?: number;
}

export interface ClaimedJob {
  id: string;
  queue: string;
  jobType: string;
  priority: number;
  orgId: string | null;
  projectId: string | null;
  payload: unknown;
  attempts: number;
  maxAttempts: number;
  dedupeKey: string | null;
}

export interface QueueMetrics {
  pending: number;
  active: number;
  completed: number;
  failed: number;
  deadLettered: number;
  oldestPendingAgeSeconds: number | null;
}

interface ClaimRow {
  id: string;
  queue: string;
  job_type: string;
  priority: number;
  org_id: string | null;
  project_id: string | null;
  payload: unknown;
  attempts: number;
  max_attempts: number;
  dedupe_key: string | null;
}

export interface PgQueueOptions {
  /** Logical queue name. Workers claim from a single queue. */
  queue?: string;
  /** Visibility timeout: how long a claimed job stays leased before recovery. */
  visibilityTimeoutMs?: number;
  /** Base backoff for retries; grows exponentially with attempt count. */
  baseBackoffMs?: number;
  /** Cap on a single retry backoff. */
  maxBackoffMs?: number;
}

export class PgQueue {
  private readonly queue: string;
  private readonly visibilityTimeoutMs: number;
  private readonly baseBackoffMs: number;
  private readonly maxBackoffMs: number;

  constructor(private readonly pool: Pool, opts: PgQueueOptions = {}) {
    this.queue = opts.queue ?? 'ingestion';
    this.visibilityTimeoutMs = opts.visibilityTimeoutMs ?? 60_000;
    this.baseBackoffMs = opts.baseBackoffMs ?? 1_000;
    this.maxBackoffMs = opts.maxBackoffMs ?? 5 * 60_000;
  }

  /** Enqueue a single job. Returns the job id, or null if deduped. */
  async enqueue(job: EnqueueJob, client?: PoolClient): Promise<string | null> {
    const ids = await this.enqueueBulk([job], client);
    return ids[0] ?? null;
  }

  /**
   * Enqueue many jobs in one round trip. Deduplicated jobs (matching an
   * in-flight dedupe_key) are silently skipped via ON CONFLICT DO NOTHING
   * against the partial unique index.
   */
  async enqueueBulk(jobs: EnqueueJob[], client?: PoolClient): Promise<string[]> {
    if (jobs.length === 0) return [];
    const db = client ?? this.pool;

    // Build a multi-row VALUES insert. Parameterized; payload is JSONB.
    const cols: string[] = [];
    const params: unknown[] = [];
    let i = 1;
    for (const j of jobs) {
      cols.push(
        `($${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++}::jsonb, $${i++}, NOW() + ($${i++}::int || ' milliseconds')::interval, $${i++})`,
      );
      params.push(
        this.queue,
        j.jobType,
        j.priority ?? 100,
        j.orgId ?? null,
        j.projectId ?? null,
        JSON.stringify(j.payload),
        j.dedupeKey ?? null,
        j.delayMs ?? 0,
        j.maxAttempts ?? 5,
      );
    }

    const result = await db.query<{ id: string }>(
      `INSERT INTO ingestion_jobs
         (queue, job_type, priority, org_id, project_id, payload, dedupe_key, run_at, max_attempts)
       VALUES ${cols.join(', ')}
       ON CONFLICT DO NOTHING
       RETURNING id`,
      params,
    );
    return result.rows.map((r) => r.id);
  }

  /**
   * Atomically claim up to `batchSize` ready jobs for `workerId`.
   *
   * The SKIP LOCKED clause is what makes this safe under high worker
   * concurrency: each worker locks a disjoint set of rows and never blocks on
   * rows another worker already holds. The CTE updates the claimed rows to
   * 'active' and stamps the lease in the same statement, so there is no window
   * where a row is selected but not yet leased.
   */
  async claim(workerId: string, batchSize: number): Promise<ClaimedJob[]> {
    const result = await this.pool.query<ClaimRow>(
      `
      WITH claimable AS (
        SELECT id
        FROM ingestion_jobs
        WHERE queue = $1
          AND state = 'pending'
          AND run_at <= NOW()
        ORDER BY priority ASC, run_at ASC
        LIMIT $2
        FOR UPDATE SKIP LOCKED
      )
      UPDATE ingestion_jobs j
         SET state = 'active',
             attempts = j.attempts + 1,
             locked_by = $3,
             locked_until = NOW() + ($4::int || ' milliseconds')::interval,
             heartbeat_at = NOW()
        FROM claimable c
       WHERE j.id = c.id
      RETURNING j.id, j.queue, j.job_type, j.priority, j.org_id, j.project_id,
                j.payload, j.attempts, j.max_attempts, j.dedupe_key
      `,
      [this.queue, batchSize, workerId, this.visibilityTimeoutMs],
    );

    return result.rows.map((r) => ({
      id: r.id,
      queue: r.queue,
      jobType: r.job_type,
      priority: r.priority,
      orgId: r.org_id,
      projectId: r.project_id,
      payload: r.payload,
      attempts: r.attempts,
      maxAttempts: r.max_attempts,
      dedupeKey: r.dedupe_key,
    }));
  }

  /** Mark a claimed job complete. */
  async complete(jobId: string): Promise<void> {
    await this.pool.query(
      `UPDATE ingestion_jobs
         SET state = 'completed', completed_at = NOW(), locked_until = NULL, locked_by = NULL
       WHERE id = $1 AND state = 'active'`,
      [jobId],
    );
  }

  /**
   * Handle a failed job. If attempts remain, reschedule with exponential
   * backoff. Otherwise move it to the dead-letter table (in one transaction so
   * we never both DLQ and leave the job alive).
   */
  async fail(job: ClaimedJob, errorMessage: string): Promise<'retried' | 'dead-lettered'> {
    if (job.attempts >= job.maxAttempts) {
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          `INSERT INTO ingestion_dead_letter_jobs
             (original_job_id, queue, job_type, org_id, project_id, payload, dedupe_key, attempts, last_error)
           VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9)`,
          [
            job.id, job.queue, job.jobType, job.orgId, job.projectId,
            JSON.stringify(job.payload), job.dedupeKey, job.attempts, errorMessage.slice(0, 4000),
          ],
        );
        await client.query(
          `UPDATE ingestion_jobs
             SET state = 'failed', last_error = $2, locked_until = NULL, locked_by = NULL
           WHERE id = $1`,
          [job.id, errorMessage.slice(0, 4000)],
        );
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
      queueLogger.warn({ jobId: job.id, jobType: job.jobType }, 'Job dead-lettered');
      return 'dead-lettered';
    }

    // Exponential backoff: base * 2^(attempts-1), capped, with light jitter.
    const backoff = Math.min(
      this.baseBackoffMs * 2 ** Math.max(0, job.attempts - 1),
      this.maxBackoffMs,
    );
    const jitter = Math.floor(Math.random() * Math.min(1_000, backoff));
    await this.pool.query(
      `UPDATE ingestion_jobs
         SET state = 'pending',
             run_at = NOW() + (($2::int) || ' milliseconds')::interval,
             last_error = $3,
             locked_until = NULL,
             locked_by = NULL
       WHERE id = $1`,
      [job.id, backoff + jitter, errorMessage.slice(0, 4000)],
    );
    return 'retried';
  }

  /** Extend a job's lease while a long-running task is still in progress. */
  async heartbeat(jobId: string, workerId: string): Promise<void> {
    await this.pool.query(
      `UPDATE ingestion_jobs
         SET heartbeat_at = NOW(),
             locked_until = NOW() + ($3::int || ' milliseconds')::interval
       WHERE id = $1 AND locked_by = $2 AND state = 'active'`,
      [jobId, workerId, this.visibilityTimeoutMs],
    );
  }

  /**
   * Return active jobs whose lease expired (worker crash/stall) to the pending
   * pool so another worker can pick them up. Returns the count recovered.
   */
  async recoverStuck(limit = 500): Promise<number> {
    const result = await this.pool.query(
      `
      WITH stuck AS (
        SELECT id FROM ingestion_jobs
        WHERE state = 'active' AND locked_until < NOW()
        ORDER BY locked_until ASC
        LIMIT $1
        FOR UPDATE SKIP LOCKED
      )
      UPDATE ingestion_jobs j
         SET state = 'pending', locked_until = NULL, locked_by = NULL,
             last_error = COALESCE(j.last_error, 'lease expired; recovered')
        FROM stuck s
       WHERE j.id = s.id
      `,
      [limit],
    );
    const n = result.rowCount ?? 0;
    if (n > 0) queueLogger.warn({ recovered: n }, 'Recovered stuck ingestion jobs');
    return n;
  }

  /** Delete completed jobs older than the retention window. Returns rows removed. */
  async pruneCompleted(olderThanMs: number, limit = 5000): Promise<number> {
    const result = await this.pool.query(
      `DELETE FROM ingestion_jobs
       WHERE id IN (
         SELECT id FROM ingestion_jobs
         WHERE state = 'completed'
           AND completed_at < NOW() - ($1::int || ' milliseconds')::interval
         LIMIT $2
       )`,
      [olderThanMs, limit],
    );
    return result.rowCount ?? 0;
  }

  /** Requeue a dead-letter row back onto the live queue (operator action). */
  async replayDeadLetter(dlqId: string): Promise<string | null> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const dlq = await client.query<{
        queue: string; job_type: string; org_id: string | null;
        project_id: string | null; payload: unknown; dedupe_key: string | null;
      }>(
        `SELECT queue, job_type, org_id, project_id, payload, dedupe_key
         FROM ingestion_dead_letter_jobs
         WHERE id = $1 AND replayed_at IS NULL
         FOR UPDATE`,
        [dlqId],
      );
      const row = dlq.rows[0];
      if (!row) {
        await client.query('ROLLBACK');
        return null;
      }
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO ingestion_jobs (queue, job_type, priority, org_id, project_id, payload, dedupe_key)
         VALUES ($1,$2,100,$3,$4,$5::jsonb,$6)
         RETURNING id`,
        [row.queue, row.job_type, row.org_id, row.project_id, JSON.stringify(row.payload), row.dedupe_key],
      );
      await client.query(
        `UPDATE ingestion_dead_letter_jobs SET replayed_at = NOW() WHERE id = $1`,
        [dlqId],
      );
      await client.query('COMMIT');
      return inserted.rows[0]?.id ?? null;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  /** Snapshot queue depth + health for observability/backpressure decisions. */
  async metrics(): Promise<QueueMetrics> {
    const result = await this.pool.query<{
      state: string | null; cnt: string; oldest: string | null;
    }>(
      `SELECT state::text AS state, COUNT(*)::text AS cnt,
              EXTRACT(EPOCH FROM (NOW() - MIN(run_at)))::int AS oldest
       FROM ingestion_jobs
       WHERE queue = $1
       GROUP BY state`,
      [this.queue],
    );
    const dlq = await this.pool.query<{ cnt: string }>(
      `SELECT COUNT(*)::text AS cnt FROM ingestion_dead_letter_jobs WHERE queue = $1`,
      [this.queue],
    );

    const m: QueueMetrics = {
      pending: 0, active: 0, completed: 0, failed: 0,
      deadLettered: Number(dlq.rows[0]?.cnt ?? 0),
      oldestPendingAgeSeconds: null,
    };
    for (const row of result.rows) {
      const n = Number(row.cnt);
      if (row.state === 'pending') {
        m.pending = n;
        m.oldestPendingAgeSeconds = row.oldest != null ? Number(row.oldest) : null;
      } else if (row.state === 'active') m.active = n;
      else if (row.state === 'completed') m.completed = n;
      else if (row.state === 'failed') m.failed = n;
    }
    return m;
  }

  /** Approximate pending depth — cheap backpressure probe. */
  async pendingDepth(): Promise<number> {
    const r = await this.pool.query<{ cnt: string }>(
      `SELECT COUNT(*)::text AS cnt FROM ingestion_jobs
       WHERE queue = $1 AND state = 'pending'`,
      [this.queue],
    );
    return Number(r.rows[0]?.cnt ?? 0);
  }
}
