/**
 * Dedicated analytics worker process.
 *
 * Spec: docs/analytics/06-worker-architecture.md §1
 *
 * Boot sequence:
 *   1. open a dedicated Log DB pool (small, so analytics can never starve the
 *      ingestion writer pool)
 *   2. assert this pool owns events_* and the rollups exist
 *   3. ensure partitions before any worker can write
 *   4. start pg-boss (supervise + schedule enabled for worker roles)
 *   5. register the analytics workers and the dispatcher
 *   6. expose health + Prometheus metrics
 *   7. drain cleanly on SIGTERM/SIGINT
 *
 * ISOLATION: this process registers NO ingestion queue and imports nothing from
 * src/modules/ingestion. Analytics never blocks ingestion
 * (docs/analytics/00-architecture-overview.md §3).
 */
import { createServer } from 'node:http';
import { Pool } from 'pg';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { isExpectedServerlessDisconnect, resolvePostgresSslConfig } from '../../config/postgres-ssl.js';
import { startPgBoss, stopPgBoss } from '../../lib/pgboss.js';
import { registerAnalyticsEngineWorkers, } from '../../modules/analytics-engine/queue.js';
import { AnalyticsWatermarkRepository } from '../../modules/analytics-engine/watermark.repository.js';
import { ensurePartitions } from '../../modules/analytics-engine/workers/maintenance.worker.js';
const workerLogger = logger.child({ component: 'analytics-workers' });
const startedAt = Date.now();
function logDbConnectionString() {
    const connectionString = env.LOG_DB_PRIMARY ?? env.DATABASE_URL;
    if (!connectionString) {
        throw new Error('Analytics engine requires LOG_DB_PRIMARY (or DATABASE_URL) to be set');
    }
    return connectionString;
}
async function buildHealth(pool, watermarks, queueReady) {
    let logDb = 'disconnected';
    try {
        await pool.query('SELECT 1');
        logDb = 'connected';
    }
    catch {
        logDb = 'disconnected';
    }
    let snapshots = [];
    try {
        snapshots = await watermarks.healthSnapshot();
    }
    catch (error) {
        workerLogger.warn({ err: error }, 'Could not read analytics watermark health');
    }
    const worstLagSeconds = snapshots.reduce((max, snapshot) => Math.max(max, snapshot.lagSeconds), 0);
    const staleThreshold = env.ANALYTICS_FRESHNESS_STALE_SECONDS * 2;
    const anyUnhealthy = snapshots.some((snapshot) => snapshot.status === 'unhealthy');
    let status = 'healthy';
    if (logDb === 'disconnected' || !queueReady || anyUnhealthy)
        status = 'unhealthy';
    else if (worstLagSeconds > staleThreshold)
        status = 'degraded';
    return {
        status,
        uptimeSeconds: Math.round((Date.now() - startedAt) / 1_000),
        logDb,
        queue: queueReady ? 'connected' : 'disconnected',
        workers: snapshots.map((snapshot) => ({ ...snapshot })),
        worstLagSeconds,
    };
}
/** Prometheus text exposition built from the watermark + run ledger. */
async function buildMetrics(pool, watermarks) {
    const lines = [];
    const push = (name, help, type, samples) => {
        if (samples.length === 0)
            return;
        lines.push(`# HELP ${name} ${help}`);
        lines.push(`# TYPE ${name} ${type}`);
        lines.push(...samples);
    };
    const snapshots = await watermarks.healthSnapshot().catch(() => []);
    push('analytics_worker_watermark_lag_seconds', 'Seconds between now and the oldest watermark for the worker.', 'gauge', snapshots.map((snapshot) => `analytics_worker_watermark_lag_seconds{worker="${snapshot.id}"} ${snapshot.lagSeconds}`));
    push('analytics_worker_consecutive_failures', 'Consecutive failed runs per worker.', 'gauge', snapshots.map((snapshot) => `analytics_worker_consecutive_failures{worker="${snapshot.id}"} ${snapshot.consecutiveFailures}`));
    const runs = await pool
        .query(`SELECT worker_id, outcome,
              COUNT(*)::bigint                                        AS runs,
              COALESCE(SUM(rows_read), 0)::bigint                     AS rows_read,
              COALESCE(SUM(rows_written), 0)::bigint                  AS rows_written,
              PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95
         FROM analytics_worker_runs
        WHERE started_at >= NOW() - INTERVAL '1 hour'
        GROUP BY worker_id, outcome`)
        .then((result) => result.rows)
        .catch(() => []);
    push('analytics_worker_runs_total', 'Worker runs in the last hour by outcome.', 'counter', runs.map((row) => `analytics_worker_runs_total{worker="${row.worker_id}",outcome="${row.outcome}"} ${Number(row.runs)}`));
    push('analytics_worker_rows_read_total', 'Rows read from telemetry in the last hour.', 'counter', runs.map((row) => `analytics_worker_rows_read_total{worker="${row.worker_id}",outcome="${row.outcome}"} ${Number(row.rows_read)}`));
    push('analytics_worker_rows_written_total', 'Rollup rows written in the last hour.', 'counter', runs.map((row) => `analytics_worker_rows_written_total{worker="${row.worker_id}",outcome="${row.outcome}"} ${Number(row.rows_written)}`));
    push('analytics_worker_run_duration_ms', 'p95 worker run duration over the last hour.', 'gauge', runs
        .filter((row) => row.p95 !== null)
        .map((row) => `analytics_worker_run_duration_ms{worker="${row.worker_id}",quantile="0.95"} ${Number(row.p95)}`));
    return `${lines.join('\n')}\n`;
}
async function bootstrap() {
    if (!env.ANALYTICS_ENGINE_ENABLED) {
        workerLogger.warn('ANALYTICS_ENGINE_ENABLED=false — analytics worker process exiting');
        return;
    }
    const connectionString = logDbConnectionString();
    const pool = new Pool({
        connectionString,
        ssl: resolvePostgresSslConfig(connectionString, {
            enabled: env.LOG_DB_SSL_ENABLED,
            rejectUnauthorized: env.LOG_DB_SSL_REJECT_UNAUTHORIZED,
        }),
        max: env.ANALYTICS_DB_POOL_MAX,
        min: 0,
        idleTimeoutMillis: env.LOG_DB_IDLE_TIMEOUT,
        connectionTimeoutMillis: env.LOG_DB_CONNECTION_TIMEOUT,
        application_name: `pulse_analytics_workers_${env.NODE_ENV}`,
        keepAlive: true,
        keepAliveInitialDelayMillis: env.LOG_DB_KEEPALIVE_MS,
    });
    pool.on('error', (error) => {
        if (isExpectedServerlessDisconnect(error)) {
            workerLogger.debug({ err: error.message }, 'Idle analytics worker Log DB pool connection closed by server (Neon/PgBouncer)');
            return;
        }
        workerLogger.error({ err: error }, 'Analytics Log DB pool error');
    });
    await pool.query('SELECT 1');
    const watermarks = new AnalyticsWatermarkRepository(pool);
    if (env.ANALYTICS_POOL_ASSERT) {
        await watermarks.assertLogDbPool(workerLogger);
    }
    else {
        workerLogger.warn('ANALYTICS_POOL_ASSERT=false — skipping Log DB ownership assertion');
    }
    // Partitions must exist before the first rollup write.
    await ensurePartitions(pool, workerLogger, 7);
    await startPgBoss();
    let queueReady = true;
    let runtime = null;
    runtime = await registerAnalyticsEngineWorkers(pool, workerLogger);
    const server = createServer((request, response) => {
        const url = request.url ?? '/';
        if (url.startsWith('/health')) {
            void buildHealth(pool, watermarks, queueReady)
                .then((payload) => {
                response.writeHead(payload.status === 'unhealthy' ? 503 : 200, {
                    'content-type': 'application/json',
                });
                response.end(JSON.stringify(payload));
            })
                .catch((error) => {
                response.writeHead(500, { 'content-type': 'application/json' });
                response.end(JSON.stringify({ status: 'unhealthy', error: String(error) }));
            });
            return;
        }
        if (url.startsWith('/metrics')) {
            void buildMetrics(pool, watermarks)
                .then((body) => {
                response.writeHead(200, { 'content-type': 'text/plain; version=0.0.4' });
                response.end(body);
            })
                .catch((error) => {
                response.writeHead(500, { 'content-type': 'text/plain' });
                response.end(`# metrics unavailable: ${String(error)}\n`);
            });
            return;
        }
        response.writeHead(404, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: 'not_found', paths: ['/health', '/metrics'] }));
    });
    server.listen(env.ANALYTICS_HEALTH_PORT, () => {
        workerLogger.info({ port: env.ANALYTICS_HEALTH_PORT }, 'Analytics worker health/metrics endpoint listening');
    });
    let shuttingDown = false;
    const shutdown = async (signal) => {
        if (shuttingDown)
            return;
        shuttingDown = true;
        workerLogger.info({ signal }, 'Analytics worker shutdown signal received — draining');
        server.close();
        if (runtime)
            await runtime.stop();
        await stopPgBoss();
        queueReady = false;
        await pool.end();
        process.exit(0);
    };
    process.on('SIGTERM', () => void shutdown('SIGTERM'));
    process.on('SIGINT', () => void shutdown('SIGINT'));
    process.send?.('ready');
    workerLogger.info({ workers: runtime.workers.length }, 'Analytics worker process started (independent of ingestion)');
}
bootstrap().catch((error) => {
    workerLogger.fatal({ err: error }, 'Failed to start analytics worker process');
    process.exit(1);
});
//# sourceMappingURL=analytics-worker-main.js.map