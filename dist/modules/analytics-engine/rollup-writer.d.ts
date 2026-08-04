/**
 * Idempotent rollup writer.
 *
 * Every analytics worker writes through this helper so the whole engine shares
 * one set of guarantees (docs/analytics/00-architecture-overview.md §4):
 *
 *   - whole-bucket recompute, never increment → replaying a window converges
 *   - single statement per table per batch    → one round trip, one lock window
 *   - `ON CONFLICT DO UPDATE` on the shape's key columns
 *   - parameter-count aware chunking          → never exceeds Postgres' 65535 limit
 *
 * Column names come from code (never from a request), so identifier
 * interpolation here is safe; all values are bound parameters.
 */
import type { PoolClient } from 'pg';
import { type RollupShape, type RollupUpsert } from './types.js';
export declare function keyColumnsFor(shape: RollupShape): readonly string[];
export interface BuiltUpsert {
    sql: string;
    values: unknown[];
    rowCount: number;
}
/**
 * Builds one `INSERT … ON CONFLICT DO UPDATE` for a chunk of rows.
 * Exposed separately from execution so tests can assert the SQL shape without a
 * database.
 */
export declare function buildUpsert(table: string, shape: RollupShape, columns: readonly string[], rows: readonly unknown[][]): BuiltUpsert;
/** Rows per statement given the column count. */
export declare function chunkSize(columnCount: number): number;
/** Splits rows into parameter-safe chunks. */
export declare function chunkRows<T>(rows: readonly T[], columnCount: number): T[][];
/**
 * Executes an upsert set on an existing client (the caller owns the
 * transaction, so the rollup write and the watermark advance commit together).
 */
export declare function writeRollup(client: PoolClient, upsert: RollupUpsert): Promise<number>;
export declare function writeRollups(client: PoolClient, upserts: readonly RollupUpsert[]): Promise<number>;
/**
 * Deletes rows for a bucket range before a rebuild. Used only by workers whose
 * entity set can shrink between runs (e.g. top-K entity rollups), where a pure
 * upsert would leave stale entities behind.
 */
export declare function clearRollupRange(client: PoolClient, table: string, organizationId: string, from: Date, to: Date): Promise<number>;
/**
 * Convenience builder used by workers that aggregate in SQL and want to persist
 * `INSERT … SELECT` results directly. The select must project the columns in the
 * same order as `columns`.
 */
export declare function buildInsertSelect(table: string, shape: RollupShape, columns: readonly string[], selectSql: string): string;
//# sourceMappingURL=rollup-writer.d.ts.map