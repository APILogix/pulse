import { Pool } from 'pg';
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