import { logger } from '../../../config/logger.js';
const queueLogger = logger.child({ component: 'pg-queue' });
/**
 * Per-type queue priority (LOWER = HIGHER priority). Single source of truth so
 * the API path and the worker tier agree on scheduling. Mirrors the SDK
 * transport matrix: errors/messages/crons are highest; requests/spans/traces
 * normal; logs/metrics/profiles/replays lower.
 */
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
/** Job types handled by the SPECIALIZED worker lane (heavy / isolated). */
export const SPECIALIZED_JOB_TYPES = ['profile', 'replay', 'trace'];
/** Job types handled by the GENERAL worker lane (fast path). */
export const GENERAL_JOB_TYPES = [
    'error', 'message', 'request', 'span', 'metric', 'log', 'cron_checkin',
];
export class PgQueue {
    pool;
    queue;
    visibilityTimeoutMs;
    baseBackoffMs;
    maxBackoffMs;
    constructor(pool, opts = {}) {
        this.pool = pool;
        this.queue = opts.queue ?? 'ingestion';
        this.visibilityTimeoutMs = opts.visibilityTimeoutMs ?? 60_000;
        this.baseBackoffMs = opts.baseBackoffMs ?? 1_000;
        this.maxBackoffMs = opts.maxBackoffMs ?? 5 * 60_000;
    }
    /**
     * Resolve the scheduling priority for an event type (LOWER = higher).
     * Single source of truth shared by the API enqueue path and the worker tier.
     * Unknown types default to 50 (normal).
     */
    static getPriorityForType(jobType) {
        return TYPE_PRIORITY[jobType] ?? 50;
    }
    /** Enqueue a single job. Returns the job id, or null if deduped. */
    async enqueue(job, client) {
        const ids = await this.enqueueBulk([job], client);
        return ids[0] ?? null;
    }
    /**
     * Enqueue many jobs in one round trip. Deduplicated jobs (matching an
     * in-flight dedupe_key) are silently skipped via ON CONFLICT DO NOTHING
     * against the partial unique index.
     */
    async enqueueBulk(jobs, client) {
        if (jobs.length === 0)
            return [];
        const db = client ?? this.pool;
        // Build a multi-row VALUES insert. Parameterized; payload is JSONB.
        const cols = [];
        const params = [];
        let i = 1;
        for (const j of jobs) {
            cols.push(`($${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++}::jsonb, $${i++}, NOW() + ($${i++}::int || ' milliseconds')::interval, $${i++}, ` +
                `$${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++})`);
            params.push(this.queue, j.jobType, j.priority ?? PgQueue.getPriorityForType(j.jobType), j.orgId ?? null, j.projectId ?? null, JSON.stringify(j.payload), j.dedupeKey ?? null, j.delayMs ?? 0, j.maxAttempts ?? 3, j.eventId ?? null, j.traceId ?? null, j.spanId ?? null, j.sessionId ?? null, j.userId ?? null, j.tenantId ?? null);
        }
        const result = await db.query(`INSERT INTO ingestion_jobs
         (queue, job_type, priority, org_id, project_id, payload, dedupe_key, run_at, max_attempts,
          event_id, trace_id, span_id, session_id, user_id, tenant_id)
       VALUES ${cols.join(', ')}
       ON CONFLICT DO NOTHING
       RETURNING id`, params);
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
    async claim(workerId, batchSize, jobTypes) {
        const hasTypeFilter = Array.isArray(jobTypes) && jobTypes.length > 0;
        const result = await this.pool.query(`
      WITH claimable AS (
        SELECT id
        FROM ingestion_jobs
        WHERE queue = $1
          AND state = 'pending'
          AND run_at <= NOW()
          ${hasTypeFilter ? 'AND job_type = ANY($5::text[])' : ''}
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
      `, hasTypeFilter
            ? [this.queue, batchSize, workerId, this.visibilityTimeoutMs, jobTypes]
            : [this.queue, batchSize, workerId, this.visibilityTimeoutMs]);
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
    /** Mark a claimed job complete, optionally recording processing accounting. */
    async complete(jobId, opts) {
        await this.pool.query(`UPDATE ingestion_jobs
         SET state = 'completed', completed_at = NOW(),
             locked_until = NULL, locked_by = NULL,
             processed_by = COALESCE($2, processed_by),
             processing_duration_ms = COALESCE($3, processing_duration_ms)
       WHERE id = $1 AND state = 'active'`, [jobId, opts?.processedBy ?? null, opts?.durationMs ?? null]);
    }
    /**
     * Handle a failed job. If attempts remain, reschedule with exponential
     * backoff. Otherwise move it to the dead-letter table (in one transaction so
     * we never both DLQ and leave the job alive).
     */
    async fail(job, errorMessage, errorCode) {
        if (job.attempts >= job.maxAttempts) {
            const client = await this.pool.connect();
            try {
                await client.query('BEGIN');
                await client.query(`INSERT INTO ingestion_dead_letter_jobs
             (original_job_id, queue, job_type, org_id, project_id, payload, dedupe_key,
              attempts, max_attempts, last_error, error_code)
           VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11)`, [
                    job.id, job.queue, job.jobType, job.orgId, job.projectId,
                    JSON.stringify(job.payload), job.dedupeKey, job.attempts, job.maxAttempts,
                    errorMessage.slice(0, 4000), errorCode ?? null,
                ]);
                await client.query(`UPDATE ingestion_jobs
             SET state = 'failed', last_error = $2, error_code = $3,
                 locked_until = NULL, locked_by = NULL
           WHERE id = $1`, [job.id, errorMessage.slice(0, 4000), errorCode ?? null]);
                await client.query('COMMIT');
            }
            catch (err) {
                await client.query('ROLLBACK').catch(() => { });
                throw err;
            }
            finally {
                client.release();
            }
            queueLogger.warn({ jobId: job.id, jobType: job.jobType }, 'Job dead-lettered');
            return 'dead-lettered';
        }
        // Exponential backoff: base * 2^(attempts-1), capped, with light jitter.
        const backoff = Math.min(this.baseBackoffMs * 2 ** Math.max(0, job.attempts - 1), this.maxBackoffMs);
        const jitter = Math.floor(Math.random() * Math.min(1_000, backoff));
        await this.pool.query(`UPDATE ingestion_jobs
         SET state = 'pending',
             run_at = NOW() + (($2::int) || ' milliseconds')::interval,
             last_error = $3,
             error_code = $4,
             locked_until = NULL,
             locked_by = NULL
       WHERE id = $1`, [job.id, backoff + jitter, errorMessage.slice(0, 4000), errorCode ?? null]);
        return 'retried';
    }
    /** Extend a job's lease while a long-running task is still in progress. */
    async heartbeat(jobId, workerId) {
        await this.pool.query(`UPDATE ingestion_jobs
         SET heartbeat_at = NOW(),
             locked_until = NOW() + ($3::int || ' milliseconds')::interval
       WHERE id = $1 AND locked_by = $2 AND state = 'active'`, [jobId, workerId, this.visibilityTimeoutMs]);
    }
    /**
     * Return active jobs whose lease expired (worker crash/stall) to the pending
     * pool so another worker can pick them up. Returns the count recovered.
     */
    async recoverStuck(limit = 500) {
        const result = await this.pool.query(`
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
      `, [limit]);
        const n = result.rowCount ?? 0;
        if (n > 0)
            queueLogger.warn({ recovered: n }, 'Recovered stuck ingestion jobs');
        return n;
    }
    /** Delete completed jobs older than the retention window. Returns rows removed. */
    async pruneCompleted(olderThanMs, limit = 5000) {
        const result = await this.pool.query(`DELETE FROM ingestion_jobs
       WHERE id IN (
         SELECT id FROM ingestion_jobs
         WHERE state = 'completed'
           AND completed_at < NOW() - ($1::int || ' milliseconds')::interval
         LIMIT $2
       )`, [olderThanMs, limit]);
        return result.rowCount ?? 0;
    }
    /** Requeue a dead-letter row back onto the live queue (operator action). */
    async replayDeadLetter(dlqId, replayedBy) {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            const dlq = await client.query(`SELECT queue, job_type, org_id, project_id, payload, dedupe_key
         FROM ingestion_dead_letter_jobs
         WHERE id = $1 AND replayed_at IS NULL
         FOR UPDATE`, [dlqId]);
            const row = dlq.rows[0];
            if (!row) {
                await client.query('ROLLBACK');
                return null;
            }
            const inserted = await client.query(`INSERT INTO ingestion_jobs (queue, job_type, priority, org_id, project_id, payload, dedupe_key)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)
         RETURNING id`, [
                row.queue, row.job_type, PgQueue.getPriorityForType(row.job_type),
                row.org_id, row.project_id, JSON.stringify(row.payload), row.dedupe_key,
            ]);
            await client.query(`UPDATE ingestion_dead_letter_jobs SET replayed_at = NOW(), replayed_by = $2 WHERE id = $1`, [dlqId, replayedBy ?? null]);
            await client.query('COMMIT');
            return inserted.rows[0]?.id ?? null;
        }
        catch (err) {
            await client.query('ROLLBACK').catch(() => { });
            throw err;
        }
        finally {
            client.release();
        }
    }
    /** Snapshot queue depth + health for observability/backpressure decisions. */
    async metrics() {
        const result = await this.pool.query(`SELECT state::text AS state, COUNT(*)::text AS cnt,
              EXTRACT(EPOCH FROM (NOW() - MIN(run_at)))::int AS oldest
       FROM ingestion_jobs
       WHERE queue = $1
       GROUP BY state`, [this.queue]);
        const dlq = await this.pool.query(`SELECT COUNT(*)::text AS cnt FROM ingestion_dead_letter_jobs WHERE queue = $1`, [this.queue]);
        const m = {
            pending: 0, active: 0, completed: 0, failed: 0,
            deadLettered: Number(dlq.rows[0]?.cnt ?? 0),
            oldestPendingAgeSeconds: null,
        };
        for (const row of result.rows) {
            const n = Number(row.cnt);
            if (row.state === 'pending') {
                m.pending = n;
                m.oldestPendingAgeSeconds = row.oldest != null ? Number(row.oldest) : null;
            }
            else if (row.state === 'active')
                m.active = n;
            else if (row.state === 'completed')
                m.completed = n;
            else if (row.state === 'failed')
                m.failed = n;
        }
        return m;
    }
    /** Approximate pending depth — cheap backpressure probe. */
    async pendingDepth() {
        const r = await this.pool.query(`SELECT COUNT(*)::text AS cnt FROM ingestion_jobs
       WHERE queue = $1 AND state = 'pending'`, [this.queue]);
        return Number(r.rows[0]?.cnt ?? 0);
    }
}
//# sourceMappingURL=pg-queue.js.map