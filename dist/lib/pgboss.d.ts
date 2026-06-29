import { PgBoss } from 'pg-boss';
/**
 * Enterprise PgBoss Singleton.
 * Uses its own connection pool for queueing and pub/sub to avoid
 * exhausting the primary application query pool.
 */
export declare const pgboss: PgBoss;
/**
 * Initializes the PgBoss instance (runs schema creation if missing).
 */
export declare function startPgBoss(): Promise<void>;
/**
 * Gracefully shuts down PgBoss.
 */
export declare function stopPgBoss(): Promise<void>;
//# sourceMappingURL=pgboss.d.ts.map