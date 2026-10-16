import '../config/dns.js';
import { type Pool, type PoolClient, type PoolConfig } from 'pg';
export interface PgmqMessage<T = unknown> {
    msgId: string;
    readCt: number;
    enqueuedAt: Date;
    vt: Date;
    message: T;
    headers: Record<string, unknown> | null;
}
export interface PgmqMetrics {
    queueName: string;
    queueLength: number;
    newestMsgAgeSec: number | null;
    oldestMsgAgeSec: number | null;
    totalMessages: number;
    scrapeTime: Date;
    queueVisibleLength: number;
}
export interface PgmqClientOptions {
    pool?: Pool;
    commandPool?: Pool;
    connectionString?: string;
    ssl?: PoolConfig['ssl'];
    applicationName?: string;
    maxConnections?: number;
    maxCommandConnections?: number;
}
export interface PgmqSendOptions {
    delaySeconds?: number;
}
export interface PgmqReadOptions {
    visibilityTimeoutSeconds?: number;
    quantity?: number;
    pollTimeoutSeconds?: number;
    pollIntervalMs?: number;
}
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
export declare class PgmqClient {
    private pool;
    private commandPool;
    private ownsPool;
    private ownsCommandPool;
    private readonly readerFactory?;
    private knownQueues;
    private knownQueuesLoaded;
    private knownQueuesInitPromise;
    constructor(options?: PgmqClientOptions);
    getPool(): Pool;
    getCommandPool(): Pool;
    /** Executes SQL query with resilient exponential backoff for transient serverless disconnects. */
    private query;
    /**
     * Creates a new queue with standard durable WAL storage.
     * Idempotent across normal duplicate table errors and partially/previously
     * provisioned PGMQ extension objects.
     */
    /**
     * Ensures that all existing PGMQ queues in the database are preloaded into the in-memory cache.
     * Concurrent callers share a single deduplicated Promise.
     */
    ensureKnownQueuesLoaded(client?: PoolClient): Promise<Set<string>>;
    createQueue(queue: string, client?: PoolClient): Promise<void>;
    /**
     * Creates an unlogged queue (unlogged table) for high-speed ephemeral jobs.
     */
    createUnloggedQueue(queue: string, client?: PoolClient): Promise<void>;
    /**
     * Concurrently provisions multiple PGMQ queues with bounded parallelism.
     * Safe against pool exhaustion, retries transient errors, and aggregates failures.
     */
    createQueues(queues: string[], options?: {
        concurrency?: number;
        unlogged?: boolean;
        client?: PoolClient;
    }): Promise<void>;
    /** Drops a queue and its archive table. */
    dropQueue(queue: string, client?: PoolClient): Promise<void>;
    /**
     * Fetches all known queues from pgmq.meta and information_schema,
     * caching them in memory to eliminate redundant DDL calls.
     */
    fetchKnownQueues(client?: PoolClient): Promise<Set<string>>;
    private queueExists;
    /** Purges all messages from a queue. */
    purgeQueue(queue: string, client?: PoolClient): Promise<number>;
    /**
     * Sends a single message to a queue.
     * Returns the assigned msgId.
     */
    send<T>(queue: string, message: T, options?: PgmqSendOptions, client?: PoolClient): Promise<string>;
    /**
     * Sends a batch of messages to a queue in a single SQL call.
     * Returns array of assigned msgIds.
     */
    sendBatch<T>(queue: string, messages: T[], options?: PgmqSendOptions, client?: PoolClient): Promise<string[]>;
    /**
     * Reads up to `quantity` messages with a visibility timeout (in seconds).
     * Messages are hidden from other consumers until `vt` expires.
     */
    read<T = unknown>(queue: string, options?: PgmqReadOptions, client?: PoolClient): Promise<Array<PgmqMessage<T>>>;
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
    readWithPoll<T = unknown>(queue: string, options?: PgmqReadOptions, client?: PoolClient): Promise<Array<PgmqMessage<T>>>;
    /**
     * Heartbeat / Visibility Extension:
     * Sets the message's visibility timeout to `vtOffsetSeconds` from NOW().
     */
    setVt<T = unknown>(queue: string, msgId: string | number, vtOffsetSeconds: number, client?: PoolClient): Promise<PgmqMessage<T> | null>;
    /**
     * Acknowledges and permanently deletes a processed message from the queue.
     */
    delete(queue: string, msgId: string | number, client?: PoolClient): Promise<boolean>;
    /**
     * Acknowledges and permanently deletes a batch of messages.
     */
    deleteBatch(queue: string, msgIds: Array<string | number>, client?: PoolClient): Promise<string[]>;
    /**
     * Acknowledges and archives a message into `pgmq.a_<queue>`.
     */
    archive(queue: string, msgId: string | number, client?: PoolClient): Promise<boolean>;
    /**
     * Acknowledges and archives a batch of messages into `pgmq.a_<queue>`.
     */
    archiveBatch(queue: string, msgIds: Array<string | number>, client?: PoolClient): Promise<string[]>;
    /**
     * Retrieves queue telemetry and depth metrics.
     */
    metrics(queue: string, client?: PoolClient): Promise<PgmqMetrics | null>;
    /**
     * Retrieves telemetry metrics for all pgmq queues.
     */
    metricsAll(client?: PoolClient): Promise<PgmqMetrics[]>;
    /**
     * Closes the PGMQ client and connection pools.
     */
    close(): Promise<void>;
}
export declare function isPgmqQueueAlreadyProvisionedError(err: any): boolean;
/** Default singleton PGMQ client attached to primary database */
export declare const pgmq: PgmqClient;
//# sourceMappingURL=pgmq.d.ts.map