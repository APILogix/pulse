/**
 * Ingestion worker process bootstrap (v3 tier).
 *
 * A dedicated OS process that drains the pg-boss ingestion queues and persists
 * telemetry. Kept SEPARATE from the API tier (PM2 cluster) so heavy
 * persistence work never steals CPU from request acceptance, and from the
 * general background-worker process (workers/main.ts) so the ingestion tier
 * can be scaled and tuned independently.
 *
 * Run with:
 *   npm run start:ingestion           (node dist/shared/workers/ingestion-worker-main.js)
 *   npm run dev:ingestion             (tsx watch src/shared/workers/ingestion-worker-main.ts)
 *
 * Horizontal scaling: run multiple copies. pg-boss hands each job to exactly
 * one worker across all processes/nodes, and idempotent inserts plus
 * retry-safe usage accounting make redelivery harmless.
 *
 * Process model:
 *   - One dedicated primary Postgres pool (max INGESTION_DB_POOL_SIZE,
 *     application_name='pulse_ingestion_workers') for queue, usage and billing state.
 *   - The shared Log DB primary pool for event persistence and analytics tables.
 *   - The pg-boss singleton (its own pool) drives delivery.
 *   - One WorkerRegistry that owns the per-type worker pools, the tenant
 *     fairness gate, the DLQ intake worker, the usage-rollup cron and the
 *     metrics HTTP endpoint.
 *   - SIGTERM/SIGINT trigger a graceful drain (offWork waits for in-flight
 *     jobs, final usage flush, then pools close) before exit.
 */
import { Pool } from 'pg';
import { env } from '../../config/env.js';
import { logDB } from '../../config/log-database.js';
import { logger } from '../../config/logger.js';
import { isExpectedServerlessDisconnect, resolvePostgresSslConfig } from '../../config/postgres-ssl.js';
import { startPgBoss, stopPgBoss } from '../../lib/pgboss.js';
import { WorkerRegistry } from '../../modules/ingestion/workers/worker-registry.js';
import { applyLogDbMigrations } from '../logdb/migrations.js';

const log = logger.child({ component: 'ingestion-worker-main' });

class IngestionWorkerProcess {
  private pool: Pool | null = null;
  /**
   * Dedicated telemetry WRITE pool — see `createTelemetryWritePool()`.
   * Separate from `logDB`'s shared primary pool so ingest writes have their own
   * bounded, correctly-sized connection budget.
   */
  private writePool: Pool | null = null;
  private registry: WorkerRegistry | null = null;
  private shuttingDown = false;

  async start(): Promise<void> {
    this.pool = new Pool({
      connectionString: env.DATABASE_URL,
      ssl: resolvePostgresSslConfig(env.DATABASE_URL, {
        enabled: env.DB_SSL_ENABLED,
        rejectUnauthorized: env.DB_SSL_REJECT_UNAUTHORIZED,
      }),
      max: env.INGESTION_DB_POOL_SIZE,
      idleTimeoutMillis: env.INGESTION_DB_IDLE_TIMEOUT_MS,
      connectionTimeoutMillis: env.INGESTION_DB_CONNECTION_TIMEOUT_MS,
      application_name: `pulse_ingestion_workers_${env.NODE_ENV}`,
      keepAlive: true,
      keepAliveInitialDelayMillis: env.DB_KEEPALIVE_INITIAL_DELAY_MS,
    });
    this.pool.on('error', (err: Error) => {
      if (isExpectedServerlessDisconnect(err)) {
        log.debug({ err: err.message }, 'Idle ingestion worker pool connection closed by server (Neon/PgBouncer)');
        return;
      }
      log.error({ err }, 'Ingestion worker pool error');
    });

    // Fail fast if either required database is unreachable at boot.
    await this.pool.query('SELECT 1');
    await logDB.connect();
    if (env.LOG_DB_AUTO_MIGRATE) {
      const migrationResult = await applyLogDbMigrations(logDB.getPrimaryPool(), {
        logger: log,
        executionMode: 'automatic',
      });
      if (migrationResult.deferred > 0) {
        log.warn(
          { deferredMigrations: migrationResult.deferred },
          'Operator-drained Log DB migrations remain pending; continuing ingestion worker startup',
        );
      }
    } else {
      log.warn('LOG_DB_AUTO_MIGRATE=false; ingestion worker will assume Log DB migrations are already applied');
    }

    // pg-boss must be started before any work/schedule/send call.
    await startPgBoss();

    this.writePool = this.createTelemetryWritePool();
    this.registry = new WorkerRegistry(this.pool, log, this.writePool);
    await this.registry.start();

    this.installSignalHandlers();

    // Signal readiness to a process supervisor (PM2 wait_ready), if listening.
    process.send?.('ready');
    log.info('Ingestion worker process started');
  }

  /**
   * Dedicated telemetry write pool for this process.
   *
   * WHY NOT JUST USE `logDB.getPrimaryPool()`
   * -----------------------------------------
   * The shared Log DB pool is sized by `LOG_POOL_MAX`, a single global knob that
   * has to serve two completely different workloads: dashboard/API reads in the
   * API process and batch ingest writes here. Sizing it for one starves the
   * other, and every ingest transaction holds its connection for the whole
   * BEGIN..COMMIT, so a write burst could exhaust the pool that the health
   * probe and the outbox reader also depend on.
   *
   * Giving the writer its own pool (`INGESTION_WRITE_POOL_SIZE`) means:
   *   - Ingest write capacity is tunable independently of API read capacity.
   *   - `resolveWritePermits()` in EventProcessor reads THIS pool's `max`, so
   *     the admission semaphore is provably aligned with real capacity. Sharing
   *     a pool would make that alignment a guess.
   *   - `application_name` distinguishes ingest writers in `pg_stat_activity`,
   *     which is what makes connection-level forensics possible at all.
   *
   * `logDB` is still used for connect-time verification, migrations and reads —
   * this pool is exclusively the ingest write path.
   *
   * Deliberately NO pool-level `statement_timeout`: the bound is applied
   * per-transaction by `applyIngestionTransactionSettings()` via `SET LOCAL`, so
   * it can never leak onto a pooled connection and be inherited by unrelated
   * maintenance work.
   */
  private createTelemetryWritePool(): Pool {
    const connectionString = env.LOG_DB_PRIMARY ?? env.DATABASE_URL;
    const pool = new Pool({
      connectionString,
      ssl: resolvePostgresSslConfig(connectionString, {
        enabled: env.LOG_DB_SSL_ENABLED,
        rejectUnauthorized: env.LOG_DB_SSL_REJECT_UNAUTHORIZED,
      }),
      max: env.INGESTION_WRITE_POOL_SIZE,
      // Keep a warm floor: ingest is continuous, so paying TCP+TLS handshake on
      // every batch would show up directly in dbConnectionWaitMs.
      min: Math.min(2, env.INGESTION_WRITE_POOL_SIZE),
      idleTimeoutMillis: env.LOG_DB_IDLE_TIMEOUT,
      connectionTimeoutMillis: env.LOG_DB_CONNECTION_TIMEOUT,
      application_name: `pulse_ingestion_writes_${env.NODE_ENV}`,
      keepAlive: env.LOG_DB_KEEPALIVE_MS > 0,
      keepAliveInitialDelayMillis: env.LOG_DB_KEEPALIVE_MS,
      allowExitOnIdle: false,
    });
    pool.on('error', (err: Error) => {
      if (isExpectedServerlessDisconnect(err)) {
        log.debug({ err: err.message }, 'Idle telemetry write pool connection closed by server (Neon/PgBouncer)');
        return;
      }
      log.error({ err }, 'Telemetry write pool error');
    });
    log.info(
      { max: env.INGESTION_WRITE_POOL_SIZE, writeConcurrency: env.INGESTION_WRITE_CONCURRENCY },
      'Dedicated telemetry write pool created',
    );
    return pool;
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
      // Order matters: registry.stop() waits for in-flight jobs (offWork
      // { wait: true }), so the write pool must outlive it or a draining
      // transaction would lose its connection mid-COMMIT.
      if (this.registry) await this.registry.stop();
      await stopPgBoss();
      await logDB.close();
      if (this.writePool) await this.writePool.end();
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
