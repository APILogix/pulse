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
import { SHAPE_A_KEYS, SHAPE_B_KEYS, } from './types.js';
/** Postgres caps a statement at 65535 bound parameters; leave headroom. */
const MAX_BIND_PARAMS = 60_000;
const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;
export function keyColumnsFor(shape) {
    return shape === 'B' ? SHAPE_B_KEYS : SHAPE_A_KEYS;
}
function assertIdentifier(name, kind) {
    if (!IDENTIFIER.test(name)) {
        throw new Error(`Analytics rollup ${kind} is not a safe identifier: ${name}`);
    }
}
/**
 * Builds one `INSERT … ON CONFLICT DO UPDATE` for a chunk of rows.
 * Exposed separately from execution so tests can assert the SQL shape without a
 * database.
 */
export function buildUpsert(table, shape, columns, rows) {
    assertIdentifier(table, 'table');
    for (const column of columns)
        assertIdentifier(column, 'column');
    const keys = keyColumnsFor(shape);
    const missingKeys = keys.filter((key) => !columns.includes(key));
    if (missingKeys.length > 0) {
        throw new Error(`Analytics rollup ${table} is missing shape ${shape} key column(s): ${missingKeys.join(', ')}`);
    }
    const updatable = columns.filter((column) => !keys.includes(column) && column !== 'updated_at');
    const values = [];
    const tuples = [];
    rows.forEach((row) => {
        if (row.length !== columns.length) {
            throw new Error(`Analytics rollup ${table} row arity ${row.length} does not match ${columns.length} columns`);
        }
        const placeholders = row.map((value) => {
            values.push(value);
            return `$${values.length}`;
        });
        tuples.push(`(${placeholders.join(',')})`);
    });
    const setClause = [
        ...updatable.map((column) => `${column} = EXCLUDED.${column}`),
        'updated_at = NOW()',
    ].join(', ');
    const sql = `INSERT INTO ${table} (${columns.join(',')}) VALUES ${tuples.join(',')} ` +
        `ON CONFLICT (${keys.join(',')}) DO UPDATE SET ${setClause}`;
    return { sql, values, rowCount: rows.length };
}
/** Rows per statement given the column count. */
export function chunkSize(columnCount) {
    return Math.max(1, Math.floor(MAX_BIND_PARAMS / Math.max(1, columnCount)));
}
/** Splits rows into parameter-safe chunks. */
export function chunkRows(rows, columnCount) {
    const size = chunkSize(columnCount);
    const out = [];
    for (let i = 0; i < rows.length; i += size) {
        out.push(rows.slice(i, i + size));
    }
    return out;
}
/**
 * Executes an upsert set on an existing client (the caller owns the
 * transaction, so the rollup write and the watermark advance commit together).
 */
export async function writeRollup(client, upsert) {
    if (upsert.rows.length === 0)
        return 0;
    let written = 0;
    for (const chunk of chunkRows(upsert.rows, upsert.columns.length)) {
        const built = buildUpsert(upsert.table, upsert.shape, upsert.columns, chunk);
        const result = await client.query(built.sql, built.values);
        written += result.rowCount ?? chunk.length;
    }
    return written;
}
export async function writeRollups(client, upserts) {
    let written = 0;
    for (const upsert of upserts) {
        written += await writeRollup(client, upsert);
    }
    return written;
}
/**
 * Deletes rows for a bucket range before a rebuild. Used only by workers whose
 * entity set can shrink between runs (e.g. top-K entity rollups), where a pure
 * upsert would leave stale entities behind.
 */
export async function clearRollupRange(client, table, organizationId, from, to) {
    assertIdentifier(table, 'table');
    const result = await client.query(`DELETE FROM ${table}
      WHERE organization_id = $1 AND bucket >= $2 AND bucket < $3`, [organizationId, from, to]);
    return result.rowCount ?? 0;
}
/**
 * Convenience builder used by workers that aggregate in SQL and want to persist
 * `INSERT … SELECT` results directly. The select must project the columns in the
 * same order as `columns`.
 */
export function buildInsertSelect(table, shape, columns, selectSql) {
    assertIdentifier(table, 'table');
    for (const column of columns)
        assertIdentifier(column, 'column');
    const keys = keyColumnsFor(shape);
    const updatable = columns.filter((column) => !keys.includes(column) && column !== 'updated_at');
    const setClause = [
        ...updatable.map((column) => `${column} = EXCLUDED.${column}`),
        'updated_at = NOW()',
    ].join(', ');
    return (`INSERT INTO ${table} (${columns.join(',')}) ${selectSql} ` +
        `ON CONFLICT (${keys.join(',')}) DO UPDATE SET ${setClause}`);
}
//# sourceMappingURL=rollup-writer.js.map