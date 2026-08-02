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
    eventId?: string | null;
    traceId?: string | null;
    spanId?: string | null;
    sessionId?: string | null;
    userId?: string | null;
    tenantId?: string | null;
}
/** Job types handled by the SPECIALIZED worker lane (heavy / isolated). */
export declare const SPECIALIZED_JOB_TYPES: readonly string[];
/** Job types handled by the GENERAL worker lane (fast path). */
export declare const GENERAL_JOB_TYPES: readonly string[];
/** Options for marking a job complete (processing accounting). */
export interface CompleteOptions {
    processedBy?: string;
    durationMs?: number;
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
export declare class PgQueue {
    private readonly pool;
    private readonly queue;
    private readonly visibilityTimeoutMs;
    private readonly baseBackoffMs;
    private readonly maxBackoffMs;
    constructor(pool: Pool, opts?: PgQueueOptions);
    /**
     * Resolve the scheduling priority for an event type (LOWER = higher).
     * Single source of truth shared by the API enqueue path and the worker tier.
     * Unknown types default to 50 (normal).
     */
    static getPriorityForType(jobType: string): number;
    /** Enqueue a single job. Returns the job id, or null if deduped. */
    enqueue(job: EnqueueJob, client?: PoolClient): Promise<string | null>;
    /**
     * Enqueue many jobs in one round trip. Deduplicated jobs (matching an
     * in-flight dedupe_key) are silently skipped via ON CONFLICT DO NOTHING
     * against the partial unique index.
     */
    enqueueBulk(jobs: EnqueueJob[], client?: PoolClient): Promise<string[]>;
    /**
     * Atomically claim up to `batchSize` ready jobs for `workerId`.
     *
     * The SKIP LOCKED clause is what makes this safe under high worker
     * concurrency: each worker locks a disjoint set of rows and never blocks on
     * rows another worker already holds. The CTE updates the claimed rows to
     * 'active' and stamps the lease in the same statement, so there is no window
     * where a row is selected but not yet leased.
     */
    claim(workerId: string, batchSize: number, jobTypes?: readonly string[]): Promise<ClaimedJob[]>;
    /** Mark a claimed job complete, optionally recording processing accounting. */
    complete(jobId: string, opts?: CompleteOptions): Promise<void>;
    /**
     * Handle a failed job. If attempts remain, reschedule with exponential
     * backoff. Otherwise move it to the dead-letter table (in one transaction so
     * we never both DLQ and leave the job alive).
     */
    fail(job: ClaimedJob, errorMessage: string, errorCode?: string): Promise<'retried' | 'dead-lettered'>;
    /** Extend a job's lease while a long-running task is still in progress. */
    heartbeat(jobId: string, workerId: string): Promise<void>;
    /**
     * Return active jobs whose lease expired (worker crash/stall) to the pending
     * pool so another worker can pick them up. Returns the count recovered.
     */
    recoverStuck(limit?: number): Promise<number>;
    /** Delete completed jobs older than the retention window. Returns rows removed. */
    pruneCompleted(olderThanMs: number, limit?: number): Promise<number>;
    /** Requeue a dead-letter row back onto the live queue (operator action). */
    replayDeadLetter(dlqId: string, replayedBy?: string): Promise<string | null>;
    /** Snapshot queue depth + health for observability/backpressure decisions. */
    metrics(): Promise<QueueMetrics>;
    /** Approximate pending depth — cheap backpressure probe. */
    pendingDepth(): Promise<number>;
    /** O(1) queue pressure estimate for worker-driven backpressure gauge updates. */
    pendingDepthEstimate(): Promise<number>;
}
//# sourceMappingURL=pg-queue.d.ts.map