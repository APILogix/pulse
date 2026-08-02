/**
 * analytics.compaction — rolls 1m → 5m → 1h → 1d.
 *
 * Spec: docs/analytics/06-worker-architecture.md §3.24
 *
 * Merge rules (docs/analytics/07-rollup-tables.md §1):
 *   counters      → SUM
 *   *_max_*       → MAX
 *   *_sum_*       → SUM        (averages are derived at read time)
 *   *_hist        → element-wise SUM, percentiles recomputed from the merge
 *   *_hll         → register-wise MAX (sketch union)
 *   *_exact       → MAX        (honest lower bound when no sketch exists)
 *   last_*        → value from the newest source bucket
 *   text/enum     → value from the newest source bucket
 *
 * The merge is expressed entirely in SQL except for the histogram percentile
 * recomputation and the sketch union, which are applied in a second pass so the
 * mergeable representations stay authoritative.
 */
import { mergeSketches, toBuffer, fromBuffer } from '../hll.js';
import { mergeHistograms, parseHistogram, percentilesFromHistogram } from '../histogram.js';
import { floorToWindow } from '../windows.js';
import { WINDOW_SOURCE, } from '../types.js';
/** Tables that participate in the window hierarchy, with their shape. */
export const COMPACTION_TARGETS = [
    { base: 'request_metrics', shape: 'A', windows: ['1m', '5m', '1h', '1d'] },
    { base: 'endpoint_metrics', shape: 'B', windows: ['1m', '5m', '1h', '1d'] },
    { base: 'service_metrics', shape: 'B', windows: ['1m', '5m', '1h', '1d'] },
    { base: 'error_metrics', shape: 'A', windows: ['1m', '5m', '1h', '1d'] },
    { base: 'error_group_metrics', shape: 'B', windows: ['1m', '1h', '1d'] },
    { base: 'log_metrics', shape: 'A', windows: ['1m', '5m', '1h', '1d'] },
    { base: 'metric_series', shape: 'B', windows: ['1m', '1h', '1d'] },
    { base: 'runtime_metrics', shape: 'B', windows: ['1m', '1h'] },
    { base: 'gc_metrics', shape: 'B', windows: ['1m', '1h'] },
    { base: 'span_metrics', shape: 'B', windows: ['1m', '1h'] },
    { base: 'trace_metrics', shape: 'A', windows: ['1m', '5m', '1h'] },
    { base: 'cron_metrics', shape: 'B', windows: ['1m', '1h'] },
];
const KEY_COLUMNS = new Set(['organization_id', 'project_id', 'environment', 'bucket', 'entity_key']);
const SKIP_COLUMNS = new Set(['updated_at']);
/** Chooses the SQL merge expression for a column based on its name and type. */
export function mergeExpressionFor(column) {
    const { name, dataType } = column;
    if (name === 'entity_label')
        return 'MIN(s.entity_label)';
    if (name.endsWith('_hist'))
        return 'NULL::bigint[]'; // second pass
    if (name.endsWith('_hll'))
        return 'NULL::bytea'; // second pass
    if (name.endsWith('_exact'))
        return `MAX(s.${name})`;
    // Timestamps are checked before the last_* rule so last_seen_at / last_checkin_at
    // merge as MAX rather than "value from the newest bucket".
    if (dataType === 'timestamp with time zone') {
        return name.startsWith('first_') ? `MIN(s.${name})` : `MAX(s.${name})`;
    }
    if (name.startsWith('last_') || name.endsWith('_last')) {
        return `(ARRAY_AGG(s.${name} ORDER BY s.bucket DESC))[1]`;
    }
    if (name.endsWith('_max') || name.endsWith('_max_ms') || name.endsWith('_mb_max')) {
        return `MAX(s.${name})`;
    }
    if (name.endsWith('_min') || name.endsWith('_min_ms'))
        return `MIN(s.${name})`;
    if (/_p(50|75|90|95|99)(_ms)?$/.test(name))
        return 'NULL::numeric'; // recomputed from histogram
    // Averages, rates, scores and percentages are weighted by sample_count so a
    // quiet bucket cannot skew a busy one.
    if (name.endsWith('_avg') ||
        name.endsWith('_avg_ms') ||
        name.endsWith('_pct') ||
        name.endsWith('_rate') ||
        name.endsWith('_score') ||
        name.endsWith('_share_pct')) {
        return `CASE WHEN SUM(s.sample_count) > 0 THEN SUM(s.${name} * s.sample_count) / SUM(s.sample_count) ELSE AVG(s.${name}) END`;
    }
    if (dataType === 'text' || dataType === 'character varying' || dataType === 'character') {
        return `(ARRAY_AGG(s.${name} ORDER BY s.bucket DESC))[1]`;
    }
    if (dataType === 'boolean')
        return `BOOL_OR(s.${name})`;
    if (dataType === 'jsonb')
        return `(ARRAY_AGG(s.${name} ORDER BY s.bucket DESC))[1]`;
    // Everything else is a counter.
    return `COALESCE(SUM(s.${name}), 0)`;
}
async function describeTable(pool, table) {
    const result = await pool.query(`SELECT column_name, data_type
       FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = $1
      ORDER BY ordinal_position`, [table]);
    return result.rows.map((row) => ({ name: row.column_name, dataType: row.data_type }));
}
/**
 * Compacts one table tier for a bucket range.
 *
 * `from`/`to` are event-time bounds on the TARGET window; the source rows are
 * selected by the same bounds, so re-running is idempotent.
 */
export async function compactTier(pool, params) {
    const sourceWindow = WINDOW_SOURCE[params.target];
    const sourceTable = `${params.base}_${sourceWindow}`;
    const targetTable = `${params.base}_${params.target}`;
    const columns = await describeTable(pool, targetTable);
    if (columns.length === 0) {
        return { table: targetTable, window: params.target, rowsWritten: 0 };
    }
    const keyList = params.shape === 'B'
        ? ['organization_id', 'project_id', 'environment', 'bucket', 'entity_key']
        : ['organization_id', 'project_id', 'environment', 'bucket'];
    const valueColumns = columns.filter((column) => !KEY_COLUMNS.has(column.name) && !SKIP_COLUMNS.has(column.name));
    const bucketExpr = params.target === '1d'
        ? "date_trunc('day', s.bucket)"
        : params.target === '1h'
            ? "date_trunc('hour', s.bucket)"
            : "date_trunc('hour', s.bucket) + make_interval(mins => (5 * floor(date_part('minute', s.bucket) / 5)::int))";
    const selectKeys = [
        's.organization_id',
        's.project_id',
        's.environment',
        bucketExpr,
        ...(params.shape === 'B' ? ['s.entity_key'] : []),
    ];
    const insertColumns = [...keyList, ...valueColumns.map((column) => column.name)];
    const selectExpressions = [...selectKeys, ...valueColumns.map(mergeExpressionFor)];
    const updatable = valueColumns.map((column) => `${column.name} = EXCLUDED.${column.name}`);
    const sql = `
    INSERT INTO ${targetTable} (${insertColumns.join(',')})
    SELECT ${selectExpressions.join(',\n           ')}
      FROM ${sourceTable} s
     WHERE s.bucket >= $1 AND s.bucket < $2
     GROUP BY s.organization_id, s.project_id, s.environment, ${bucketExpr}
              ${params.shape === 'B' ? ', s.entity_key' : ''}
    ON CONFLICT (${keyList.join(',')}) DO UPDATE
       SET ${updatable.join(', ')}, updated_at = NOW()`;
    const result = await pool.query(sql, [params.from, params.to]);
    const rowsWritten = result.rowCount ?? 0;
    // Second pass: merge histograms and sketches, then recompute percentiles from
    // the merged histogram. These cannot be expressed in pure SQL without an
    // extension, so they are merged in Node over the affected rows only.
    await mergeDerivedColumns(pool, {
        base: params.base,
        shape: params.shape,
        sourceTable,
        targetTable,
        columns: valueColumns,
        from: params.from,
        to: params.to,
        target: params.target,
    });
    return { table: targetTable, window: params.target, rowsWritten };
}
/** Merges *_hist / *_hll columns and rewrites the percentile columns. */
async function mergeDerivedColumns(pool, params) {
    const histColumns = params.columns.filter((column) => column.name.endsWith('_hist'));
    const hllColumns = params.columns.filter((column) => column.name.endsWith('_hll'));
    if (histColumns.length === 0 && hllColumns.length === 0)
        return;
    const keySelect = params.shape === 'B'
        ? 'organization_id, project_id, environment, entity_key'
        : 'organization_id, project_id, environment';
    const bucketExpr = params.target === '1d'
        ? "date_trunc('day', bucket)"
        : params.target === '1h'
            ? "date_trunc('hour', bucket)"
            : "date_trunc('hour', bucket) + make_interval(mins => (5 * floor(date_part('minute', bucket) / 5)::int))";
    const selectColumns = [...histColumns, ...hllColumns].map((column) => column.name).join(', ');
    const rows = await pool.query(`SELECT ${keySelect}, ${bucketExpr} AS target_bucket, ${selectColumns}
       FROM ${params.sourceTable}
      WHERE bucket >= $1 AND bucket < $2`, [params.from, params.to]);
    if (rows.rows.length === 0)
        return;
    // Group source rows by target key.
    const groups = new Map();
    for (const row of rows.rows) {
        const key = {
            organization_id: row.organization_id,
            project_id: row.project_id,
            environment: row.environment,
            target_bucket: row.target_bucket,
            ...(params.shape === 'B' ? { entity_key: row.entity_key } : {}),
        };
        const id = JSON.stringify(key);
        const entry = groups.get(id);
        if (entry)
            entry.rows.push(row);
        else
            groups.set(id, { key, rows: [row] });
    }
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        for (const { key, rows: groupRows } of groups.values()) {
            const assignments = [];
            const values = [];
            for (const column of histColumns) {
                const merged = mergeHistograms(groupRows.map((row) => parseHistogram(row[column.name])));
                values.push(merged);
                assignments.push(`${column.name} = $${values.length}::bigint[]`);
                // Percentile columns share the histogram's prefix, e.g. latency_hist →
                // latency_p50_ms … latency_p99_ms.
                const prefix = column.name.slice(0, -'_hist'.length);
                const percentiles = percentilesFromHistogram(merged);
                const suffixMap = [
                    [`${prefix}_p50_ms`, percentiles.p50],
                    [`${prefix}_p75_ms`, percentiles.p75],
                    [`${prefix}_p90_ms`, percentiles.p90],
                    [`${prefix}_p95_ms`, percentiles.p95],
                    [`${prefix}_p99_ms`, percentiles.p99],
                ];
                for (const [name, value] of suffixMap) {
                    if (!params.columns.some((candidate) => candidate.name === name))
                        continue;
                    values.push(value);
                    assignments.push(`${name} = $${values.length}::numeric`);
                }
            }
            for (const column of hllColumns) {
                const merged = mergeSketches(groupRows.map((row) => fromBuffer(row[column.name])));
                values.push(toBuffer(merged));
                assignments.push(`${column.name} = $${values.length}::bytea`);
            }
            if (assignments.length === 0)
                continue;
            values.push(key.organization_id, key.project_id, key.environment, key.target_bucket);
            const orgParam = values.length - 3;
            const whereParts = [
                `organization_id = $${orgParam}`,
                `project_id = $${orgParam + 1}`,
                `environment = $${orgParam + 2}`,
                `bucket = $${orgParam + 3}`,
            ];
            if (params.shape === 'B') {
                values.push(key.entity_key);
                whereParts.push(`entity_key = $${values.length}`);
            }
            await client.query(`UPDATE ${params.targetTable} SET ${assignments.join(', ')}, updated_at = NOW()
          WHERE ${whereParts.join(' AND ')}`, values);
        }
        await client.query('COMMIT');
    }
    catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
    }
    finally {
        client.release();
    }
}
/**
 * Compacts every table for one target window over a trailing range.
 * Called by the scheduled platform job; not per-organization.
 */
export async function runCompaction(pool, logger, target, now = new Date()) {
    // Recompute a small trailing range so late data folded into the finer tier
    // propagates upwards. Two target buckets is enough given the 1m grace window.
    const lookbackBuckets = 3;
    const to = floorToWindow(now, target);
    const from = new Date(target === '1d'
        ? to.getTime() - lookbackBuckets * 86_400_000
        : target === '1h'
            ? to.getTime() - lookbackBuckets * 3_600_000
            : to.getTime() - lookbackBuckets * 300_000);
    const results = [];
    for (const entry of COMPACTION_TARGETS) {
        if (!entry.windows.includes(target))
            continue;
        try {
            results.push(await compactTier(pool, {
                base: entry.base,
                shape: entry.shape,
                target,
                from,
                // Include the in-progress bucket so dashboards see partial data early.
                to: new Date(to.getTime() + (target === '1d' ? 86_400_000 : target === '1h' ? 3_600_000 : 300_000)),
                logger,
            }));
        }
        catch (error) {
            logger.error({ err: error, base: entry.base, target }, 'Analytics compaction failed for one table; continuing with the rest');
        }
    }
    return results;
}
//# sourceMappingURL=compaction.worker.js.map