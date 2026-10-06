import './dns.js';
import { Pool, type PoolClient } from 'pg';
export declare const pool: Pool;
/**
 * Test connection on startup (fail-fast pattern).
 * Should be called during bootstrap BEFORE the HTTP server starts listening.
 */
export declare const connectDB: () => Promise<void>;
/**
 * Query helper with duration tracking and transient connection retry.
 * Automatically retries if a serverless host dropped the idle socket
 * before or during connection checkout.
 * Slow queries (>1s) are logged at warn level for investigation.
 */
export declare const query: <T extends import("pg").QueryResultRow = any>(text: string, params?: any[]) => Promise<import("pg").QueryResult<T>>;
/**
 * Transaction runner with automatic rollback, dead client cleanup,
 * and transient disconnect retry.
 */
export declare const withTransaction: <T>(fn: (client: PoolClient) => Promise<T>, targetPool?: Pool, options?: {
    maxRetries?: number;
}) => Promise<T>;
/**
 * Graceful shutdown — drains active connections before closing.
 */
export declare const closeDatabase: () => Promise<void>;
//# sourceMappingURL=database.d.ts.map