import { Pool } from 'pg';
/**
 * Primary PostgreSQL connection pool.
 *
 * Tuned for enterprise workloads:
 * - max 20 connections (matches typical PG max_connections / app-instance ratio)
 * - 5 min connections kept warm to avoid cold-start latency
 * - 5s connection timeout to fail fast on network issues
 * - 10s statement/query timeout to prevent runaway queries
 */
export declare const pool: Pool;
/**
 * Test connection on startup (fail-fast pattern).
 * Should be called during bootstrap BEFORE the HTTP server starts listening.
 */
export declare const connectDB: () => Promise<void>;
/**
 * Query helper with duration tracking.
 * Slow queries (>1s) are logged at warn level for investigation.
 */
export declare const query: (text: string, params?: any[]) => Promise<import("pg").QueryResult<any>>;
/**
 * Graceful shutdown — drains active connections before closing.
 */
export declare const closeDatabase: () => Promise<void>;
//# sourceMappingURL=database.d.ts.map