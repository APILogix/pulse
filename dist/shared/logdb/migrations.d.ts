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
export interface ApplyLogDbMigrationsOptions {
    dryRun?: boolean;
    only?: string[];
    logger?: Logger;
}
export interface ApplyLogDbMigrationsResult {
    directory: string;
    found: number;
    applied: number;
    skipped: number;
    failed: number;
}
export declare function findLogDbMigrationFiles(dir?: string, root?: string): Promise<LogDbMigrationFile[]>;
export declare function applyLogDbMigrations(pool: Pool, options?: ApplyLogDbMigrationsOptions): Promise<ApplyLogDbMigrationsResult>;
//# sourceMappingURL=migrations.d.ts.map