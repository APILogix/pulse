/**
 * analytics.geo — country/region traffic plus browser/OS/device breakdowns.
 *
 * Spec: docs/analytics/06-worker-architecture.md §3.14
 * Metrics: docs/analytics/10-analytics-catalog.md §12
 *
 * Reads  : events_requests (geo_country_code, geo_region, browser_family, os_name, device_type)
 * Writes : geo_metrics_1h, device_metrics_1h
 *
 * This worker is what replaces `countryForIp()` and `bucketUserAgent()` — the
 * frontend's first-IP-octet geography and browser regex
 * (docs/analytics/02-dummy-data-audit.md §2).
 */
import { histogramSql } from '../histogram.js';
import { AGG, defineSimpleRollupWorker } from './base.js';
import { applySketchPass } from './sketches.js';
const SOURCE = 'events_requests';
const GEO_TABLE = 'geo_metrics_1h';
const DEVICE_TABLE = 'device_metrics_1h';
const GEO_ENTITY = "COALESCE(e.geo_country_code, 'ZZ') || ':' || COALESCE(e.geo_region, '')";
const GEO_COLUMNS = [
    'organization_id',
    'project_id',
    'environment',
    'bucket',
    'entity_key',
    'entity_label',
    'country_code',
    'region',
    'request_count',
    'error_count',
    'asn_count',
    'latency_sum_ms',
    'latency_max_ms',
    'latency_p50_ms',
    'latency_p75_ms',
    'latency_p90_ms',
    'latency_p95_ms',
    'latency_p99_ms',
    'latency_hist',
    'unique_users_exact',
    'sample_count',
];
/**
 * Device breakdown unfolds three dimensions into one entity-keyed table, so it
 * needs an explicit UNION ALL rather than the generic recompute helper.
 */
function deviceStatement(orgParams) {
    const sql = `
    INSERT INTO ${DEVICE_TABLE} (
      organization_id, project_id, environment, bucket, entity_key, entity_label,
      dimension, dimension_value, request_count, error_count,
      latency_sum_ms, latency_max_ms,
      latency_p50_ms, latency_p75_ms, latency_p90_ms, latency_p95_ms, latency_p99_ms,
      latency_hist, unique_users_exact, sample_count
    )
    WITH touched AS (
      SELECT DISTINCT date_trunc('hour', e.occurred_at) AS bucket
        FROM ${SOURCE} e
       WHERE e.organization_id = $1
         AND e.project_id IS NOT NULL
         AND e.ingested_at >= $2 AND e.ingested_at < $3
         AND e.occurred_at   >= $4
    ),
    bounds AS (SELECT MIN(bucket) AS lo, MAX(bucket) AS hi FROM touched),
    scoped AS (
      SELECT e.organization_id, e.project_id, e.environment,
             date_trunc('hour', e.occurred_at) AS bucket,
             e.user_id, e.latency_ms, e.status_code,
             e.browser_family, e.os_name, e.device_type
        FROM ${SOURCE} e
        JOIN touched t ON date_trunc('hour', e.occurred_at) = t.bucket
       WHERE e.organization_id = $1
         AND e.project_id IS NOT NULL
         AND e.occurred_at >= (SELECT lo FROM bounds)
         AND e.occurred_at <  (SELECT hi FROM bounds) + INTERVAL '1 hour'
    ),
    unfolded AS (
      SELECT organization_id, project_id, environment, bucket, user_id, latency_ms, status_code,
             'browser' AS dimension, COALESCE(browser_family, 'unknown') AS dimension_value FROM scoped
      UNION ALL
      SELECT organization_id, project_id, environment, bucket, user_id, latency_ms, status_code,
             'os', COALESCE(os_name, 'unknown') FROM scoped
      UNION ALL
      SELECT organization_id, project_id, environment, bucket, user_id, latency_ms, status_code,
             'device_type', COALESCE(device_type, 'unknown') FROM scoped
    )
    SELECT organization_id,
           project_id,
           environment,
           bucket,
           dimension || ':' || dimension_value AS entity_key,
           dimension_value                     AS entity_label,
           dimension,
           dimension_value,
           COUNT(*)::bigint,
           COUNT(*) FILTER (WHERE status_code >= 500)::bigint,
           COALESCE(SUM(latency_ms), 0),
           MAX(latency_ms),
           PERCENTILE_CONT(0.5)  WITHIN GROUP (ORDER BY latency_ms),
           PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY latency_ms),
           PERCENTILE_CONT(0.9)  WITHIN GROUP (ORDER BY latency_ms),
           PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms),
           PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY latency_ms),
           ${histogramSql('latency_ms')},
           COUNT(DISTINCT user_id)::bigint,
           COUNT(*)::bigint
      FROM unfolded
     GROUP BY organization_id, project_id, environment, bucket, dimension, dimension_value
    ON CONFLICT (organization_id, project_id, environment, bucket, entity_key) DO UPDATE
       SET entity_label       = EXCLUDED.entity_label,
           dimension          = EXCLUDED.dimension,
           dimension_value    = EXCLUDED.dimension_value,
           request_count      = EXCLUDED.request_count,
           error_count        = EXCLUDED.error_count,
           latency_sum_ms     = EXCLUDED.latency_sum_ms,
           latency_max_ms     = EXCLUDED.latency_max_ms,
           latency_p50_ms     = EXCLUDED.latency_p50_ms,
           latency_p75_ms     = EXCLUDED.latency_p75_ms,
           latency_p90_ms     = EXCLUDED.latency_p90_ms,
           latency_p95_ms     = EXCLUDED.latency_p95_ms,
           latency_p99_ms     = EXCLUDED.latency_p99_ms,
           latency_hist       = EXCLUDED.latency_hist,
           unique_users_exact = EXCLUDED.unique_users_exact,
           sample_count       = EXCLUDED.sample_count,
           updated_at         = NOW()`;
    return { table: DEVICE_TABLE, sql, params: orgParams };
}
export function createGeoWorker(watermarks) {
    const spec = defineSimpleRollupWorker({
        id: 'analytics.geo',
        tier: 'standard',
        window: '1h',
        source: SOURCE,
        table: GEO_TABLE,
        shape: 'B',
        columns: GEO_COLUMNS,
        entityKeyExpr: GEO_ENTITY,
        entityLabelExpr: "COALESCE(e.geo_country_code, 'ZZ')",
        concurrency: 2,
        lateGraceSeconds: 3_600,
        maxSpanMinutes: 240,
        description: 'Requests, errors, latency percentiles and distinct users per country/region, plus browser / OS / device breakdowns.',
        aggregates: () => [
            "MIN(COALESCE(e.geo_country_code, 'ZZ'))",
            'MIN(e.geo_region)',
            AGG.count(),
            AGG.filterCount('e.status_code >= 500'),
            'COUNT(DISTINCT e.geo_asn)::int',
            AGG.sum('e.latency_ms'),
            AGG.max('e.latency_ms'),
            AGG.percentile('e.latency_ms', 0.5),
            AGG.percentile('e.latency_ms', 0.75),
            AGG.percentile('e.latency_ms', 0.9),
            AGG.percentile('e.latency_ms', 0.95),
            AGG.percentile('e.latency_ms', 0.99),
            histogramSql('e.latency_ms'),
            AGG.distinct('e.user_id'),
            AGG.count(),
        ],
        extraStatements: (slice) => [deviceStatement([slice.orgId, slice.ingestStart, slice.ingestEnd, slice.recomputeFrom])],
        afterWrite: async (client, slice, ctx) => {
            await applySketchPass(client, {
                source: SOURCE,
                subjectColumn: 'user_id',
                targetTable: GEO_TABLE,
                targetColumn: 'unique_users_hll',
                window: '1h',
                shape: 'B',
                entityKeyExpr: GEO_ENTITY,
                maxRows: ctx.config.batchMaxRows,
            }, {
                orgId: slice.orgId,
                ingestStart: slice.ingestStart,
                ingestEnd: slice.ingestEnd,
                recomputeFrom: slice.recomputeFrom,
            });
        },
    }, watermarks);
    // The factory only knows about the primary table; declare the device table so
    // registry ownership checks see the full write set.
    return { ...spec, outputTables: [GEO_TABLE, DEVICE_TABLE] };
}
//# sourceMappingURL=geo.worker.js.map