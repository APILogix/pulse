/**
 * Ingestion worker process bootstrap (Supabase PGMQ tier).
 *
 * Dedicated OS process that drains Supabase PGMQ ingestion queues and persists
 * telemetry.
 */
import '../../config/dns.js';
import { Pool, type PoolClient } from 'pg';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import {
  getSafePostgresConnectionMetadata,
  withPostgresAddressFamily,
} from '../../config/postgres-network.js';
import {
  isExpectedServerlessDisconnect,
  resolvePostgresSslConfig,
  sanitizePostgresConnectionString,
} from '../../config/postgres-ssl.js';
import { pgmq } from '../../lib/pgmq.js';
import { WorkerRegistry } from '../../modules/ingestion/workers/worker-registry.js';
import { applyLogDbMigrations } from '../logdb/migrations.js';
import { logProcessConnectionBudget } from '../../config/connection-budget.js';
import { retryConfiguredStartupOperation } from '../../config/startup-retry.js';

const log = logger.child({ component: 'ingestion-worker-main' });

class IngestionWorkerProcess {
  private pool: Pool | null = null;
  private writePool: Pool | null = null;
  private registry: WorkerRegistry | null = null;
  private migrationPromise: Promise<unknown> | null = null;
  private asyncCommitEnabled = false;
  private shuttingDown = false;

  async start(): Promise<void> {
    this.installSignalHandlers();
    logProcessConnectionBudget('ingestion', log);

    // KVM 4 optimal default: 6 control-plane connections (usage flushes + metadata lookups)
    const maxPrimary = env.INGESTION_DB_POOL_SIZE ?? Math.min(env.DB_POOL_MAX ?? 6, 8);
    const primarySsl = resolvePostgresSslConfig(env.DATABASE_URL, {
      enabled: env.DB_SSL_ENABLED,
      rejectUnauthorized: env.DB_SSL_REJECT_UNAUTHORIZED,
    });

    this.pool = new Pool(withPostgresAddressFamily({
      connectionString: sanitizePostgresConnectionString(env.DATABASE_URL),
      ssl: primarySsl,
      max: maxPrimary,
      min: 0,
      idleTimeoutMillis: env.DB_IDLE_TIMEOUT_MS ?? 30000,
      connectionTimeoutMillis: env.DB_CONNECTION_TIMEOUT_MS ?? 30000,
      statement_timeout: env.DB_STATEMENT_TIMEOUT_MS ?? 30000,
      query_timeout: env.DB_QUERY_TIMEOUT_MS ?? 0,
      application_name: `pulse_ingestion_workers_${env.NODE_ENV}`,
      keepAlive: true,
      keepAliveInitialDelayMillis: env.DB_KEEPALIVE_INITIAL_DELAY_MS ?? 10000,
    }, env.DB_FAMILY));

    log.info(
      getSafePostgresConnectionMetadata(env.DATABASE_URL, {
        family: env.DB_FAMILY,
        ssl: primarySsl,
        poolMax: maxPrimary,
        poolMin: 0,
      }),
      'Ingestion control PostgreSQL configuration',
    );

    this.pool.on('connect', (client) => {
      client.on('error', (err: Error) => {
        if (isExpectedServerlessDisconnect(err)) {
          log.debug({ err: err.message }, 'Client connection closed by serverless host');
          return;
        }
        log.debug({ err: err.message }, 'PostgreSQL client socket error on active connection');
      });
    });

    this.pool.on('error', (err: Error) => {
      if (isExpectedServerlessDisconnect(err)) {
        log.debug({ err: err.message }, 'Idle ingestion worker pool connection closed by server (Supabase/PgBouncer)');
        return;
      }
      log.error({ err }, 'Ingestion worker pool error');
    });

    await retryConfiguredStartupOperation(
      'ingestion control database',
      () => this.pool!.query('SELECT 1'),
      log,
    );

    this.writePool = this.createTelemetryWritePool();
    await retryConfiguredStartupOperation(
      'ingestion write database',
      () => this.writePool!.query('SELECT 1'),
      log,
    );

    // Run LogDB migrations BEFORE enabling synchronous_commit = off so DDL changes
    // are guaranteed to be durably fsynced to WAL before workers start.
    if (env.LOG_DB_AUTO_MIGRATE) {
      this.migrationPromise = applyLogDbMigrations(this.writePool, {
        logger: log,
        executionMode: 'automatic',
      });
      try {
        const migrationResult = (await this.migrationPromise) as { deferred: number };
        if (migrationResult.deferred > 0) {
          log.warn(
            { deferredMigrations: migrationResult.deferred },
            'Operator-drained Log DB migrations remain pending; continuing ingestion worker startup',
          );
        }
      } finally {
        this.migrationPromise = null;
      }
    }

    if (this.shuttingDown) return;

    // Enable asynchronous WAL commit only after migrations have completed
    await this.enableAsyncCommitOnWritePool();

    this.registry = new WorkerRegistry(this.pool, log, this.writePool);
    await this.registry.start();

    process.send?.('ready');
    log.info('Ingestion worker process started with Supabase PGMQ');
  }

  private createTelemetryWritePool(): Pool {
    // Prefer dedicated direct URL (port 5433) so bulk UNNEST writes and migrations
    // bypass PgBouncer transaction mode while API reads/writes use PgBouncer (port 6432).
    const connectionString =
      env.LOG_DB_DIRECT_URL ?? env.LOG_DB_PRIMARY ?? env.DATABASE_URL;
    const ssl = resolvePostgresSslConfig(connectionString, {
      enabled: env.LOG_DB_SSL_ENABLED,
      rejectUnauthorized: env.LOG_DB_SSL_REJECT_UNAUTHORIZED,
    });

    const writePool = new Pool(withPostgresAddressFamily({
      connectionString: sanitizePostgresConnectionString(connectionString),
      ssl,
      max: env.INGESTION_WRITE_POOL_SIZE,
      min: 0,
      idleTimeoutMillis: env.LOG_DB_IDLE_TIMEOUT,
      connectionTimeoutMillis: env.LOG_DB_CONNECTION_TIMEOUT ?? env.DB_CONNECTION_TIMEOUT_MS ?? 30000,
      application_name: `pulse_ingestion_writes_${env.NODE_ENV}`,
      keepAlive: env.LOG_DB_KEEPALIVE_MS > 0,
      keepAliveInitialDelayMillis: env.LOG_DB_KEEPALIVE_MS,
      allowExitOnIdle: false,
    }, env.DB_FAMILY));

    log.info(
      getSafePostgresConnectionMetadata(connectionString, {
        family: env.DB_FAMILY,
        ssl,
        poolMax: env.INGESTION_WRITE_POOL_SIZE,
        poolMin: 0,
      }),
      'Ingestion write PostgreSQL configuration',
    );

    writePool.on('connect', (client: PoolClient) => {
      if (this.asyncCommitEnabled) {
        client.query('SET synchronous_commit = off').catch((err: Error) => {
          log.debug({ err: err.message }, 'Failed to set synchronous_commit = off on telemetry write client');
        });
      }

      client.on('error', (err: Error) => {
        if (isExpectedServerlessDisconnect(err)) {
          log.debug({ err: err.message }, 'Client telemetry write pool connection closed by serverless host');
          return;
        }
        log.debug({ err: err.message }, 'PostgreSQL client socket error on active telemetry write connection');
      });
    });

    writePool.on('error', (err: Error) => {
      if (isExpectedServerlessDisconnect(err)) {
        log.debug({ err: err.message }, 'Idle telemetry write pool connection closed by server (Supabase/PgBouncer)');
        return;
      }
      log.error({ err }, 'Telemetry write pool error');
    });
    return writePool;
  }

  private async enableAsyncCommitOnWritePool(): Promise<void> {
    this.asyncCommitEnabled = true;
    if (!this.writePool) return;
    // Apply to any warm connection already checked in from startup/migration checks
    try {
      await this.writePool.query('SET synchronous_commit = off');
    } catch (err: any) {
      log.debug({ err: err?.message }, 'Could not set initial synchronous_commit = off on writePool');
    }
  }

  private installSignalHandlers(): void {
    process.once('SIGTERM', () => void this.shutdown('SIGTERM'));
    process.once('SIGINT', () => void this.shutdown('SIGINT'));
    process.once('unhandledRejection', (reason) => {
      log.fatal({ reason }, 'Unhandled ingestion worker rejection');
      void this.shutdown('unhandledRejection', 1);
    });
    process.once('uncaughtException', (err) => {
      log.fatal({ err }, 'Uncaught ingestion worker exception');
      void this.shutdown('uncaughtException', 1);
    });
  }

  async shutdown(signal: string, initialCode = 0): Promise<void> {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    let exitCode = initialCode;
    log.info({ signal }, 'Ingestion worker shutting down cleanly');

    const timeout = setTimeout(() => {
      log.fatal({ signal }, 'Ingestion worker drain deadline exceeded — forcing exit');
      process.exit(exitCode || 1);
    }, env.SHUTDOWN_TIMEOUT_MS);
    timeout.unref();

    // Wait for any in-flight startup migration to finish before closing writePool
    if (this.migrationPromise) {
      await Promise.allSettled([this.migrationPromise]);
    }

    const stopResults = this.registry
      ? await Promise.allSettled([this.registry.stop()])
      : [];
    const closeResults = await Promise.allSettled([
      pgmq.close(),
      ...(this.writePool ? [this.writePool.end()] : []),
      ...(this.pool ? [this.pool.end()] : []),
    ]);
    if ([...stopResults, ...closeResults].some((result) => result.status === 'rejected')) {
      exitCode = exitCode || 1;
    }

    clearTimeout(timeout);
    log.info({ exitCode }, 'Ingestion worker stopped');
    process.exit(exitCode);
  }
}

const ingestionWorker = new IngestionWorkerProcess();
ingestionWorker.start().catch((err) => {
  log.fatal({ err }, 'Ingestion worker process failed to start');
  void ingestionWorker.shutdown('startupFailure', 1);
});
