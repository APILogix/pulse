/**
 * Dedicated analytics worker process (Supabase PGMQ).
 *
 * Spec: docs/analytics/06-worker-architecture.md §1
 */

import '../../config/dns.js';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { Pool } from 'pg';
import { env } from '../../config/env.js';
import { logProcessConnectionBudget } from '../../config/connection-budget.js';
import { retryConfiguredStartupOperation } from '../../config/startup-retry.js';
import { logger } from '../../config/logger.js';
import {
  checkPostgresHealth,
  getSafePostgresConnectionMetadata,
  withPostgresAddressFamily,
  type PostgresHealthFailure,
} from '../../config/postgres-network.js';
import {
  isExpectedServerlessDisconnect,
  resolvePostgresSslConfig,
  sanitizePostgresConnectionString,
} from '../../config/postgres-ssl.js';
import { pgmq } from '../../lib/pgmq.js';
import {
  registerAnalyticsEngineWorkers,
  type AnalyticsEngineRuntime,
} from '../../modules/analytics-engine/queue.js';
import { AnalyticsWatermarkRepository } from '../../modules/analytics-engine/watermark.repository.js';
import { ensurePartitions } from '../../modules/analytics-engine/workers/maintenance.worker.js';

const workerLogger = logger.child({ component: 'analytics-workers' });
const startedAt = Date.now();
let activeAnalyticsPool: Pool | null = null;
let activeAnalyticsRuntime: AnalyticsEngineRuntime | null = null;

function logDbConnectionString(): string {
  const connectionString = env.LOG_DB_PRIMARY ?? env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('Analytics engine requires LOG_DB_PRIMARY (or DATABASE_URL) to be set');
  }
  return connectionString;
}

interface HealthPayload {
  status: 'healthy' | 'degraded' | 'unhealthy';
  uptimeSeconds: number;
  logDb: 'connected' | 'disconnected';
  logDbFailure?: PostgresHealthFailure;
  queue: 'connected' | 'disconnected';
  workers: Array<Record<string, unknown>>;
  worstLagSeconds: number;
}

async function buildHealth(
  pool: Pool,
  watermarks: AnalyticsWatermarkRepository,
  queueReady: boolean,
): Promise<HealthPayload> {
  const databaseHealth = await checkPostgresHealth(pool);
  const logDb: HealthPayload['logDb'] = databaseHealth.healthy ? 'connected' : 'disconnected';

  let snapshots: Awaited<ReturnType<AnalyticsWatermarkRepository['healthSnapshot']>> = [];
  try {
    snapshots = await watermarks.healthSnapshot();
  } catch (error) {
    workerLogger.warn({ err: error }, 'Could not read analytics watermark health');
  }

  const worstLagSeconds = snapshots.reduce((max, snapshot) => Math.max(max, snapshot.lagSeconds), 0);
  const staleThreshold = env.ANALYTICS_FRESHNESS_STALE_SECONDS * 2;
  const anyUnhealthy = snapshots.some((snapshot) => snapshot.status === 'unhealthy');

  let status: HealthPayload['status'] = 'healthy';
  if (logDb === 'disconnected' || !queueReady || anyUnhealthy) status = 'unhealthy';
  else if (worstLagSeconds > staleThreshold) status = 'degraded';

  return {
    status,
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1_000),
    logDb,
    ...(!databaseHealth.healthy ? { logDbFailure: databaseHealth.failure } : {}),
    queue: queueReady ? 'connected' : 'disconnected',
    workers: snapshots.map((snapshot) => ({ ...snapshot })),
    worstLagSeconds,
  };
}

interface RunMetricsRow {
  worker_id: string;
  outcome: string;
  runs: string;
  rows_read: string;
  rows_written: string;
  p95: string | null;
}
let cachedRunMetrics: { rows: RunMetricsRow[]; expiresAt: number } | null = null;
const RUN_METRICS_CACHE_TTL_MS = 30_000;

/** Prometheus text exposition built from the watermark + run ledger. */
async function buildMetrics(
  pool: Pool,
  watermarks: AnalyticsWatermarkRepository,
): Promise<string> {
  const lines: string[] = [];
  const push = (name: string, help: string, type: string, samples: string[]): void => {
    if (samples.length === 0) return;
    lines.push(`# HELP ${name} ${help}`);
    lines.push(`# TYPE ${name} ${type}`);
    lines.push(...samples);
  };

  const snapshots = await watermarks.healthSnapshot().catch(() => []);
  push(
    'analytics_worker_watermark_lag_seconds',
    'Seconds between now and the oldest watermark for the worker.',
    'gauge',
    snapshots.map((snapshot) => `analytics_worker_watermark_lag_seconds{worker="${snapshot.id}"} ${snapshot.lagSeconds}`),
  );
  push(
    'analytics_worker_consecutive_failures',
    'Consecutive failed runs per worker.',
    'gauge',
    snapshots.map((snapshot) => `analytics_worker_consecutive_failures{worker="${snapshot.id}"} ${snapshot.consecutiveFailures}`),
  );

  let runs: RunMetricsRow[];
  const now = Date.now();
  if (cachedRunMetrics && cachedRunMetrics.expiresAt > now) {
    runs = cachedRunMetrics.rows;
  } else {
    runs = await pool
      .query<RunMetricsRow>(
        `SELECT worker_id, outcome,
                COUNT(*)::bigint                                        AS runs,
                COALESCE(SUM(rows_read), 0)::bigint                     AS rows_read,
                COALESCE(SUM(rows_written), 0)::bigint                  AS rows_written,
                PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95
           FROM analytics_worker_runs
          WHERE started_at >= NOW() - INTERVAL '1 hour'
          GROUP BY worker_id, outcome`,
      )
      .then((result) => {
        cachedRunMetrics = { rows: result.rows, expiresAt: Date.now() + RUN_METRICS_CACHE_TTL_MS };
        return result.rows;
      })
      .catch(() => cachedRunMetrics?.rows ?? []);
  }

  push(
    'analytics_worker_runs_total',
    'Worker runs in the last hour by outcome.',
    'counter',
    runs.map((row) => `analytics_worker_runs_total{worker="${row.worker_id}",outcome="${row.outcome}"} ${Number(row.runs)}`),
  );
  push(
    'analytics_worker_rows_read_total',
    'Rows read from telemetry in the last hour.',
    'counter',
    runs.map((row) => `analytics_worker_rows_read_total{worker="${row.worker_id}",outcome="${row.outcome}"} ${Number(row.rows_read)}`),
  );
  push(
    'analytics_worker_rows_written_total',
    'Rollup rows written in the last hour.',
    'counter',
    runs.map((row) => `analytics_worker_rows_written_total{worker="${row.worker_id}",outcome="${row.outcome}"} ${Number(row.rows_written)}`),
  );
  push(
    'analytics_worker_run_duration_ms',
    'p95 worker run duration over the last hour.',
    'gauge',
    runs
      .filter((row) => row.p95 !== null)
      .map((row) => `analytics_worker_run_duration_ms{worker="${row.worker_id}",quantile="0.95"} ${Number(row.p95)}`),
  );

  return `${lines.join('\n')}\n`;
}

async function bootstrap(): Promise<void> {
  logProcessConnectionBudget('analytics', workerLogger);
  if (!env.ANALYTICS_ENGINE_ENABLED) {
    workerLogger.warn('ANALYTICS_ENGINE_ENABLED=false — analytics worker process exiting');
    return;
  }

  const connectionString = logDbConnectionString();
  const ssl = resolvePostgresSslConfig(connectionString, {
    enabled: env.LOG_DB_SSL_ENABLED,
    rejectUnauthorized: env.LOG_DB_SSL_REJECT_UNAUTHORIZED,
  });
  const pool = new Pool(withPostgresAddressFamily({
    connectionString: sanitizePostgresConnectionString(connectionString),
    ssl,
    max: env.ANALYTICS_DB_POOL_MAX,
    min: 0,
    idleTimeoutMillis: env.LOG_DB_IDLE_TIMEOUT,
    connectionTimeoutMillis: env.LOG_DB_CONNECTION_TIMEOUT,
    application_name: `pulse_analytics_workers_${env.NODE_ENV}`,
    keepAlive: true,
    keepAliveInitialDelayMillis: env.LOG_DB_KEEPALIVE_MS,
  }, env.DB_FAMILY));
  activeAnalyticsPool = pool;

  workerLogger.info(
    getSafePostgresConnectionMetadata(connectionString, {
      family: env.DB_FAMILY,
      ssl,
      poolMax: env.ANALYTICS_DB_POOL_MAX,
      poolMin: 0,
    }),
    'Analytics PostgreSQL configuration',
  );

  pool.on('connect', (client) => {
    client.on('error', (error: Error) => {
      if (isExpectedServerlessDisconnect(error)) {
        workerLogger.debug({ err: error.message }, 'Client analytics worker Log DB connection closed by server (Supabase/PgBouncer)');
        return;
      }
      workerLogger.debug({ err: error.message }, 'PostgreSQL client socket error on active/checked-out analytics connection');
    });
  });

  pool.on('error', (error: Error) => {
    if (isExpectedServerlessDisconnect(error)) {
      workerLogger.debug({ err: error.message }, 'Idle analytics worker Log DB pool connection closed by server (Supabase/PgBouncer)');
      return;
    }
    workerLogger.error({ err: error }, 'Analytics Log DB pool error');
  });

  await retryConfiguredStartupOperation(
    'analytics log database',
    () => pool.query('SELECT 1'),
    workerLogger,
  );

  const watermarks = new AnalyticsWatermarkRepository(pool);
  if (env.ANALYTICS_POOL_ASSERT) {
    await watermarks.assertLogDbPool(workerLogger);
  } else {
    workerLogger.warn('ANALYTICS_POOL_ASSERT=false — skipping Log DB ownership assertion');
  }

  await ensurePartitions(pool, workerLogger, 7);

  // Pre-load all existing queue metadata once to eliminate sequential DDL round-trips
  await pgmq.ensureKnownQueuesLoaded();

  let queueReady = true;
  let runtime: AnalyticsEngineRuntime | null = null;
  runtime = await registerAnalyticsEngineWorkers(pool, workerLogger);
  activeAnalyticsRuntime = runtime;

  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const url = request.url ?? '/';
    if (url.startsWith('/health')) {
      void buildHealth(pool, watermarks, queueReady)
        .then((payload) => {
          response.writeHead(payload.status === 'unhealthy' ? 503 : 200, {
            'content-type': 'application/json',
          });
          response.end(JSON.stringify(payload));
        })
        .catch(() => {
          response.writeHead(500, { 'content-type': 'application/json' });
          response.end(JSON.stringify({ status: 'unhealthy' }));
        });
      return;
    }
    if (url.startsWith('/metrics')) {
      void buildMetrics(pool, watermarks)
        .then((body) => {
          response.writeHead(200, { 'content-type': 'text/plain; version=0.0.4' });
          response.end(body);
        })
        .catch(() => {
          response.writeHead(500, { 'content-type': 'text/plain' });
          response.end('# metrics unavailable\n');
        });
      return;
    }
    response.writeHead(404, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: 'not_found', paths: ['/health', '/metrics'] }));
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (err: NodeJS.ErrnoException): void => {
      server.off('listening', onListening);
      reject(err);
    };
    const onListening = (): void => {
      server.off('error', onError);
      workerLogger.info(
        { port: env.ANALYTICS_HEALTH_PORT },
        'Analytics worker health/metrics endpoint listening',
      );
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(env.ANALYTICS_HEALTH_PORT);
  });

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    queueReady = false;
    workerLogger.info({ signal }, 'Analytics worker shutdown signal received — draining');
    const deadline = setTimeout(() => {
      workerLogger.fatal({ signal }, 'Analytics worker shutdown deadline exceeded');
      process.exit(1);
    }, env.SHUTDOWN_TIMEOUT_MS);
    deadline.unref();

    const serverClose = new Promise<void>((resolve) => server.close(() => resolve()));
    const runtimeStop = runtime ? runtime.stop() : Promise.resolve();
    const stopResults = await Promise.allSettled([serverClose, runtimeStop]);
    const closeResults = await Promise.allSettled([pgmq.close(), pool.end()]);
    activeAnalyticsRuntime = null;
    activeAnalyticsPool = null;
    clearTimeout(deadline);
    const failed = [...stopResults, ...closeResults].some((result) => result.status === 'rejected');
    process.exit(failed ? 1 : 0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  process.send?.('ready');
  workerLogger.info(
    { workers: runtime.workers.length },
    'Analytics worker process started with Supabase PGMQ',
  );
}

bootstrap().catch(async (error: unknown) => {
  workerLogger.fatal({ err: error }, 'Failed to start analytics worker process');
  await Promise.allSettled([
    activeAnalyticsRuntime?.stop(),
    pgmq.close(),
    activeAnalyticsPool?.end(),
  ].filter((operation): operation is Promise<void> => operation !== undefined));
  process.exit(1);
});
