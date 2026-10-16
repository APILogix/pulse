/**
 * Instrumented Database Query Layer.
 *
 * All database operations across Control-Plane (PrimaryDB) and Telemetry (LogDB/TimescaleDB)
 * go through this layer to provide:
 * 1. Required stable query names (compile-time type safety via DbQueryName).
 * 2. Distinct measurement of connection pool wait time vs. query execution time.
 * 3. AsyncLocalStorage integration for request tracing and N+1 detection.
 * 4. PII-safe slow query logging with rate limiting.
 * 5. Complete metrics fail-safety: query execution is NEVER broken if metrics fail.
 */
import type { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import { type DbQueryName } from './query-names.js';
export type DatabaseTarget = 'control' | 'telemetry';
export interface MeasuredQueryOptions {
    db?: DatabaseTarget;
    pool?: Pool;
    client?: PoolClient;
    timeout?: number;
    operation?: 'read' | 'write';
    projectId?: string;
    caller?: string;
    customThresholdMs?: number;
}
export interface MeasuredTransactionClient {
    readonly rawClient: PoolClient;
    query<T extends QueryResultRow = any>(name: DbQueryName, sql: string, params?: unknown[]): Promise<QueryResult<T>>;
    getStats(): {
        statementCount: number;
        totalStatementTimeMs: number;
    };
}
/**
 * Executes an instrumented single query with pool wait time and statement duration separation.
 */
export declare function measuredQuery<T extends QueryResultRow = any>(name: DbQueryName, sql: string, params?: unknown[], options?: MeasuredQueryOptions): Promise<QueryResult<T>>;
/**
 * Wraps a transaction with timing instrumentation:
 * - Records connection acquisition time.
 * - Records time holding the connection vs time spent actively executing queries.
 * - Safely rolls back on error.
 */
export declare function withMeasuredTransaction<T>(name: DbQueryName, fn: (tx: MeasuredTransactionClient) => Promise<T>, options?: {
    db?: DatabaseTarget;
    pool?: Pool;
    timeout?: number;
    projectId?: string;
}): Promise<T>;
/**
 * Ingestion batch performance measurement helper.
 * Tracks batch execution duration and row count while avoiding high-frequency per-row metrics.
 */
export declare function measuredIngestBatch<T>(source: 'logs' | 'spans' | 'metrics' | 'errors', rowCount: number, fn: () => Promise<T>): Promise<T>;
//# sourceMappingURL=query-wrapper.d.ts.map