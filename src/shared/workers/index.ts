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
import { randomUUID } from 'crypto';

import { logger } from '../../config/logger.js';
import { PgQueue } from '../../modules/ingestion/queue/pg-queue.js';
import { PgQueueWorker } from '../../modules/ingestion/queue/pg-queue-worker.js';
import { TelemetryWriter } from '../../modules/ingestion/pipeline/telemetry-writer.js';
import { createIngestionJobHandler } from '../../modules/ingestion/pipeline/ingestion-job-handler.js';

const workerLogger = logger.child({ component: 'worker-registry' });

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

export function initializeWorkers(deps: WorkerDependencies): RunningWorkers {
  const queue = new PgQueue(deps.pool, { queue: 'ingestion' });
  const writer = new TelemetryWriter(deps.pool);
  const handler = createIngestionJobHandler(writer);

  const concurrency = deps.concurrency ?? 4;
  const workers: PgQueueWorker[] = [];
  for (let i = 0; i < concurrency; i++) {
    const w = new PgQueueWorker(queue, handler, workerLogger, {
      workerId: `ingest-${process.pid}-${i}-${randomUUID().slice(0, 8)}`,
      batchSize: 50,
      busyPollMs: 25,
      idlePollMs: 500,
    });
    w.start();
    workers.push(w);
  }

  workerLogger.info({ concurrency }, 'Ingestion PgQueue workers started');

  const stop = async (): Promise<void> => {
    await Promise.all(workers.map((w) => w.stop()));
    if (deps.shutdown) await deps.shutdown();
  };

  const gracefulShutdown = async (signal: string) => {
    workerLogger.info({ signal }, 'Shutdown signal received — draining workers');
    await stop();
    process.exit(0);
  };

  process.on('SIGTERM', () => void gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => void gracefulShutdown('SIGINT'));

  return { workers, queue, stop };
}
