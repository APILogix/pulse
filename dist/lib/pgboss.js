import EventEmitter from 'node:events';
import pg, {} from 'pg';
import { PgBoss } from 'pg-boss';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { isExpectedServerlessDisconnect, isTransientPostgresError, resolvePostgresSslConfig, } from '../config/postgres-ssl.js';
const bossLogger = logger.child({ component: 'pg-boss' });
const poolSize = env.INGESTION_DB_POOL_SIZE;
const connectionTimeoutMillis = env.INGESTION_DB_CONNECTION_TIMEOUT_MS;
if (!env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set');
}
// API processes only publish durable jobs. Running pg-boss supervision and
// cron scheduling in every clustered API replica multiplies timers, database
// traffic, and maintenance work. Worker entrypoints retain the full runtime.
const entryPoint = process.argv[1] ?? '';
const inferredRole = /[\\/]shared[\\/]workers[\\/]/.test(entryPoint) ? 'worker' : 'api';
const processRole = process.env.PROCESS_ROLE ?? inferredRole;
const producerOnly = processRole === 'api';
/**
 * Resilient Database Adapter for PgBoss.
 * Built specifically for serverless Postgres providers (such as Neon) where:
 * 1. Computes scale to zero / suspend when idle and take 1-4s to wake up (cold start).
 * 2. Idle TCP connections are terminated server-side by PgBouncer / Neon compute proxy.
 * 3. Background maintenance and queue polling ticks require automatic transparent query retry.
 */
export class ResilientPgBossDb extends EventEmitter {
    pool = null;
    config;
    _pgbdb = true;
    opened = false;
    constructor(config) {
        super();
        this.config = {
            ...config,
            application_name: config.application_name || `pgboss_${processRole}_${env.NODE_ENV}`,
            connectionTimeoutMillis: config.connectionTimeoutMillis ?? 30_000,
            idleTimeoutMillis: config.idleTimeoutMillis ?? 30_000,
            keepAlive: true,
            keepAliveInitialDelayMillis: config.keepAliveInitialDelayMillis ?? env.DB_KEEPALIVE_INITIAL_DELAY_MS ?? 10_000,
            maxUses: 7500,
        };
    }
    events = {
        error: 'error',
    };
    async open() {
        if (this.opened && this.pool)
            return;
        this.pool = new pg.Pool(this.config);
        this.pool.on('error', (err) => {
            // Idle server-side socket disconnects are normal for serverless Postgres (Neon);
            // only bubble genuinely unexpected pool failures.
            if (isExpectedServerlessDisconnect(err)) {
                bossLogger.debug({ err: err.message }, 'Idle pg-boss pool connection closed by server');
                return;
            }
            this.emit('error', err);
        });
        this.opened = true;
    }
    async close() {
        if (this.pool && !this.pool.ending) {
            this.opened = false;
            await this.pool.end();
            this.pool = null;
        }
    }
    /**
     * Executes SQL with exponential backoff retry on transient connection breaks
     * (e.g. Neon waking from cold start or replacing a dropped idle socket).
     */
    async executeSql(text, values) {
        if (!this.opened || !this.pool) {
            throw new Error('Database not opened. Call open() before executing SQL.');
        }
        const maxRetries = 3;
        let attempt = 0;
        while (true) {
            try {
                return await this.pool.query(text, values);
            }
            catch (err) {
                attempt++;
                if (attempt <= maxRetries && isTransientPostgresError(err)) {
                    const delayMs = Math.min(2000, 200 * Math.pow(2, attempt - 1));
                    bossLogger.debug({ attempt, maxRetries, delayMs, err: err?.message || String(err) }, 'Transient Postgres connection error during executeSql; retrying query...');
                    await new Promise((resolve) => setTimeout(resolve, delayMs));
                    continue;
                }
                throw err;
            }
        }
    }
    /**
     * Runs queries within a single pinned client transaction.
     */
    async withTransaction(fn) {
        if (!this.opened || !this.pool) {
            throw new Error('Database not opened. Call open() before executing SQL.');
        }
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            const txDb = {
                executeSql: (text, values) => client.query(text, values),
            };
            const result = await fn(txDb);
            await client.query('COMMIT');
            return result;
        }
        catch (err) {
            await client.query('ROLLBACK').catch(() => { });
            throw err;
        }
        finally {
            client.release();
        }
    }
    /**
     * Dedicated session connection for LISTEN/NOTIFY with automatic reconnection.
     */
    async listen(channel, onNotification, onReconnect) {
        if (!this.opened) {
            throw new Error('Database not opened. Call open() before listening.');
        }
        let closed = false;
        let client = null;
        let reconnectTimer = null;
        let attempt = 0;
        const scheduleReconnect = () => {
            if (closed || reconnectTimer)
                return;
            const backoff = Math.min(30000, 1000 * 2 ** Math.min(attempt, 5));
            attempt++;
            reconnectTimer = setTimeout(() => {
                reconnectTimer = null;
                connect().catch(() => scheduleReconnect());
            }, backoff);
        };
        const connect = async () => {
            if (closed)
                return;
            const next = new pg.Client(this.config);
            next.on('error', (error) => {
                if (!isExpectedServerlessDisconnect(error)) {
                    this.emit('error', error);
                }
                if (!closed) {
                    next.removeAllListeners();
                    next.end().catch(() => { });
                    if (client === next)
                        client = null;
                    scheduleReconnect();
                }
            });
            next.on('notification', (msg) => {
                if (msg.payload !== undefined) {
                    onNotification(msg.payload);
                }
            });
            client = next;
            try {
                await next.connect();
                await next.query(`LISTEN "${channel}"`);
            }
            catch (err) {
                next.removeAllListeners();
                await next.end().catch(() => { });
                if (client === next)
                    client = null;
                throw err;
            }
            attempt = 0;
            onReconnect();
        };
        await connect();
        return {
            close: async () => {
                closed = true;
                if (reconnectTimer) {
                    clearTimeout(reconnectTimer);
                    reconnectTimer = null;
                }
                if (client) {
                    client.removeAllListeners();
                    await client.end().catch(() => { });
                    client = null;
                }
            },
        };
    }
}
const sslConfig = resolvePostgresSslConfig(env.DATABASE_URL, {
    enabled: env.DB_SSL_ENABLED,
    rejectUnauthorized: env.DB_SSL_REJECT_UNAUTHORIZED,
});
const dbAdapter = new ResilientPgBossDb({
    connectionString: env.DATABASE_URL,
    ssl: sslConfig,
    application_name: `pgboss_${processRole}_${env.NODE_ENV}`,
    max: producerOnly ? Math.min(poolSize, 2) : poolSize,
    connectionTimeoutMillis,
    idleTimeoutMillis: env.INGESTION_DB_IDLE_TIMEOUT_MS,
    keepAliveInitialDelayMillis: env.DB_KEEPALIVE_INITIAL_DELAY_MS,
});
/**
 * Enterprise PgBoss Singleton.
 * Configured with resilient serverless Postgres adapter to prevent
 * connection timeout and unexpected socket drop issues on Neon.
 */
export const pgboss = new PgBoss({
    connectionString: env.DATABASE_URL,
    ssl: sslConfig,
    application_name: `pgboss_${processRole}_${env.NODE_ENV}`,
    max: producerOnly ? Math.min(poolSize, 2) : poolSize,
    connectionTimeoutMillis,
    schedule: !producerOnly,
    supervise: !producerOnly,
    db: dbAdapter,
});
pgboss.on('error', (err) => {
    if (isExpectedServerlessDisconnect(err)) {
        bossLogger.debug({ err: err?.message || String(err) }, 'Idle database connection closed by serverless host (Neon); pool will reconnect.');
        return;
    }
    bossLogger.error({ err }, 'PgBoss error');
});
pgboss.on('maintenance', () => {
    bossLogger.debug('PgBoss maintenance occurred');
});
pgboss.on('monitor', (state) => {
    bossLogger.debug({ state }, 'PgBoss monitor event');
});
let startPromise = null;
let started = false;
/** Starts pg-boss once even when multiple modules request it concurrently. */
export async function startPgBoss() {
    if (started)
        return;
    startPromise ??= (async () => {
        bossLogger.info({ poolSize: producerOnly ? Math.min(poolSize, 2) : poolSize, connectionTimeoutMillis, processRole, producerOnly }, 'Starting PgBoss');
        await pgboss.start();
        started = true;
        bossLogger.info({ processRole, producerOnly }, 'PgBoss started successfully');
    })();
    try {
        await startPromise;
    }
    catch (error) {
        startPromise = null;
        throw error;
    }
}
/** Gracefully shuts down pg-boss without exceeding the process drain budget. */
export async function stopPgBoss(timeout = 10_000) {
    if (!startPromise)
        return;
    await startPromise.catch(() => undefined);
    if (!started)
        return;
    bossLogger.info({ timeout }, 'Stopping PgBoss');
    await pgboss.stop({ graceful: true, timeout });
    started = false;
    startPromise = null;
    bossLogger.info('PgBoss stopped');
}
//# sourceMappingURL=pgboss.js.map