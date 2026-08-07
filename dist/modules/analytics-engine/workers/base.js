/**
 * Shared execution harness for every analytics rollup worker.
 *
 * Responsibilities (docs/analytics/00-architecture-overview.md §4):
 *   1. read the watermark and derive the ingest-time slice to consume
 *   2. bound the slice by ANALYTICS_BATCH_MAX_ROWS (bisect until it fits)
 *   3. recompute every *event-time bucket touched by that slice*, in full
 *   4. write rollups and advance the watermark in ONE transaction
 *   5. record the run in analytics_worker_runs
 *
 * Step 3 is the reason the engine is idempotent: a bucket is always rebuilt from
 * raw rows, never incremented, so replaying a slice converges to the same value.
 */
import { AnalyticsWatermarkRepository, } from '../watermark.repository.js';
import { buildInsertSelect } from '../rollup-writer.js';
import { bucketExpression, computeRunWindow, floorToWindow } from '../windows.js';
import { ALL_ENVIRONMENTS_SENTINEL, ALL_PROJECTS_SENTINEL, WINDOW_SECONDS, } from '../types.js';
/** Interval literal for a window, used to close the recompute range. */
export function windowInterval(window) {
    return `${WINDOW_SECONDS[window]} seconds`;
}
/**
 * Builds the whole-bucket recompute statement.
 *
 * Parameter contract: $1 = orgId, $2 = ingestStart, $3 = ingestEnd,
 * $4 = recomputeFrom (event-time floor), $5.. = caller extras.
 *
 * Rows with a NULL project_id are excluded: rollup primary keys are total, and
 * ingestion always attributes events to a project. Documented in
 * docs/analytics/07-rollup-tables.md §1.
 */
export function buildBucketRecomputeSql(options) {
    const { source, timeColumn = 'occurred_at', ingestColumn = 'ingested_at', window, where, entityKeyExpr, entityLabelExpr, aggregates, columns, includeSentinelRows = true, } = options;
    const bucket = bucketExpression(`e.${timeColumn}`, window);
    const baseWhere = [
        'e.organization_id = $1',
        'e.project_id IS NOT NULL',
        ...(where ? [where] : []),
    ].join(' AND ');
    const groupingSets = includeSentinelRows
        ? [
            `(e.organization_id, e.project_id, e.environment, ${bucket}${entityKeyExpr ? `, ${entityKeyExpr}` : ''})`,
            `(e.organization_id, e.project_id, ${bucket}${entityKeyExpr ? `, ${entityKeyExpr}` : ''})`,
            `(e.organization_id, ${bucket}${entityKeyExpr ? `, ${entityKeyExpr}` : ''})`,
        ]
        : [
            `(e.organization_id, e.project_id, e.environment, ${bucket}${entityKeyExpr ? `, ${entityKeyExpr}` : ''})`,
        ];
    const projectProjection = includeSentinelRows
        ? `CASE WHEN GROUPING(e.project_id) = 1 THEN '${ALL_PROJECTS_SENTINEL}'::uuid ELSE e.project_id END`
        : 'e.project_id';
    const environmentProjection = includeSentinelRows
        ? `CASE WHEN GROUPING(e.environment) = 1 THEN '${ALL_ENVIRONMENTS_SENTINEL}' ELSE e.environment END`
        : 'e.environment';
    const keyProjections = [
        'e.organization_id',
        projectProjection,
        environmentProjection,
        bucket,
        ...(entityKeyExpr ? [entityKeyExpr] : []),
        ...(entityKeyExpr && entityLabelExpr ? [`MIN(${entityLabelExpr})`] : []),
    ];
    // Arity guard: the INSERT column list must line up exactly with
    // key projections + aggregates, or Postgres would silently shift values
    // between columns of compatible types.
    const expectedColumns = keyProjections.length + aggregates.length;
    if (columns.length !== expectedColumns) {
        throw new Error(`Analytics rollup arity mismatch for ${source}: ${columns.length} columns ` +
            `but ${keyProjections.length} key projections + ${aggregates.length} aggregates ` +
            `= ${expectedColumns}`);
    }
    // NOTE: no trailing SQL comment here — this fragment is embedded before an
    // ON CONFLICT clause by buildInsertSelect, and a line comment would swallow it.
    return `
    WITH touched AS (
      SELECT DISTINCT ${bucket} AS bucket
        FROM ${source} e
       WHERE ${baseWhere}
         AND e.${ingestColumn} >= $2
         AND e.${ingestColumn} <  $3
         AND e.${timeColumn}   >= $4
    ),
    bounds AS (
      SELECT MIN(bucket) AS lo, MAX(bucket) AS hi FROM touched
    )
    SELECT ${[...keyProjections, ...aggregates].join(',\n           ')}
      FROM ${source} e
      JOIN touched t ON ${bucket} = t.bucket
     WHERE ${baseWhere}
       AND e.${timeColumn} >= (SELECT lo FROM bounds)
       AND e.${timeColumn} <  (SELECT hi FROM bounds) + INTERVAL '${windowInterval(window)}'
     GROUP BY GROUPING SETS (
       ${groupingSets.join(',\n       ')}
     )
  `.trim();
}
/** Counts rows in a candidate slice so the batch guard can bisect. */
async function countSlice(pool, params) {
    const where = [
        'e.organization_id = $1',
        'e.project_id IS NOT NULL',
        `e.${params.ingestColumn} >= $2`,
        `e.${params.ingestColumn} <  $3`,
        `e.${params.timeColumn}   >= $4`,
        ...(params.where ? [params.where] : []),
    ].join(' AND ');
    const result = await pool.query(`SELECT COUNT(*)::bigint AS count FROM ${params.table} e WHERE ${where}`, [params.orgId, params.start, params.end, params.recomputeFrom]);
    return Number(result.rows[0]?.count ?? 0);
}
/**
 * Executes one worker run end to end. Returns a result the caller records; it
 * never throws for expected conditions (empty slice, nothing touched).
 */
export async function runRollupWorker(ctx, job, watermarks, params) {
    const { pool, logger, now, config } = ctx;
    const timeColumn = params.sizingTimeColumn ?? 'occurred_at';
    const ingestColumn = params.sizingIngestColumn ?? 'ingested_at';
    const watermark = await watermarks.acquire(params.workerId, job.orgId, params.window, now);
    const spanMinutes = AnalyticsWatermarkRepository.effectiveSpanMinutes(Math.min(params.maxSpanMinutes, config.maxWindowSpanMinutes), watermark.consecutiveFailures);
    const runWindow = computeRunWindow({
        watermarkAt: watermark.watermarkAt,
        now,
        maxSpanMinutes: spanMinutes,
        lateGraceSeconds: Math.min(params.lateGraceSeconds, config.lateEventGraceSeconds),
        window: params.window,
    });
    if (runWindow.empty) {
        return {
            outcome: 'skipped',
            rowsRead: 0,
            rowsWritten: 0,
            watermarkAt: watermark.watermarkAt,
            lastBucketAt: watermark.lastBucketAt ?? undefined,
        };
    }
    // Explicit recompute request (backfill / manual repair) overrides the floor.
    const recomputeFrom = job.recomputeFrom
        ? floorToWindow(new Date(job.recomputeFrom), params.window)
        : runWindow.recomputeFrom;
    // ── Batch guard: bisect the ingest slice until it fits the row ceiling ──
    let ingestEnd = runWindow.end;
    let rowsInSlice = 0;
    for (let attempt = 0; attempt < 6; attempt += 1) {
        rowsInSlice = await countSlice(pool, {
            table: params.sizingTable,
            where: params.sizingWhere,
            timeColumn,
            ingestColumn,
            orgId: job.orgId,
            start: runWindow.start,
            end: ingestEnd,
            recomputeFrom,
        });
        if (rowsInSlice <= config.batchMaxRows)
            break;
        const halfMs = Math.floor((ingestEnd.getTime() - runWindow.start.getTime()) / 2);
        if (halfMs < 1_000)
            break;
        ingestEnd = new Date(runWindow.start.getTime() + halfMs);
        logger.debug({ worker: params.workerId, orgId: job.orgId, rowsInSlice, ingestEnd }, 'Analytics batch guard narrowed the ingest slice');
    }
    if (rowsInSlice === 0) {
        // Nothing arrived in this slice: advance past it so the watermark keeps up.
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            await watermarks.advance(client, {
                workerId: params.workerId,
                organizationId: job.orgId,
                windowSize: params.window,
                watermarkAt: ingestEnd,
                lastBucketAt: watermark.lastBucketAt ?? undefined,
                rowsProcessed: 0,
            });
            await client.query('COMMIT');
        }
        catch (error) {
            await client.query('ROLLBACK').catch(() => undefined);
            throw error;
        }
        finally {
            client.release();
        }
        return {
            outcome: 'success',
            rowsRead: 0,
            rowsWritten: 0,
            watermarkAt: ingestEnd,
            lastBucketAt: watermark.lastBucketAt ?? undefined,
        };
    }
    const slice = {
        orgId: job.orgId,
        ingestStart: runWindow.start,
        ingestEnd,
        recomputeFrom,
        window: params.window,
        rowsInSlice,
    };
    const statements = await params.statements(slice);
    const client = await pool.connect();
    let rowsWritten = 0;
    try {
        await client.query('BEGIN');
        if (config.statementTimeoutMs > 0) {
            await client.query(`SET LOCAL statement_timeout = ${config.statementTimeoutMs}`);
        }
        for (const statement of statements) {
            const result = await client.query(statement.sql, statement.params);
            rowsWritten += result.rowCount ?? 0;
        }
        if (params.afterWrite)
            await params.afterWrite(client, slice);
        await watermarks.advance(client, {
            workerId: params.workerId,
            organizationId: job.orgId,
            windowSize: params.window,
            watermarkAt: ingestEnd,
            lastBucketAt: now,
            rowsProcessed: rowsInSlice,
        });
        await client.query('COMMIT');
    }
    catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
    }
    finally {
        client.release();
    }
    return {
        outcome: 'success',
        rowsRead: rowsInSlice,
        rowsWritten,
        watermarkAt: ingestEnd,
        lastBucketAt: now,
    };
}
/** Shared aggregate fragments used by several workers. */
export const AGG = {
    /** Exact distinct count for a column (correct for the bucket it is stored in). */
    distinct: (column) => `COUNT(DISTINCT ${column})::bigint`,
    count: () => 'COUNT(*)::bigint',
    filterCount: (predicate) => `COUNT(*) FILTER (WHERE ${predicate})::bigint`,
    sum: (column) => `COALESCE(SUM(${column}), 0)`,
    max: (column) => `MAX(${column})`,
    avg: (column) => `AVG(${column})`,
    percentile: (column, q) => `PERCENTILE_CONT(${q}) WITHIN GROUP (ORDER BY ${column})`,
};
/** Logger child helper so every worker logs with the same shape. */
export function workerLogger(logger, workerId) {
    return logger.child({ component: 'analytics-engine', worker: workerId });
}
/**
 * Builds a worker spec from a declaration. Every P0/P1 domain worker uses this,
 * which is what keeps 20+ workers consistent: same batching, same idempotency,
 * same watermark handling, same transaction boundary.
 */
export function defineSimpleRollupWorker(definition, watermarks) {
    const lateGraceSeconds = definition.lateGraceSeconds ?? 900;
    const maxSpanMinutes = definition.maxSpanMinutes ?? 60;
    const extraOutputs = new Set([definition.table]);
    return {
        id: definition.id,
        queue: definition.id,
        tier: definition.tier,
        windowSize: definition.window,
        sourceTables: [definition.source],
        outputTables: [...extraOutputs],
        concurrency: definition.concurrency ?? 4,
        retryLimit: definition.retryLimit ?? 5,
        retryBackoffSeconds: definition.retryBackoffSeconds ?? 30,
        lateGraceSeconds,
        maxSpanMinutes,
        description: definition.description,
        async run(ctx, job) {
            return runRollupWorker(ctx, job, watermarks, {
                workerId: definition.id,
                window: definition.window,
                sizingTable: definition.source,
                ...(definition.where ? { sizingWhere: definition.where } : {}),
                ...(definition.timeColumn ? { sizingTimeColumn: definition.timeColumn } : {}),
                lateGraceSeconds,
                maxSpanMinutes,
                statements: (slice) => {
                    const select = buildBucketRecomputeSql({
                        source: definition.source,
                        window: definition.window,
                        aggregates: definition.aggregates(ctx.config),
                        columns: definition.columns,
                        ...(definition.where ? { where: definition.where } : {}),
                        ...(definition.entityKeyExpr ? { entityKeyExpr: definition.entityKeyExpr } : {}),
                        ...(definition.entityLabelExpr ? { entityLabelExpr: definition.entityLabelExpr } : {}),
                        ...(definition.timeColumn ? { timeColumn: definition.timeColumn } : {}),
                    });
                    const statements = [
                        {
                            table: definition.table,
                            sql: buildInsertSelect(definition.table, definition.shape, definition.columns, select),
                            params: [slice.orgId, slice.ingestStart, slice.ingestEnd, slice.recomputeFrom],
                        },
                    ];
                    if (definition.extraStatements) {
                        statements.push(...definition.extraStatements(slice, ctx.config));
                    }
                    return statements;
                },
                ...(definition.afterWrite
                    ? {
                        afterWrite: async (client, slice) => definition.afterWrite(client, slice, ctx),
                    }
                    : {}),
            });
        },
    };
}
//# sourceMappingURL=base.js.map