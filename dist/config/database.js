import './dns.js';
import { Pool } from 'pg';
import { env } from './env.js';
import { logger } from './logger.js';
import { getSafePostgresConnectionMetadata, withPostgresAddressFamily, } from './postgres-network.js';
import { isExpectedServerlessDisconnect, isTransientPostgresError, resolvePostgresSslConfig, sanitizePostgresConnectionString, } from './postgres-ssl.js';
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
const primarySsl = resolvePostgresSslConfig(env.DATABASE_URL, {
    enabled: env.DB_SSL_ENABLED,
    rejectUnauthorized: env.DB_SSL_REJECT_UNAUTHORIZED,
});
const primaryPoolConfig = withPostgresAddressFamily({
    connectionString: sanitizePostgresConnectionString(env.DATABASE_URL),
    ssl: primarySsl,
    max: env.DB_POOL_MAX,
    min: env.DB_POOL_MIN,
    idleTimeoutMillis: env.DB_IDLE_TIMEOUT_MS,
    connectionTimeoutMillis: env.DB_CONNECTION_TIMEOUT_MS,
    statement_timeout: env.DB_STATEMENT_TIMEOUT_MS,
    query_timeout: env.DB_QUERY_TIMEOUT_MS,
    application_name: `api_monitoring_${env.NODE_ENV}`,
    keepAlive: true,
    keepAliveInitialDelayMillis: env.DB_KEEPALIVE_INITIAL_DELAY_MS,
}, env.DB_FAMILY);
export const pool = new Pool(primaryPoolConfig);
const READ_QUERY_REGEX = /^\s*(?:\/\*[\s\S]*?\*\/\s*)*(?:SELECT|WITH\b(?![\s\S]*\b(?:INSERT|UPDATE|DELETE)\b)|SHOW|VALUES)\b/i;
function isSafeToRetryQuery(textOrConfig, err) {
    if (!isTransientPostgresError(err))
        return false;
    // Safe to retry if the error occurred prior to dispatch (socket connect / acquire error)
    if (err?.code === 'ECONNREFUSED' || err?.code === 'ETIMEDOUT')
        return true;
    // Safe to retry if the SQL is an idempotent read query
    const sql = typeof textOrConfig === 'string' ? textOrConfig : textOrConfig?.text;
    if (sql && READ_QUERY_REGEX.test(sql))
        return true;
    return false;
}
// Resilient pool.query: Automatically retries on transient connection drops for safe read queries
const rawPoolQuery = pool.query.bind(pool);
pool.query = async function (textOrConfig, values, callback) {
    if (typeof values === 'function' || typeof callback === 'function') {
        return rawPoolQuery(textOrConfig, values, callback);
    }
    const maxRetries = 3;
    let attempt = 0;
    while (true) {
        try {
            return await rawPoolQuery(textOrConfig, values);
        }
        catch (err) {
            attempt++;
            if (attempt <= maxRetries && isSafeToRetryQuery(textOrConfig, err)) {
                const delayMs = 150 * attempt;
                dbLogger.debug({ attempt, maxRetries, delayMs, err: err?.message || String(err) }, 'Transient database connection error in pool.query; retrying safe read query...');
                await new Promise((resolve) => setTimeout(resolve, delayMs));
                continue;
            }
            throw err;
        }
    }
};
dbLogger.info(getSafePostgresConnectionMetadata(env.DATABASE_URL, {
    family: env.DB_FAMILY,
    ssl: primarySsl,
    poolMax: env.DB_POOL_MAX,
    poolMin: env.DB_POOL_MIN,
}), 'Primary PostgreSQL configuration');
/**
 * Dedicated notification subsystem connection pool.
 * Fully isolated from API and Ingestion pools to prevent notification bursts
 * or slow provider handlers from starving telemetry ingestion or user-facing API queries.
 */
const notificationPoolConfig = withPostgresAddressFamily({
    connectionString: sanitizePostgresConnectionString(env.DATABASE_URL),
    ssl: primarySsl,
    max: env.NOTIFICATION_POOL_MAX,
    min: 0,
    idleTimeoutMillis: env.DB_IDLE_TIMEOUT_MS,
    connectionTimeoutMillis: env.DB_CONNECTION_TIMEOUT_MS,
    statement_timeout: env.DB_STATEMENT_TIMEOUT_MS,
    query_timeout: env.DB_QUERY_TIMEOUT_MS,
    application_name: `notification_workers_${env.NODE_ENV}`,
    keepAlive: true,
    keepAliveInitialDelayMillis: env.DB_KEEPALIVE_INITIAL_DELAY_MS,
}, env.DB_FAMILY);
export const notificationPool = new Pool(notificationPoolConfig);
const rawNotificationPoolQuery = notificationPool.query.bind(notificationPool);
notificationPool.query = async function (textOrConfig, values, callback) {
    if (typeof values === 'function' || typeof callback === 'function') {
        return rawNotificationPoolQuery(textOrConfig, values, callback);
    }
    const maxRetries = 3;
    let attempt = 0;
    while (true) {
        try {
            return await rawNotificationPoolQuery(textOrConfig, values);
        }
        catch (err) {
            attempt++;
            if (attempt <= maxRetries && isSafeToRetryQuery(textOrConfig, err)) {
                const delayMs = 150 * attempt;
                dbLogger.debug({ attempt, maxRetries, delayMs, err: err?.message || String(err) }, 'Transient database connection error in notificationPool.query; retrying safe read query...');
                await new Promise((resolve) => setTimeout(resolve, delayMs));
                continue;
            }
            throw err;
        }
    }
};
notificationPool.on('connect', (client) => {
    dbLogger.debug('New connection added to notification pool');
    client.on('error', (err) => {
        if (isExpectedServerlessDisconnect(err)) {
            dbLogger.debug({ err: err.message }, 'Client connection closed by server (Neon/PgBouncer) on notification pool.');
            return;
        }
        dbLogger.debug({ err: err.message }, 'PostgreSQL client socket error on active notification pool connection');
    });
});
notificationPool.on('error', (err) => {
    if (isExpectedServerlessDisconnect(err)) {
        dbLogger.debug({ err: err.message }, 'Idle database connection closed by server on notification pool; pool will reconnect.');
        return;
    }
    dbLogger.error({ err }, 'Unexpected notification database pool error');
});
dbLogger.info(getSafePostgresConnectionMetadata(env.DATABASE_URL, {
    family: env.DB_FAMILY,
    ssl: primarySsl,
    poolMax: env.NOTIFICATION_POOL_MAX,
    poolMin: 0,
}), 'Notification PostgreSQL configuration');
// Pool lifecycle events — only actionable events are logged.
// 'acquire' is intentionally omitted: it fires on every query and produces
// excessive noise at scale (~360K lines/hour at 100 QPS).
pool.on('connect', (client) => {
    dbLogger.debug('New connection added to pool');
    client.on('error', (err) => {
        if (isExpectedServerlessDisconnect(err)) {
            dbLogger.debug({ err: err.message }, 'Client connection closed by server (Neon/PgBouncer).');
            return;
        }
        dbLogger.debug({ err: err.message }, 'PostgreSQL client socket error on active/checked-out connection');
    });
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
    const maxRetries = 3;
    let attempt = 0;
    while (true) {
        try {
            const res = await pool.query('SELECT NOW() AS time, current_database() AS db');
            dbLogger.info({ db: res.rows[0]?.db, serverTime: res.rows[0]?.time }, 'Primary database connected');
            return;
        }
        catch (err) {
            attempt++;
            if (attempt <= maxRetries && isTransientPostgresError(err)) {
                const delayMs = 200 * attempt;
                dbLogger.warn({ attempt, maxRetries, delayMs, err: err?.message || String(err) }, 'Transient database connection drop during connectDB; retrying...');
                await new Promise((resolve) => setTimeout(resolve, delayMs));
                continue;
            }
            throw err;
        }
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
 * Transaction runner with automatic rollback, dead client cleanup,
 * and transient disconnect retry.
 */
export const withTransaction = async (fn, targetPool = pool, options) => {
    const maxRetries = options?.maxRetries ?? 2;
    let attempt = 0;
    while (true) {
        let client = null;
        let transactionError;
        try {
            client = await targetPool.connect();
            await client.query('BEGIN');
            const result = await fn(client);
            await client.query('COMMIT');
            return result;
        }
        catch (e) {
            transactionError = e;
            if (client && !isExpectedServerlessDisconnect(e) && !isTransientPostgresError(e)) {
                try {
                    await client.query('ROLLBACK');
                }
                catch (rollbackError) {
                    dbLogger.debug({ err: rollbackError, originalError: e }, 'Failed to rollback transaction; preserving original error');
                }
            }
            attempt++;
            if (attempt <= maxRetries && isTransientPostgresError(e)) {
                const delayMs = 150 * attempt;
                dbLogger.debug({ attempt, maxRetries, delayMs, err: e?.message || String(e) }, 'Transient database connection error in transaction; retrying with fresh connection...');
                await new Promise((resolve) => setTimeout(resolve, delayMs));
                continue;
            }
            throw e;
        }
        finally {
            if (client) {
                if (transactionError &&
                    (isTransientPostgresError(transactionError) || isExpectedServerlessDisconnect(transactionError))) {
                    client.release(transactionError instanceof Error
                        ? transactionError
                        : new Error('Destroying transaction client after connection-level failure'));
                }
                else {
                    client.release();
                }
            }
        }
    }
};
/**
 * Graceful shutdown — drains active connections before closing.
 */
export const closeDatabase = async () => {
    dbLogger.info('Closing primary database pool and notification pool');
    await Promise.allSettled([
        pool.end(),
        notificationPool.end(),
    ]);
    dbLogger.info('Primary and notification database pools closed');
};
//# sourceMappingURL=database.js.map