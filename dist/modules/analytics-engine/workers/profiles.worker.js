/**
 * analytics.profiles and analytics.replays.
 *
 * Spec: docs/analytics/06-worker-architecture.md §3.11 and §3.12
 * Metrics: docs/analytics/10-analytics-catalog.md §11
 *
 * profiles → profile_metrics_1h, profile_function_metrics_1h
 * replays  → replay_metrics_1h
 *
 * Hot-function extraction unnests `profile_data->'nodes'` in SQL so the browser
 * no longer sorts profile nodes to find the hottest frame.
 */
import { AGG, defineSimpleRollupWorker } from './base.js';
import { histogramSql } from '../histogram.js';
// ── Profiles ───────────────────────────────────────────────────────────────
const PROFILE_SOURCE = 'events_profiles';
const PROFILE_TABLE = 'profile_metrics_1h';
const FUNCTION_TABLE = 'profile_function_metrics_1h';
const PROFILE_ENTITY = "COALESCE(e.service, 'unknown') || ':' || COALESCE(e.profile_type, 'cpu')";
const PROFILE_COLUMNS = [
    'organization_id',
    'project_id',
    'environment',
    'bucket',
    'entity_key',
    'entity_label',
    'service',
    'profile_type',
    'profile_count',
    'sample_count_sum',
    'node_count_sum',
    'duration_sum_ms',
    'duration_max_ms',
    'duration_p50_ms',
    'duration_p75_ms',
    'duration_p90_ms',
    'duration_p95_ms',
    'duration_p99_ms',
    'duration_hist',
    'sample_count',
];
/** Top hot functions per bucket, extracted from the CPU profile node tree. */
function hotFunctionStatement(params, topK) {
    const sql = `
    INSERT INTO ${FUNCTION_TABLE} (
      organization_id, project_id, environment, bucket, entity_key, entity_label,
      service, function_name, script_url, line_number,
      hit_count_sum, profile_count, self_share_pct, sample_count
    )
    WITH touched AS (
      SELECT DISTINCT date_trunc('hour', e.timestamp) AS bucket
        FROM ${PROFILE_SOURCE} e
       WHERE e.organization_id = $1
         AND e.project_id IS NOT NULL
         AND e.ingested_at >= $2 AND e.ingested_at < $3
         AND e.timestamp   >= $4
    ),
    bounds AS (SELECT MIN(bucket) AS lo, MAX(bucket) AS hi FROM touched),
    nodes AS (
      SELECT e.organization_id,
             e.project_id,
             e.environment,
             date_trunc('hour', e.timestamp)                     AS bucket,
             COALESCE(e.service, 'unknown')                      AS service,
             COALESCE(node->'callFrame'->>'functionName', '(anonymous)') AS function_name,
             COALESCE(node->'callFrame'->>'url', '')             AS script_url,
             NULLIF(node->'callFrame'->>'lineNumber', '')::int   AS line_number,
             COALESCE((node->>'hitCount')::bigint, 0)            AS hit_count,
             e.id                                                AS profile_id
        FROM ${PROFILE_SOURCE} e
        JOIN touched t ON date_trunc('hour', e.timestamp) = t.bucket
        CROSS JOIN LATERAL jsonb_array_elements(
          CASE WHEN jsonb_typeof(e.profile_data->'nodes') = 'array'
               THEN e.profile_data->'nodes' ELSE '[]'::jsonb END
        ) AS node
       WHERE e.organization_id = $1
         AND e.project_id IS NOT NULL
         AND e.timestamp >= (SELECT lo FROM bounds)
         AND e.timestamp <  (SELECT hi FROM bounds) + INTERVAL '1 hour'
    ),
    grouped AS (
      SELECT organization_id, project_id, environment, bucket, service,
             function_name, script_url, MIN(line_number) AS line_number,
             SUM(hit_count)::bigint          AS hit_count_sum,
             COUNT(DISTINCT profile_id)::bigint AS profile_count,
             SUM(SUM(hit_count)) OVER (
               PARTITION BY organization_id, project_id, environment, bucket
             )                                AS bucket_hits
        FROM nodes
       GROUP BY organization_id, project_id, environment, bucket, service, function_name, script_url
    ),
    topk AS (
      SELECT *,
             ROW_NUMBER() OVER (
               PARTITION BY organization_id, project_id, environment, bucket
               ORDER BY hit_count_sum DESC
             ) AS rank
        FROM grouped
    )
    SELECT organization_id,
           project_id,
           environment,
           bucket,
           md5(service || ':' || function_name || ':' || script_url) AS entity_key,
           function_name                                             AS entity_label,
           service,
           function_name,
           NULLIF(script_url, ''),
           line_number,
           hit_count_sum,
           profile_count,
           ROUND(hit_count_sum * 100.0 / NULLIF(bucket_hits, 0), 3),
           hit_count_sum
      FROM topk
     WHERE rank <= ${topK}
    ON CONFLICT (organization_id, project_id, environment, bucket, entity_key) DO UPDATE
       SET entity_label   = EXCLUDED.entity_label,
           service        = EXCLUDED.service,
           function_name  = EXCLUDED.function_name,
           script_url     = EXCLUDED.script_url,
           line_number    = EXCLUDED.line_number,
           hit_count_sum  = EXCLUDED.hit_count_sum,
           profile_count  = EXCLUDED.profile_count,
           self_share_pct = EXCLUDED.self_share_pct,
           sample_count   = EXCLUDED.sample_count,
           updated_at     = NOW()`;
    return { table: FUNCTION_TABLE, sql, params };
}
export function createProfilesWorker(watermarks) {
    const spec = defineSimpleRollupWorker({
        id: 'analytics.profiles',
        tier: 'slow',
        window: '1h',
        source: PROFILE_SOURCE,
        table: PROFILE_TABLE,
        shape: 'B',
        columns: PROFILE_COLUMNS,
        entityKeyExpr: PROFILE_ENTITY,
        entityLabelExpr: PROFILE_ENTITY,
        // JSONB-heavy: keep concurrency at 1 so profile parsing cannot crowd out
        // the latency-critical workers on the same Log DB.
        concurrency: 1,
        lateGraceSeconds: 3_600,
        maxSpanMinutes: 240,
        description: 'Profile capture counts, duration distribution, sample/node volume and the top hot functions per service.',
        aggregates: () => [
            "MIN(COALESCE(e.service, 'unknown'))",
            "MIN(COALESCE(e.profile_type, 'cpu'))",
            AGG.count(),
            `COALESCE(SUM(CASE WHEN jsonb_typeof(e.profile_data->'samples') = 'array'
                           THEN jsonb_array_length(e.profile_data->'samples') ELSE 0 END), 0)`,
            `COALESCE(SUM(CASE WHEN jsonb_typeof(e.profile_data->'nodes') = 'array'
                           THEN jsonb_array_length(e.profile_data->'nodes') ELSE 0 END), 0)`,
            AGG.sum('e.duration_ms'),
            AGG.max('e.duration_ms'),
            AGG.percentile('e.duration_ms', 0.5),
            AGG.percentile('e.duration_ms', 0.75),
            AGG.percentile('e.duration_ms', 0.9),
            AGG.percentile('e.duration_ms', 0.95),
            AGG.percentile('e.duration_ms', 0.99),
            histogramSql('e.duration_ms'),
            AGG.count(),
        ],
        extraStatements: (slice, config) => [
            hotFunctionStatement([slice.orgId, slice.ingestStart, slice.ingestEnd, slice.recomputeFrom], Math.min(config.entityTopK, 200)),
        ],
    }, watermarks);
    return { ...spec, outputTables: [PROFILE_TABLE, FUNCTION_TABLE] };
}
// ── Replays ────────────────────────────────────────────────────────────────
const REPLAY_SOURCE = 'events_replays';
const REPLAY_TABLE = 'replay_metrics_1h';
const REPLAY_COLUMNS = [
    'organization_id',
    'project_id',
    'environment',
    'bucket',
    'segment_count',
    'session_count',
    'dom_event_count',
    'crashed_session_count',
    'sample_count',
];
export function createReplaysWorker(watermarks) {
    return defineSimpleRollupWorker({
        id: 'analytics.replays',
        tier: 'slow',
        window: '1h',
        source: REPLAY_SOURCE,
        table: REPLAY_TABLE,
        shape: 'A',
        columns: REPLAY_COLUMNS,
        concurrency: 1,
        lateGraceSeconds: 3_600,
        maxSpanMinutes: 240,
        description: 'Replay segment and session counts with captured DOM event volume; crashed sessions are attributed by analytics.sessions.',
        aggregates: () => [
            AGG.count(),
            AGG.distinct('e.session_id'),
            `COALESCE(SUM(CASE WHEN jsonb_typeof(e.events) = 'array'
                           THEN jsonb_array_length(e.events) ELSE 0 END), 0)`,
            // Crash attribution needs error correlation; owned by analytics.sessions.
            '0::bigint',
            AGG.count(),
        ],
    }, watermarks);
}
//# sourceMappingURL=profiles.worker.js.map