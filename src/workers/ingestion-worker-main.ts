/**
 * Ingestion worker process bootstrap (v2 tier).
 *
 * A dedicated OS process that drains the PostgreSQL ingestion queue and
 * persists telemetry. Kept SEPARATE from the API tier (PM2 cluster) so heavy
 * persistence work never steals CPU from request acceptance, and from the
 * general background-worker process (workers/main.ts) so the ingestion tier can
 * be scaled and tuned independently.
 *
 * Run with:
 *   npm run start:ingestion           (node dist/workers/ingestion-worker-main.js)
 *   npm run dev:ingestion             (tsx watch src/workers/ingestion-worker-main.ts)
 *
 * Horizontal scaling: run multiple copies. FOR UPDATE SKIP LOCKED guarantees a
 * job is processed by exactly one worker across all processes/nodes.
 *
 * Process model:
 *   - One dedicated Postgres pool (max INGESTION_DB_POOL_SIZE,
 *     application_name='pulse_ingestion_workers').
 *   - One WorkerRegistry that owns the general/specialized/retry/maintenance
 *     worker classes plus the usage counter, admin logger and TimescaleDB
 *     logging database.
 *   - SIGTERM/SIGINT trigger a graceful drain (waits for in-flight jobs, final
 *     flushes, then closes pools) before exit.
 */
import { Pool } from 'pg';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { WorkerRegistry } from '../modules/ingestion/workers/worker-registry.js';

const log = logger.child({ component: 'ingestion-worker-main' });

class IngestionWorkerProcess {
  private pool: Pool | null = null;
  private registry: WorkerRegistry | null = null;
  private shuttingDown = false;

  async start(): Promise<void> {
    this.pool = new Pool({
      connectionString: env.DATABASE_URL,
      max: env.INGESTION_DB_POOL_SIZE,
      idleTimeoutMillis: env.INGESTION_DB_IDLE_TIMEOUT_MS,
      connectionTimeoutMillis: env.INGESTION_DB_CONNECTION_TIMEOUT_MS,
      application_name: `pulse_ingestion_workers_${env.NODE_ENV}`,
      keepAlive: true,
    });
    this.pool.on('error', (err) =>
      log.error({ err }, 'Ingestion worker pool error (idle connection lost)'),
    );

    // Fail fast if the database is unreachable at boot.
    await this.pool.query('SELECT 1');

    this.registry = new WorkerRegistry(this.pool, log);
    await this.registry.start();

    this.installSignalHandlers();

    // Signal readiness to a process supervisor (PM2 wait_ready), if listening.
    process.send?.('ready');
    log.info('Ingestion worker process started');
  }

  private installSignalHandlers(): void {
    const onSignal = (signal: string) => {
      void this.shutdown(signal);
    };
    process.on('SIGTERM', () => onSignal('SIGTERM'));
    process.on('SIGINT', () => onSignal('SIGINT'));
    process.on('uncaughtException', (err) => {
      log.fatal({ err }, 'Uncaught exception in ingestion worker');
      void this.shutdown('uncaughtException', 1);
    });
    process.on('unhandledRejection', (reason) => {
      log.error({ reason }, 'Unhandled rejection in ingestion worker');
    });
  }

  private async shutdown(signal: string, code = 0): Promise<void> {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    log.info({ signal }, 'Ingestion worker shutting down — draining');
    try {
      if (this.registry) await this.registry.stop();
      if (this.pool) await this.pool.end();
    } catch (err) {
      log.error({ err }, 'Error during ingestion worker shutdown');
      code = code || 1;
    } finally {
      log.info('Ingestion worker shutdown complete');
      process.exit(code);
    }
  }
}

new IngestionWorkerProcess().start().catch((err) => {
  log.fatal({ err }, 'Failed to start ingestion worker process');
  process.exit(1);
});
