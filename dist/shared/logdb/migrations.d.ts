import type { Pool, PoolClient } from 'pg';
import type { Logger } from 'pino';
export declare const LOGDB_MIGRATIONS_DIR: string;
export declare const LOGDB_MIGRATION_LOCK_KEY = 74373201;
/**
 * Serialize forward and rollback operations without waiting indefinitely.
 * Advisory locks are session-scoped, so callers must hold the same client
 * until releaseLogDbMigrationLock() completes.
 */
export declare function acquireLogDbMigrationLock(client: PoolClient): Promise<void>;
export declare function releaseLogDbMigrationLock(client: PoolClient): Promise<void>;
export interface LogDbMigrationFile {
    filename: string;
    filepath: string;
    basename: string;
}
export type LogDbMigrationExecutionMode = 'automatic' | 'operator';
export interface ApplyLogDbMigrationsOptions {
    dryRun?: boolean;
    only?: string[];
    logger?: Logger;
    /**
     * `automatic` is for unattended process startup and defers migrations marked
     * `requires-operator-drain`. `operator` executes every selected migration and
     * leaves each migration's own safety gates authoritative.
     *
     * Defaults to `operator` when omitted. A no-options call executes every
     * pending migration's SQL unconditionally, including drain-gated files like
     * `030_events_logs_idempotency.up.sql` — safe only against an empty/fresh
     * database (e.g. scratch test pools). Never call this without
     * `executionMode: 'automatic'` from unattended process startup against a
     * live/populated database.
     */
    executionMode?: LogDbMigrationExecutionMode;
}
export interface ApplyLogDbMigrationsResult {
    directory: string;
    found: number;
    applied: number;
    skipped: number;
    /** Pending operator-only migrations included in `skipped`. */
    deferred: number;
    failed: number;
}
export declare function findLogDbMigrationFiles(dir?: string, root?: string): Promise<LogDbMigrationFile[]>;
export declare function requiresOperatorDrain(sql: string): boolean;
export declare function applyLogDbMigrations(pool: Pool, options?: ApplyLogDbMigrationsOptions): Promise<ApplyLogDbMigrationsResult>;
//# sourceMappingURL=migrations.d.ts.map