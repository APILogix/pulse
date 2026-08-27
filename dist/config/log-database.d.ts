import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';
export type DbOperation = 'read' | 'write';
export interface QueryOptions {
    /** Max retry attempts (default: env.LOG_RETRIES). */
    maxRetries?: number;
    /** 'read' routes to the replica when available; 'write' always hits primary. */
    operation?: DbOperation;
    /**
     * RLS tenant scope. Sets `app.current_project_id` for the duration of the
     * TRANSACTION wrapping this query, then reverts automatically. Supplying it
     * forces the query into a transaction even when no timeout is set, so the
     * scope can never be silently dropped.
     */
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
 * - **No session state on pooled connections.** Every per-request setting
 *   (statement timeout, RLS tenant scope) is transaction-scoped. Nothing is
 *   applied at checkout time, so a connection returned to the pool carries no
 *   residue from its previous borrower. See `applyTenantScope()`.
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
     *
     * NOTE: this deliberately does not accept a `projectId`. Tenant scope is a
     * transaction-scoped concern and is applied by `applyTenantScope()` from
     * inside a transaction — see that method for the reasoning. An option here
     * that *looked* like it set tenant scope but could not do so safely is worse
     * than no option at all, because it fails open.
     */
    getConnection(options?: {
        operation?: DbOperation;
    }): Promise<PoolClient>;
    /**
     * Apply the RLS tenant scope (`app.current_project_id`) for the CURRENT
     * TRANSACTION only.
     *
     * ## Why this exists (a real defect, not a style preference)
     *
     * This previously ran in `getConnection()` as:
     *
     *     SET app.current_project_id = $1
     *
     * before any `BEGIN`. A bare `SET` is **session**-scoped, so the value
     * survived `COMMIT`, survived `client.release()`, and stayed attached to the
     * connection sitting in the `pg` pool. The next caller to borrow that
     * connection silently inherited the previous tenant's project id. Nothing
     * ever reset it.
     *
     * That is a cross-tenant state leak in a multi-tenant system. It is currently
     * NOT exploitable — a repo-wide search of `database/migrations/**` found no
     * `CREATE POLICY`, no `ENABLE ROW LEVEL SECURITY`, and no `current_setting`
     * reader, so no query consumes this GUC on the Log DB today. It is a loaded
     * gun rather than a fired one: the moment anyone adds an RLS policy (which is
     * exactly what this setting exists to feed) the leak becomes a tenant
     * data-disclosure bug, and it would be invisible in testing because it only
     * manifests on connection reuse under concurrency.
     *
     * ## Why `set_config(..., true)` rather than `SET LOCAL`
     *
     * `is_local = true` makes the setting transaction-scoped: PostgreSQL reverts
     * it automatically at COMMIT or ROLLBACK, so it is leak-proof *by
     * construction* rather than by remembering to reset it. `set_config()` is also
     * a function call, so the value binds as a real parameter — `SET LOCAL` only
     * accepts a literal, which would have forced string interpolation of a
     * caller-supplied value into SQL.
     *
     * This matches the pattern already used correctly elsewhere in the codebase
     * (`src/modules/analytics/repository.ts`).
     *
     * ## Caller contract — IMPORTANT
     *
     * MUST be called inside an open transaction. Outside one, `is_local = true`
     * applies to the implicit single-statement transaction and is discarded
     * immediately, i.e. it becomes a silent no-op that **fails open** on tenant
     * scoping. It is private for that reason: every call site in this class
     * issues `BEGIN` first, and that invariant is enforced structurally rather
     * than by a runtime probe (which would cost an extra round trip per query on
     * the hot read path).
     */
    private applyTenantScope;
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
     * `SET LOCAL statement_timeout` and/or an RLS tenant scope.
     *
     * A transaction is opened when EITHER a bounded timeout OR a tenant scope is
     * required, because both mechanisms are transaction-scoped. The no-transaction
     * fast path is only taken when neither is needed.
     *
     * Requesting a tenant scope therefore forces a transaction even when the
     * timeout is 0/unbounded. That is deliberate: applying the scope outside a
     * transaction would silently discard it and leave the statement unscoped,
     * which fails open. Correctness wins over saving a round trip.
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
    /**
     * Standard pg Pool used by typed telemetry persistence and analytics SQL.
     * Control-plane repositories must continue using config/database.ts.
     */
    getPrimaryPool(): Pool;
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