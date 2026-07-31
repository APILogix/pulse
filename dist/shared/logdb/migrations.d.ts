import type { Pool } from 'pg';
import type { Logger } from 'pino';
export declare const LOGDB_MIGRATIONS_DIR: string;
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