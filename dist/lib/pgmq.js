import '../config/dns.js';
import pg, {} from 'pg';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { getSafePostgresConnectionMetadata, withPostgresAddressFamily, } from '../config/postgres-network.js';
import { isExpectedServerlessDisconnect, isTransientPostgresError, resolvePostgresSslConfig, sanitizePostgresConnectionString, } from '../config/postgres-ssl.js';
const pgmqLogger = logger.child({ component: 'pgmq' });
/**
 * Enterprise Supabase PostgreSQL PGMQ Client.
 * Implements high-performance, durable message queueing atop the `pgmq` PostgreSQL extension.
 *
 * Architecture:
 * - Reader Pool (`pool`): Dedicated to message long-polling (`readWithPoll`, `read`).
 * - Command Pool (`commandPool`): Dedicated to high-priority operations (`setVt` heartbeats,
 *   `archive`, `delete`, `send`). This ensures worker heartbeats and completions NEVER get
 *   blocked or starved behind 2-second blocking long polls.
 */
export class PgmqClient {
    pool = null;
    commandPool;
    ownsPool = false;
    ownsCommandPool = false;
    readerFactory;
    knownQueues = new Set();
    knownQueuesLoaded = false;
    knownQueuesInitPromise = null;
    constructor(options = {}) {
        if (options.pool) {
            this.pool = options.pool;
            this.commandPool = options.commandPool ?? options.pool;
        }
        else {
            const connStr = options.connectionString ?? env.DATABASE_URL;
            const cleanConnStr = sanitizePostgresConnectionString(connStr);
            const ssl = options.ssl ?? resolvePostgresSslConfig(connStr, {
                enabled: env.DB_SSL_ENABLED,
                rejectUnauthorized: env.DB_SSL_REJECT_UNAUTHORIZED,
            });
            const maxReader = options.maxConnections ?? env.QUEUE_POOL_MAX;
            const maxCommand = options.maxCommandConnections ?? env.QUEUE_COMMAND_POOL_MAX;
            // Lazily instantiate the Reader Pool ONLY on processes that actually consume queues
            this.readerFactory = () => {
                const readerPool = new pg.Pool(withPostgresAddressFamily({
                    connectionString: cleanConnStr,
                    ssl,
                    max: maxReader,
                    min: 0,
                    idleTimeoutMillis: env.DB_IDLE_TIMEOUT_MS,
                    connectionTimeoutMillis: env.DB_CONNECTION_TIMEOUT_MS,
                    application_name: options.applicationName ?? `pulse_pgmq_poll_${env.NODE_ENV}`,
                    keepAlive: true,
                    keepAliveInitialDelayMillis: env.DB_KEEPALIVE_INITIAL_DELAY_MS,
                }, env.DB_FAMILY));
                readerPool.on('error', (err) => {
                    if (isExpectedServerlessDisconnect(err)) {
                        pgmqLogger.debug({ err: err.message }, 'Idle PGMQ reader connection closed by serverless host');
                        return;
                    }
                    pgmqLogger.error({ err }, 'Unexpected PGMQ reader pool error');
                });
                pgmqLogger.info({
                    pool: 'reader',
                    ...getSafePostgresConnectionMetadata(connStr, {
                        family: env.DB_FAMILY,
                        ssl,
                        poolMax: maxReader,
                        poolMin: 0,
                    }),
                }, 'PGMQ PostgreSQL reader pool initialized');
                this.ownsPool = true;
                return readerPool;
            };
            this.commandPool = new pg.Pool(withPostgresAddressFamily({
                connectionString: cleanConnStr,
                ssl,
                max: maxCommand,
                min: 0,
                idleTimeoutMillis: env.DB_IDLE_TIMEOUT_MS,
                connectionTimeoutMillis: env.DB_CONNECTION_TIMEOUT_MS,
                application_name: options.applicationName
                    ? `${options.applicationName}_cmd`
                    : `pulse_pgmq_cmd_${env.NODE_ENV}`,
                keepAlive: true,
                keepAliveInitialDelayMillis: env.DB_KEEPALIVE_INITIAL_DELAY_MS,
            }, env.DB_FAMILY));
            this.commandPool.on('error', (err) => {
                if (isExpectedServerlessDisconnect(err)) {
                    pgmqLogger.debug({ err: err.message }, 'Idle PGMQ command connection closed by serverless host');
                    return;
                }
                pgmqLogger.error({ err }, 'Unexpected PGMQ command pool error');
            });
            this.ownsCommandPool = true;
        }
    }
    getPool() {
        if (!this.pool) {
            this.pool = this.readerFactory ? this.readerFactory() : this.commandPool;
        }
        return this.pool;
    }
    getCommandPool() {
        return this.commandPool;
    }
    /** Executes SQL query with resilient exponential backoff for transient serverless disconnects. */
    async query(text, params, client, useCommandPool = true, isIdempotent = false) {
        const executor = client ?? (useCommandPool ? this.commandPool : this.getPool());
        const maxRetries = client ? 0 : 3; // Do not auto-retry queries inside explicit client transactions
        let attempt = 0;
        while (true) {
            try {
                return await executor.query(text, params);
            }
            catch (err) {
                attempt++;
                const isPreDispatchError = err?.code === 'ECONNREFUSED' ||
                    err?.code === 'ETIMEDOUT' ||
                    err?.code === 'EHOSTUNREACH' ||
                    err?.code === 'ENETUNREACH';
                const canRetry = isIdempotent
                    ? isTransientPostgresError(err)
                    : isPreDispatchError;
                if (attempt <= maxRetries && canRetry) {
                    const delayMs = Math.min(2000, 150 * 2 ** (attempt - 1));
                    pgmqLogger.debug({ attempt, maxRetries, delayMs, err: err instanceof Error ? err.message : String(err) }, 'Transient Postgres error in PGMQ query; retrying...');
                    await new Promise((resolve) => setTimeout(resolve, delayMs));
                    continue;
                }
                throw err;
            }
        }
    }
    /**
     * Creates a new queue with standard durable WAL storage.
     * Idempotent across normal duplicate table errors and partially/previously
     * provisioned PGMQ extension objects.
     */
    /**
     * Ensures that all existing PGMQ queues in the database are preloaded into the in-memory cache.
     * Concurrent callers share a single deduplicated Promise.
     */
    async ensureKnownQueuesLoaded(client) {
        if (this.knownQueuesLoaded) {
            return this.knownQueues;
        }
        if (!this.knownQueuesInitPromise) {
            this.knownQueuesInitPromise = this.fetchKnownQueues(client)
                .then((queues) => {
                this.knownQueuesLoaded = true;
                return queues;
            })
                .catch((err) => {
                pgmqLogger.debug({ err: err?.message }, 'Failed to prefetch known queues; will query on demand');
                return this.knownQueues;
            })
                .finally(() => {
                this.knownQueuesInitPromise = null;
            });
        }
        return this.knownQueuesInitPromise;
    }
    async createQueue(queue, client) {
        const normalizedQueue = queue.replace(/\./g, '_');
        if (this.knownQueues.has(queue) || this.knownQueues.has(normalizedQueue))
            return;
        if (await this.queueExists(queue, client)) {
            this.knownQueues.add(queue);
            this.knownQueues.add(normalizedQueue);
            return;
        }
        try {
            await this.query(`SELECT pgmq.create($1::text);`, [queue], client);
            this.knownQueues.add(queue);
            this.knownQueues.add(normalizedQueue);
        }
        catch (err) {
            if (isPgmqQueueAlreadyProvisionedError(err)) {
                this.knownQueues.add(queue);
                this.knownQueues.add(normalizedQueue);
                pgmqLogger.debug({ queue, err: err?.message }, 'PGMQ queue already provisioned');
                return;
            }
            throw err;
        }
    }
    /**
     * Creates an unlogged queue (unlogged table) for high-speed ephemeral jobs.
     */
    async createUnloggedQueue(queue, client) {
        const normalizedQueue = queue.replace(/\./g, '_');
        if (this.knownQueues.has(queue) || this.knownQueues.has(normalizedQueue))
            return;
        if (await this.queueExists(queue, client)) {
            this.knownQueues.add(queue);
            this.knownQueues.add(normalizedQueue);
            return;
        }
        try {
            await this.query(`SELECT pgmq.create_unlogged($1::text);`, [queue], client);
            this.knownQueues.add(queue);
            this.knownQueues.add(normalizedQueue);
        }
        catch (err) {
            if (isPgmqQueueAlreadyProvisionedError(err)) {
                this.knownQueues.add(queue);
                this.knownQueues.add(normalizedQueue);
                pgmqLogger.debug({ queue, err: err?.message }, 'PGMQ unlogged queue already provisioned');
                return;
            }
            throw err;
        }
    }
    /**
     * Concurrently provisions multiple PGMQ queues with bounded parallelism.
     * Safe against pool exhaustion, retries transient errors, and aggregates failures.
     */
    async createQueues(queues, options = {}) {
        if (queues.length === 0)
            return;
        await this.ensureKnownQueuesLoaded(options.client);
        const uniqueQueues = Array.from(new Set(queues));
        const unprovisioned = uniqueQueues.filter((q) => !this.knownQueues.has(q) && !this.knownQueues.has(q.replace(/\./g, '_')));
        if (unprovisioned.length === 0)
            return;
        const concurrency = Math.max(1, Math.min(options.concurrency ?? 4, 8));
        const errors = [];
        // Worker pool with bounded concurrency
        let index = 0;
        const workers = Array.from({ length: Math.min(concurrency, unprovisioned.length) }, async () => {
            while (index < unprovisioned.length) {
                const currentQueue = unprovisioned[index++];
                if (!currentQueue)
                    break;
                try {
                    if (options.unlogged) {
                        await this.createUnloggedQueue(currentQueue, options.client);
                    }
                    else {
                        await this.createQueue(currentQueue, options.client);
                    }
                }
                catch (err) {
                    errors.push({ queue: currentQueue, error: err });
                }
            }
        });
        await Promise.all(workers);
        if (errors.length > 0) {
            const errorSummary = errors
                .map((e) => `${e.queue}: ${e.error instanceof Error ? e.error.message : String(e.error)}`)
                .join(', ');
            throw new Error(`Failed to provision queues with bounded concurrency (${errors.length}/${unprovisioned.length} failed): ${errorSummary}`);
        }
    }
    /** Drops a queue and its archive table. */
    async dropQueue(queue, client) {
        await this.query(`SELECT pgmq.drop_queue($1::text);`, [queue], client);
        this.knownQueues.delete(queue);
        this.knownQueues.delete(queue.replace(/\./g, '_'));
    }
    /**
     * Fetches all known queues from pgmq.meta and information_schema,
     * caching them in memory to eliminate redundant DDL calls.
     */
    async fetchKnownQueues(client) {
        try {
            const res = await this.query(`SELECT queue_name FROM pgmq.meta;`, [], client);
            for (const row of res.rows) {
                if (row.queue_name) {
                    this.knownQueues.add(row.queue_name);
                    this.knownQueues.add(row.queue_name.replace(/\./g, '_'));
                }
            }
        }
        catch {
            try {
                const res = await this.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'pgmq' AND table_name LIKE 'q_%';`, [], client);
                for (const row of res.rows) {
                    const qName = row.table_name.startsWith('q_') ? row.table_name.slice(2) : row.table_name;
                    if (qName) {
                        this.knownQueues.add(qName);
                        this.knownQueues.add(qName.replace(/\./g, '_'));
                    }
                }
            }
            catch {
                // Non-fatal if pgmq schema is not yet initialized
            }
        }
        this.knownQueuesLoaded = true;
        return this.knownQueues;
    }
    async queueExists(queue, client) {
        const normalizedQueue = queue.replace(/\./g, '_');
        const tableName = `pgmq.q_${normalizedQueue}`;
        const archiveName = `pgmq.a_${normalizedQueue}`;
        try {
            const res = await this.query(`SELECT (to_regclass($1) IS NOT NULL OR to_regclass($2) IS NOT NULL)
            OR EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'pgmq' AND table_name = $3)
            AS exists;`, [tableName, archiveName, `q_${normalizedQueue}`], client);
            return Boolean(res.rows[0]?.exists);
        }
        catch {
            return false;
        }
    }
    /** Purges all messages from a queue. */
    async purgeQueue(queue, client) {
        const res = await this.query(`SELECT pgmq.purge_queue($1::text);`, [queue], client);
        return Number(res.rows[0]?.purge_queue ?? 0);
    }
    /**
     * Sends a single message to a queue.
     * Returns the assigned msgId.
     */
    async send(queue, message, options = {}, client) {
        const delay = Math.max(0, options.delaySeconds ?? 0);
        const jsonPayload = JSON.stringify(message);
        const res = await this.query(`SELECT pgmq.send($1::text, $2::jsonb, $3::integer);`, [queue, jsonPayload, delay], client, true, false);
        const msgId = String(res.rows[0]?.send);
        return msgId;
    }
    /**
     * Sends a batch of messages to a queue in a single SQL call.
     * Returns array of assigned msgIds.
     */
    async sendBatch(queue, messages, options = {}, client) {
        if (messages.length === 0)
            return [];
        const delay = Math.max(0, options.delaySeconds ?? 0);
        const jsonPayloads = messages.map((m) => JSON.stringify(m));
        const res = await this.query(`SELECT pgmq.send_batch($1::text, $2::jsonb[], $3::integer);`, [queue, jsonPayloads, delay], client, true, false);
        return res.rows.map((r) => String(r.send_batch));
    }
    /**
     * Reads up to `quantity` messages with a visibility timeout (in seconds).
     * Messages are hidden from other consumers until `vt` expires.
     */
    async read(queue, options = {}, client) {
        const vt = Math.max(1, options.visibilityTimeoutSeconds ?? env.QUEUE_VISIBILITY_TIMEOUT_SECONDS ?? 60);
        const qty = Math.max(1, options.quantity ?? 1);
        const res = await this.query(`SELECT msg_id, read_ct, enqueued_at, vt, message, headers
       FROM pgmq.read($1::text, $2::integer, $3::integer);`, [queue, vt, qty], client, false, true);
        return res.rows.map((r) => ({
            msgId: String(r.msg_id),
            readCt: Number(r.read_ct),
            enqueuedAt: new Date(r.enqueued_at),
            vt: new Date(r.vt),
            message: r.message,
            headers: r.headers ?? null,
        }));
    }
    /**
     * Polls for up to `quantity` messages using non-blocking client-side intervals.
     *
     * Why client-side polling instead of `pgmq.read_with_poll`:
     * Server-side `pgmq.read_with_poll` executes `pg_sleep()` inside PL/pgSQL, pinning
     * a physical PostgreSQL backend and PgBouncer transaction slot in `active` state for
     * 2,000ms continuously. By executing fast `pgmq.read()` checks (~0.4ms) and sleeping
     * in the Node.js event loop when empty, database connection hold time drops by ~500x
     * and PgBouncer never starves API or heartbeat queries.
     */
    async readWithPoll(queue, options = {}, client) {
        const vt = Math.max(1, options.visibilityTimeoutSeconds ?? env.QUEUE_VISIBILITY_TIMEOUT_SECONDS ?? 60);
        const qty = Math.max(1, options.quantity ?? 1);
        const pollTimeoutMs = Math.max(1, options.pollTimeoutSeconds ?? env.QUEUE_POLL_SECONDS ?? 2) * 1000;
        const pollIntervalMs = Math.max(50, options.pollIntervalMs ?? 200);
        const deadline = Date.now() + pollTimeoutMs;
        while (true) {
            const messages = await this.read(queue, { visibilityTimeoutSeconds: vt, quantity: qty }, client);
            if (messages.length > 0 || Date.now() >= deadline) {
                return messages;
            }
            // Add +/- 15% jitter so multiple queue consumers never synchronize into thundering herds
            const jitter = Math.floor(pollIntervalMs * (0.85 + Math.random() * 0.3));
            const remainingMs = deadline - Date.now();
            if (remainingMs <= 0) {
                return [];
            }
            await new Promise((resolve) => setTimeout(resolve, Math.min(jitter, remainingMs)));
        }
    }
    /**
     * Heartbeat / Visibility Extension:
     * Sets the message's visibility timeout to `vtOffsetSeconds` from NOW().
     */
    async setVt(queue, msgId, vtOffsetSeconds, client) {
        const offset = Math.max(1, vtOffsetSeconds);
        const res = await this.query(`SELECT msg_id, read_ct, enqueued_at, vt, message, headers
       FROM pgmq.set_vt($1::text, $2::bigint, $3::integer);`, [queue, msgId, offset], client);
        if (res.rows.length === 0)
            return null;
        const r = res.rows[0];
        return {
            msgId: String(r.msg_id),
            readCt: Number(r.read_ct),
            enqueuedAt: new Date(r.enqueued_at),
            vt: new Date(r.vt),
            message: r.message,
            headers: r.headers ?? null,
        };
    }
    /**
     * Acknowledges and permanently deletes a processed message from the queue.
     */
    async delete(queue, msgId, client) {
        const res = await this.query(`SELECT pgmq.delete($1::text, $2::bigint);`, [queue, msgId], client);
        return res.rows[0]?.delete ?? false;
    }
    /**
     * Acknowledges and permanently deletes a batch of messages.
     */
    async deleteBatch(queue, msgIds, client) {
        if (msgIds.length === 0)
            return [];
        const res = await this.query(`SELECT pgmq.delete($1::text, $2::bigint[]);`, [queue, msgIds], client);
        return res.rows.map((r) => String(r.delete));
    }
    /**
     * Acknowledges and archives a message into `pgmq.a_<queue>`.
     */
    async archive(queue, msgId, client) {
        const res = await this.query(`SELECT pgmq.archive($1::text, $2::bigint);`, [queue, msgId], client);
        return res.rows[0]?.archive ?? false;
    }
    /**
     * Acknowledges and archives a batch of messages into `pgmq.a_<queue>`.
     */
    async archiveBatch(queue, msgIds, client) {
        if (msgIds.length === 0)
            return [];
        const res = await this.query(`SELECT pgmq.archive($1::text, $2::bigint[]);`, [queue, msgIds], client);
        return res.rows.map((r) => String(r.archive));
    }
    /**
     * Retrieves queue telemetry and depth metrics.
     */
    async metrics(queue, client) {
        try {
            const res = await this.query(`SELECT queue_name, queue_length, newest_msg_age_sec, oldest_msg_age_sec, total_messages, scrape_time, queue_visible_length
         FROM pgmq.metrics($1::text);`, [queue], client);
            if (res.rows.length === 0)
                return null;
            const r = res.rows[0];
            return {
                queueName: r.queue_name,
                queueLength: Number(r.queue_length ?? 0),
                newestMsgAgeSec: r.newest_msg_age_sec != null ? Number(r.newest_msg_age_sec) : null,
                oldestMsgAgeSec: r.oldest_msg_age_sec != null ? Number(r.oldest_msg_age_sec) : null,
                totalMessages: Number(r.total_messages ?? 0),
                scrapeTime: new Date(r.scrape_time),
                queueVisibleLength: Number(r.queue_visible_length ?? 0),
            };
        }
        catch {
            return null;
        }
    }
    /**
     * Retrieves telemetry metrics for all pgmq queues.
     */
    async metricsAll(client) {
        try {
            const res = await this.query(`SELECT queue_name, queue_length, newest_msg_age_sec, oldest_msg_age_sec, total_messages, scrape_time, queue_visible_length
         FROM pgmq.metrics_all();`, [], client);
            return res.rows.map((r) => ({
                queueName: r.queue_name,
                queueLength: Number(r.queue_length ?? 0),
                newestMsgAgeSec: r.newest_msg_age_sec != null ? Number(r.newest_msg_age_sec) : null,
                oldestMsgAgeSec: r.oldest_msg_age_sec != null ? Number(r.oldest_msg_age_sec) : null,
                totalMessages: Number(r.total_messages ?? 0),
                scrapeTime: new Date(r.scrape_time),
                queueVisibleLength: Number(r.queue_visible_length ?? 0),
            }));
        }
        catch {
            return [];
        }
    }
    /**
     * Closes the PGMQ client and connection pools.
     */
    async close() {
        if (this.ownsPool && this.pool && !this.pool.ending) {
            await this.pool.end();
        }
        if (this.ownsCommandPool && this.commandPool && !this.commandPool.ending) {
            await this.commandPool.end();
        }
    }
}
export function isPgmqQueueAlreadyProvisionedError(err) {
    if (!err)
        return false;
    const code = String(err?.code ?? '');
    const message = String(err?.message ?? '').toLowerCase();
    // 42P07: duplicate_table / duplicate_relation / duplicate_object
    if (code === '42P07')
        return true;
    // 23505: unique_violation on pgmq.meta or queue index
    if (code === '23505' && (message.includes('pgmq') || message.includes('queue_name') || message.includes('meta') || message.includes('key'))) {
        return true;
    }
    // 55000: object_not_in_prerequisite_state (ALTER EXTENSION pgmq ADD SEQUENCE/TABLE ...)
    if (code === '55000') {
        if (message.includes('already a member of extension') ||
            message.includes('is already a member of extension') ||
            message.includes('member of extension') ||
            message.includes('pgmq')) {
            return true;
        }
    }
    return (message.includes('already a member of extension') ||
        message.includes('is already a member of extension') ||
        message.includes('already exists') ||
        (message.includes('duplicate') && message.includes('pgmq')) ||
        message.includes('already registered'));
}
/** Default singleton PGMQ client attached to primary database */
export const pgmq = new PgmqClient();
//# sourceMappingURL=pgmq.js.map