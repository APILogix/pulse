/**
 * Worker registry and lifecycle wiring (PostgreSQL queue — no BullMQ/Redis).
 *
 * Flow:
 * 1. Receive a Postgres pool from the bootstrap entrypoint.
 * 2. Construct the PgQueue, TelemetryWriter, job handler, and N PgQueueWorkers.
 * 3. Handle SIGTERM/SIGINT by draining workers (finish in-flight jobs), then
 *    closing infrastructure.
 *
 * Horizontal scaling: run multiple worker processes; SKIP LOCKED guarantees a
 * job is processed by exactly one worker at a time.
 */
import type { Pool } from 'pg';
import { PgQueue } from '../../modules/ingestion/queue/pg-queue.js';
import { PgQueueWorker } from '../../modules/ingestion/queue/pg-queue-worker.js';
export interface WorkerDependencies {
    pool: Pool;
    /** Number of concurrent PgQueueWorkers in this process. */
    concurrency?: number;
    shutdown?: () => Promise<void>;
}
export interface RunningWorkers {
    workers: PgQueueWorker[];
    queue: PgQueue;
    stop: () => Promise<void>;
}
export declare function initializeWorkers(deps: WorkerDependencies): RunningWorkers;
//# sourceMappingURL=index.d.ts.map