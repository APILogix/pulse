import type { PoolConfig } from 'pg';
export interface PostgresSslOptions {
    enabled?: boolean | undefined;
    rejectUnauthorized?: boolean | undefined;
}
/**
 * Resolves SSL configuration for PostgreSQL connections.
 * Automatically enables SSL for Neon, Supabase, and other managed Postgres platforms
 * while respecting explicit overrides and URL query parameters.
 */
export declare function resolvePostgresSslConfig(connectionString: string, options?: PostgresSslOptions): PoolConfig['ssl'];
/**
 * Identifies expected serverless / idle disconnects from managed providers like Neon.
 * Neon suspends idle compute and PgBouncer closes idle sockets. When this occurs,
 * pool error listeners should log at debug level rather than fatal error level.
 */
export declare function isExpectedServerlessDisconnect(err: unknown): boolean;
/**
 * Identifies transient connection errors that can be safely retried
 * during database operations or pg-boss background ticks.
 */
export declare function isTransientPostgresError(err: unknown): boolean;
//# sourceMappingURL=postgres-ssl.d.ts.map