import { type PoolClient, type QueryResult, type QueryResultRow } from 'pg';
export type DbOperation = 'read' | 'write';
export interface QueryOptions {
    /** Max retry attempts (default: env.LOG_RETRIES). */
    maxRetries?: number;
    /** 'read' routes to the replica when available; 'write' always hits primary. */
    operation?: DbOperation;
    /** Sets app.current_project_id for the duration of the query (RLS tenant scope). */
    projectId?: string | undefined;
    /**
     * Per-statement timeout in ms applied via `SET LOCAL` inside a transaction.
     * `0` disables the timeout for this statement. When omitted, the pool default
     * (read path) or the configured write timeout (write path) applies.
     */
    timeout?: number;
}
export interface PoolStats {
    total: number;
    idle: number;
    waiting: number;
}
export interface LogEvent {
    project_id: string;
    type: string;
    timestamp: Date;
    payload: Record<string, unknown>;
}
/**
 * LogDatabaseManager — enterprise-grade dual-pool manager for the dedicated log
 * / event-ingestion database (TimescaleDB-compatible).
 *
 * Design goals:
 * - **Never time out ingestion.** Writes run with a separate, by-default
 *   unbounded statement timeout so large batch inserts and background
 *   maintenance are never aborted. Reads stay bounded to contain runaway
 *   analytical queries. Timeouts are applied with `SET LOCAL` inside a
 *   transaction so they can never leak onto a pooled connection.
 * - **Dual pool.** Primary handles writes/DDL; replica absorbs read traffic and
 *   transparently falls back to primary when absent or unhealthy.
 * - **TimescaleDB.** On connect (when enabled) the event tables are promoted to
 *   hypertables with compression + retention policies. Every step is idempotent
 *   and non-fatal — failure degrades cleanly to plain PostgreSQL.
 * - **High-throughput batch ingest** via set-based `UNNEST` inserts.
 * - **Resilience.** Exponential backoff with jitter, fast-fail on
 *   non-retryable errors, TCP keepalive, and a load-balancer health probe.
 */
declare class LogDatabaseManager {
    private primaryPool;
    private replicaPool;
    private isShuttingDown;
    private timescaleReady;
    constructor();
    /**
     * Build a tuned connection pool.
     *
     * Note: we deliberately do NOT set a global `statement_timeout`/`query_timeout`
     * on the pool. A hard global timeout silently kills legitimate long-running
     * ingestion batches, COPY, and TimescaleDB maintenance. Instead, timeouts are
     * applied per-statement via `SET LOCAL`, scoped to the read path only.
     */
    private createPool;
    private resolveSslConfig;
    private setupPoolMonitoring;
    /**
     * Test connections on startup (fail-fast) and, when enabled, promote the
     * event tables to TimescaleDB hypertables. Safe to call once at bootstrap.
     */
    connect(): Promise<{
        primary: Date;
        replica?: Date;
    }>;
    /**
     * Ensure the TimescaleDB extension is available on the log database.
     *
     * Table-level hypertable provisioning (chunking, compression, retention) for
     * the analytics event tables lives in the schema migrations where those
     * tables are defined (migrations2/004), not here — that keeps DDL in one
     * authoritative place. This method only guarantees the extension exists so
     * the log DB is ready to host hypertables.
     *
     * Fully non-fatal: if TimescaleDB is unavailable the log DB simply runs as
     * plain PostgreSQL.
     */
    initializeTimescale(): Promise<void>;
    /** True once TimescaleDB hypertables have been provisioned. */
    get isTimescaleReady(): boolean;
    /** True if a separate replica pool is configured. */
    get hasReplica(): boolean;
    /**
     * Acquire a pooled connection from the appropriate pool.
     *
     * @param options.operation 'read' routes to the replica when available.
     * @param options.projectId sets the RLS tenant scope for the session.
     */
    getConnection(options?: {
        operation?: DbOperation;
        projectId?: string | undefined;
    }): Promise<PoolClient>;
    /**
     * Execute a query with retry + exponential backoff (with jitter).
     *
     * - Non-retryable errors (constraint, permission, syntax) fail immediately.
     * - A per-statement timeout, when supplied, is applied via `SET LOCAL` inside
     *   a transaction so it can never leak onto a reused pooled connection.
     * - Reads default to the configured read timeout; writes default to the
     *   write timeout (0/unbounded) so ingestion is never aborted mid-batch.
     */
    queryWithRetry<T extends QueryResultRow = QueryResultRow>(sql: string, params?: unknown[], options?: QueryOptions): Promise<QueryResult<T>>;
    /**
     * Run a single statement, optionally bounded by a transaction-scoped
     * `SET LOCAL statement_timeout`. A timeout of 0 means "no statement timeout"
     * and the query runs directly without transaction overhead.
     */
    private runWithTimeout;
    /**
     * Run a function inside a single transaction on the primary pool. The
     * statement timeout defaults to the (unbounded) write timeout so long
     * ingestion transactions are never aborted.
     */
    withTransaction<T>(fn: (client: PoolClient) => Promise<T>, options?: {
        projectId?: string | undefined;
        timeout?: number;
    }): Promise<T>;
    /**
     * High-throughput batch insert of raw events plus their specialized rows.
     *
     * Uses set-based `UNNEST` inserts (one statement per table regardless of
     * batch size) inside a single transaction with an unbounded statement timeout
     * so large batches never get killed mid-flight.
     */
    batchInsertEvents(events: LogEvent[]): Promise<void>;
    private insertRequests;
    private insertErrors;
    /**
     * Health check for load-balancer / readiness probes. Verifies primary and,
     * when configured, replica connectivity. A failed replica is non-fatal (reads
     * fall back to primary) and is reported but does not flip `healthy`.
     */
    healthCheck(): Promise<{
        healthy: boolean;
        primary?: Date;
        replica?: Date;
    }>;
    /** Live pool utilization, useful for metrics dashboards and capacity alerts. */
    getPoolStats(): {
        primary: PoolStats;
        replica?: PoolStats;
    };
    /** Graceful shutdown — drains both pools. */
    close(): Promise<void>;
}
export declare const logDB: LogDatabaseManager;
export declare const logQuery: <T extends QueryResultRow = QueryResultRow>(sql: string, params?: unknown[], options?: QueryOptions) => Promise<QueryResult<T>>;
export declare const connectLogDB: () => Promise<{
    primary: Date;
    replica?: Date;
}>;
export {};
//# sourceMappingURL=log-database.d.ts.map