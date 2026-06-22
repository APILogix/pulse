import { type PoolClient, type QueryResult, type QueryResultRow } from 'pg';
/**
 * LogDatabaseManager — enterprise-grade dual-pool manager for the log database.
 *
 * Architecture:
 * - Primary pool: handles all writes (INSERT, UPDATE, DELETE) and DDL
 * - Replica pool: handles read-heavy queries (SELECT) to offload the primary
 * - Falls back to primary for reads when no replica is configured
 *
 * Features:
 * - Retry with exponential backoff (skips non-retryable errors like constraint violations)
 * - Slow query detection and logging
 * - Batch insert for high-throughput event ingestion
 * - Health check for load-balancer probes
 */
declare class LogDatabaseManager {
    private primaryPool;
    private replicaPool;
    private isShuttingDown;
    constructor();
    /**
     * Creates a configured connection pool with monitoring.
     */
    private createPool;
    /**
     * Test connections on startup (fail-fast pattern).
     * Verifies both primary and replica (if configured) are reachable.
     */
    connect(): Promise<{
        primary: Date;
        replica?: Date;
    }>;
    private setupPoolMonitoring;
    /**
     * Get a connection from the appropriate pool.
     *
     * @param operation - 'read' routes to replica (if available), 'write' always uses primary.
     * @param projectId - Optional project ID to set as a session variable for RLS.
     */
    getConnection(options?: {
        operation?: 'read' | 'write';
        projectId?: string | undefined;
    }): Promise<PoolClient>;
    /**
     * Execute a query with retry logic and exponential backoff.
     *
     * Non-retryable errors (constraint violations, permission denied, syntax errors)
     * are thrown immediately without retry.
     */
    queryWithRetry<T extends QueryResultRow = any>(sql: string, params?: any[], options?: {
        maxRetries?: number;
        operation?: 'read' | 'write';
        projectId?: string | undefined;
        timeout?: number;
    }): Promise<QueryResult<T>>;
    /**
     * Batch insert events using multi-row INSERT.
     * Suitable for batches up to ~1000 rows. For larger batches, consider COPY protocol.
     */
    batchInsertEvents(events: Array<{
        project_id: string;
        type: string;
        timestamp: Date;
        payload: object;
    }>): Promise<void>;
    private insertRequests;
    private insertErrors;
    /**
     * Health check — verifies primary (and optionally replica) connectivity.
     */
    healthCheck(): Promise<{
        healthy: boolean;
        primary?: Date;
        replica?: Date;
    }>;
    /**
     * Returns true if a replica pool is configured and available.
     */
    get hasReplica(): boolean;
    /**
     * Graceful shutdown — drains both pools.
     */
    close(): Promise<void>;
}
export declare const logDB: LogDatabaseManager;
export declare const logQuery: <T extends QueryResultRow = any>(sql: string, params?: any[], options?: Parameters<(typeof logDB)["queryWithRetry"]>[2]) => Promise<QueryResult<T>>;
export declare const connectLogDB: () => Promise<{
    primary: Date;
    replica?: Date;
}>;
export {};
//# sourceMappingURL=log-database.d.ts.map