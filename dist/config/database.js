import { Pool } from 'pg';
import { env } from './env.js';
import { logger } from './logger.js';
import { isExpectedServerlessDisconnect, isTransientPostgresError, resolvePostgresSslConfig, } from './postgres-ssl.js';
const dbLogger = logger.child({ component: 'database' });
if (!env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set');
}
/**
 * Primary PostgreSQL connection pool.
 *
 * Tuned for managed Postgres / Neon-style poolers:
 * - env-driven pool size so API, workers, and log DB pools do not over-subscribe
 * - no required warm idle clients by default; serverless poolers can close idle sockets
 * - server-side statement timeout bounds runaway SQL
 * - client-side query timeout is disabled by default because it can abort healthy
 *   remote queries during cold starts or transient network latency
 */
export const pool = new Pool({
    connectionString: env.DATABASE_URL,
    ssl: resolvePostgresSslConfig(env.DATABASE_URL, {
        enabled: env.DB_SSL_ENABLED,
        rejectUnauthorized: env.DB_SSL_REJECT_UNAUTHORIZED,
    }),
    max: env.DB_POOL_MAX,
    min: env.DB_POOL_MIN,
    idleTimeoutMillis: env.DB_IDLE_TIMEOUT_MS,
    connectionTimeoutMillis: env.DB_CONNECTION_TIMEOUT_MS,
    statement_timeout: env.DB_STATEMENT_TIMEOUT_MS,
    query_timeout: env.DB_QUERY_TIMEOUT_MS,
    application_name: `api_monitoring_${env.NODE_ENV}`,
    keepAlive: true,
    keepAliveInitialDelayMillis: env.DB_KEEPALIVE_INITIAL_DELAY_MS,
});
// Pool lifecycle events — only actionable events are logged.
// 'acquire' is intentionally omitted: it fires on every query and produces
// excessive noise at scale (~360K lines/hour at 100 QPS).
pool.on('connect', () => {
    dbLogger.debug('New connection added to pool');
});
pool.on('remove', () => {
    dbLogger.debug('Connection removed from pool');
});
pool.on('error', (err) => {
    if (isExpectedServerlessDisconnect(err)) {
        dbLogger.debug({ err: err.message }, 'Idle database connection closed by server (Neon/PgBouncer); pool will reconnect.');
        return;
    }
    dbLogger.error({ err }, 'Unexpected database pool error');
});
/**
 * Test connection on startup (fail-fast pattern).
 * Should be called during bootstrap BEFORE the HTTP server starts listening.
 */
export const connectDB = async () => {
    const client = await pool.connect();
    try {
        const res = await client.query('SELECT NOW() AS time, current_database() AS db');
        dbLogger.info({ db: res.rows[0]?.db, serverTime: res.rows[0]?.time }, 'Primary database connected');
    }
    finally {
        client.release();
    }
};
/**
 * Query helper with duration tracking and transient connection retry.
 * Automatically retries if a serverless host dropped the idle socket
 * before or during connection checkout.
 * Slow queries (>1s) are logged at warn level for investigation.
 */
export const query = async (text, params) => {
    const maxRetries = 2;
    let attempt = 0;
    while (true) {
        const start = Date.now();
        try {
            const result = await pool.query(text, params);
            const duration = Date.now() - start;
            if (duration > 1000) {
                dbLogger.warn({ query: text.slice(0, 120), duration, rows: result.rowCount }, 'Slow query');
            }
            else {
                dbLogger.debug({ query: text.slice(0, 80), duration, rows: result.rowCount }, 'Query executed');
            }
            return result;
        }
        catch (err) {
            attempt++;
            if (attempt <= maxRetries && isTransientPostgresError(err)) {
                const delayMs = 150 * attempt;
                dbLogger.debug({ attempt, maxRetries, delayMs, err: err?.message || String(err) }, 'Transient database connection error in query; retrying...');
                await new Promise((resolve) => setTimeout(resolve, delayMs));
                continue;
            }
            dbLogger.error({ err, query: text.slice(0, 120) }, 'Query failed');
            throw err;
        }
    }
};
/**
 * Graceful shutdown — drains active connections before closing.
 */
export const closeDatabase = async () => {
    dbLogger.info('Closing primary database pool');
    await pool.end();
    dbLogger.info('Primary database pool closed');
};
//# sourceMappingURL=database.js.map