import type { Logger } from 'pino';
import { PgmqClient, type PgmqMessage } from './pgmq.js';
export type PgmqJobHandler<T = any> = (job: PgmqMessage<T>, signal?: AbortSignal) => Promise<unknown>;
export interface PgmqWorkerOptions {
    queue: string;
    workerId?: string;
    batchSize?: number;
    concurrency?: number;
    visibilityTimeoutSeconds?: number;
    pollTimeoutSeconds?: number;
    pollIntervalMs?: number;
    idlePollMs?: number;
    maxIdlePollMs?: number;
    busyPollMs?: number;
    maxAttempts?: number;
    deadLetterQueue?: string;
    archiveOnComplete?: boolean;
    heartbeatIntervalSeconds?: number;
    drainTimeoutMs?: number;
    logger?: Logger;
    onJobSuccess?: (job: PgmqMessage, durationMs: number) => Promise<void> | void;
    onJobFailure?: (job: PgmqMessage, error: unknown, willRetry: boolean) => Promise<void> | void;
    onMaxAttemptsExceeded?: (job: PgmqMessage, error: unknown) => Promise<void> | void;
}
export interface PgmqWorkerStats {
    workerId: string;
    queue: string;
    inFlight: number;
    processed: number;
    failed: number;
    deadLettered: number;
    retried: number;
}
/**
 * Production PGMQ Consumer Worker.
 *
 * Implements robust at-least-once queue processing:
 * 1. Reads batches via `pgmq.readWithPoll` with configurable visibility timeout.
 * 2. Starts an automatic heartbeat loop (`set_vt`) for active long-running jobs.
 * 3. Enforces concurrency boundaries and settles each job individually.
 * 4. Acknowledges (`delete` or `archive`) upon successful processing.
 * 5. Automatically manages retry policy and dead-letter queue routing.
 * 6. Drains in-flight work safely upon receiving termination signals.
 */
export declare class PgmqWorker<T = any> {
    readonly queue: string;
    readonly workerId: string;
    private client;
    private handler;
    private log;
    private batchSize;
    private concurrency;
    private visibilityTimeoutSeconds;
    private pollTimeoutSeconds;
    private pollIntervalMs;
    private idlePollMs;
    private maxIdlePollMs;
    private busyPollMs;
    private consecutiveEmptyPolls;
    private maxAttempts;
    private deadLetterQueue;
    private archiveOnComplete;
    private heartbeatIntervalSeconds;
    private drainTimeoutMs;
    private onJobSuccess;
    private onJobFailure;
    private onMaxAttemptsExceeded;
    private running;
    private draining;
    private inFlightJobs;
    private processedCount;
    private failedCount;
    private deadLetteredCount;
    private retriedCount;
    private pollTimer;
    constructor(client: PgmqClient, handler: PgmqJobHandler<T>, options: PgmqWorkerOptions);
    /**
     * Starts the polling worker.
     */
    start(): Promise<void>;
    getStats(): PgmqWorkerStats;
    private pollLoop;
    private executeJob;
    private handleDeadLetter;
    /**
     * Gracefully shuts down the worker:
     * 1. Stops accepting new messages.
     * 2. Waits for all active in-flight jobs to complete up to `drainTimeoutMs`.
     * 3. Aborts lingering jobs if deadline exceeded.
     */
    stop(): Promise<void>;
}
//# sourceMappingURL=pgmq-worker.d.ts.map