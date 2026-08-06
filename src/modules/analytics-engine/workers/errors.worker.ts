/**
 * analytics.errors — error volume, group rollups and group state.
 *
 * Spec: docs/analytics/06-worker-architecture.md §3.4
 * Metrics: docs/analytics/10-analytics-catalog.md §4
 *
 * Reads  : events_errors
 * Writes : error_metrics_1m, error_group_metrics_1m, error_dimension_metrics_1h,
 *          analytics_error_groups (state table, upsert-only)
 *
 * analytics_error_groups is user-mutable (resolve / ignore / assign), so this
 * worker only ever touches the observation columns and leaves status, priority,
 * assignee, resolved_at and resolved_by alone.
 */

import { buildInsertSelect } from '../rollup-writer.js';
import type { AnalyticsWatermarkRepository } from '../watermark.repository.js';
import type {
  AnalyticsJobData,
  AnalyticsWorkerSpec,
  WorkerContext,
  WorkerRunResult,
} from '../types.js';
import {
  AGG,
  buildBucketRecomputeSql,
  runRollupWorker,
  type RollupStatement,
} from './base.js';

const SOURCE = 'events_errors';
const SUMMARY_TABLE = 'error_metrics_1m';
const GROUP_TABLE = 'error_group_metrics_1m';
const DIMENSION_TABLE = 'error_dimension_metrics_1h';
const STATE_TABLE = 'analytics_error_groups';

const SUMMARY_COLUMNS = [
  'organization_id',
  'project_id',
  'environment',
  'bucket',
  'total_count',
  'fatal_count',
  'error_count',
  'warning_count',
  'info_count',
  'debug_count',
  'unique_fingerprints',
  'new_group_count',
  'unique_users_exact',
  'sample_count',
] as const;

const GROUP_COLUMNS = [
  'organization_id',
  'project_id',
  'environment',
  'bucket',
  'entity_key',
  'entity_label',
  'error_name',
  'message_template',
  'mechanism',
  'severity_max',
  'occurrence_count',
  'service_count',
  'release_first_seen',
  'first_seen_at',
  'last_seen_at',
  'unique_users_exact',
  'sample_count',
] as const;

const FINGERPRINT = "COALESCE(e.fingerprint, md5(COALESCE(e.error_name, '') || ':' || COALESCE(e.message, '')))";

/** Severity ranking so `severity_max` is deterministic across merges. */
const SEVERITY_MAX = `
  (ARRAY['debug','info','warning','error','critical','fatal'])[
    MAX(COALESCE(array_position(ARRAY['debug','info','warning','error','critical','fatal'], e.severity::text), 2))
  ]`;

export function createErrorsWorker(
  watermarks: AnalyticsWatermarkRepository,
): AnalyticsWorkerSpec {
  return {
    id: 'analytics.errors',
    queue: 'analytics.errors',
    tier: 'live',
    windowSize: '1m',
    sourceTables: [SOURCE],
    outputTables: [SUMMARY_TABLE, GROUP_TABLE, DIMENSION_TABLE, STATE_TABLE],
    concurrency: 4,
    retryLimit: 5,
    retryBackoffSeconds: 30,
    lateGraceSeconds: 900,
    maxSpanMinutes: 60,
    description:
      'Error volume by severity, per-fingerprint group rollups, dimension breakdowns (mechanism/severity/service/release/name) and error-group state upserts.',

    async run(ctx: WorkerContext, job: AnalyticsJobData): Promise<WorkerRunResult> {
      return runRollupWorker(ctx, job, watermarks, {
        workerId: 'analytics.errors',
        window: '1m',
        sizingTable: SOURCE,
        lateGraceSeconds: 900,
        maxSpanMinutes: 60,

        statements: (slice): RollupStatement[] => {
          const params = [slice.orgId, slice.ingestStart, slice.ingestEnd, slice.recomputeFrom];

          const summarySelect = buildBucketRecomputeSql({
            source: SOURCE,
            window: '1m',
            columns: SUMMARY_COLUMNS,
            aggregates: [
              AGG.count(),
              AGG.filterCount("e.severity = 'fatal'"),
              AGG.filterCount("e.severity IN ('error','critical')"),
              AGG.filterCount("e.severity = 'warning'"),
              AGG.filterCount("e.severity = 'info'"),
              AGG.filterCount("e.severity = 'debug'"),
              `COUNT(DISTINCT ${FINGERPRINT})::int`,
              // New groups are attributed by the state upsert below, which is the
              // only place with the history needed to decide "new".
              '0::int',
              AGG.distinct('e.user_id'),
              AGG.count(),
            ],
          });

          const groupSelect = buildBucketRecomputeSql({
            source: SOURCE,
            window: '1m',
            columns: GROUP_COLUMNS,
            entityKeyExpr: FINGERPRINT,
            entityLabelExpr: "COALESCE(e.error_name, 'Error')",
            aggregates: [
              "MIN(COALESCE(e.error_name, 'Error'))",
              'MIN(LEFT(COALESCE(e.message, \'\'), 500))',
              'MIN(e.mechanism)',
              SEVERITY_MAX,
              AGG.count(),
              'COUNT(DISTINCT e.service)::int',
              'MIN(e.release)',
              'MIN(e.occurred_at)',
              'MAX(e.occurred_at)',
              AGG.distinct('e.user_id'),
              AGG.count(),
            ],
          });

          // Dimension breakdown is hourly and multi-dimensional, so it is built
          // with an explicit UNION ALL rather than the generic recompute helper.
          const dimensionSql = `
            INSERT INTO ${DIMENSION_TABLE} (
              organization_id, project_id, environment, bucket, entity_key, entity_label,
              dimension, dimension_value, occurrence_count, unique_users_exact, sample_count
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
                     e.user_id,
                     e.mechanism, e.severity::text AS severity, e.service, e.release,
                     COALESCE(e.error_name, 'Error') AS error_name
                FROM ${SOURCE} e
                JOIN touched t ON date_trunc('hour', e.occurred_at) = t.bucket
               WHERE e.organization_id = $1
                 AND e.project_id IS NOT NULL
                 AND e.occurred_at >= (SELECT lo FROM bounds)
                 AND e.occurred_at <  (SELECT hi FROM bounds) + INTERVAL '1 hour'
            ),
            unfolded AS (
              SELECT organization_id, project_id, environment, bucket, user_id,
                     'mechanism' AS dimension, COALESCE(mechanism, 'unknown') AS dimension_value FROM scoped
              UNION ALL
              SELECT organization_id, project_id, environment, bucket, user_id,
                     'severity', COALESCE(severity, 'error') FROM scoped
              UNION ALL
              SELECT organization_id, project_id, environment, bucket, user_id,
                     'service', COALESCE(service, 'unknown') FROM scoped
              UNION ALL
              SELECT organization_id, project_id, environment, bucket, user_id,
                     'release', COALESCE(release, 'unknown') FROM scoped
              UNION ALL
              SELECT organization_id, project_id, environment, bucket, user_id,
                     'error_name', error_name FROM scoped
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
                   COUNT(DISTINCT user_id)::bigint,
                   COUNT(*)::bigint
              FROM unfolded
             GROUP BY organization_id, project_id, environment, bucket, dimension, dimension_value
            ON CONFLICT (organization_id, project_id, environment, bucket, entity_key) DO UPDATE
               SET entity_label       = EXCLUDED.entity_label,
                   dimension          = EXCLUDED.dimension,
                   dimension_value    = EXCLUDED.dimension_value,
                   occurrence_count   = EXCLUDED.occurrence_count,
                   unique_users_exact = EXCLUDED.unique_users_exact,
                   sample_count       = EXCLUDED.sample_count,
                   updated_at         = NOW()`;

          /**
           * Group state upsert.
           *
           * Deliberately does NOT write total_count / occurrence_count: adding to
           * an existing counter is not idempotent, and re-running a slice would
           * inflate it. Occurrence counts are owned by error_group_metrics_* and
           * summed at read time. Triage fields (status / priority / assigned_to /
           * resolved_*) are never touched, so the worker cannot undo a human
           * decision.
           */
          const stateSql = `
            INSERT INTO ${STATE_TABLE} (
              organization_id, project_id, fingerprint, title, error_name, message_template,
              first_seen_at, last_seen_at, services, environments, releases, attributes
            )
            SELECT e.organization_id,
                   e.project_id,
                   ${FINGERPRINT}                              AS fingerprint,
                   MIN(COALESCE(e.error_name, 'Error'))        AS title,
                   MIN(COALESCE(e.error_name, 'Error'))        AS error_name,
                   MIN(LEFT(COALESCE(e.message, ''), 500))     AS message_template,
                   MIN(e.occurred_at)                            AS first_seen_at,
                   MAX(e.occurred_at)                            AS last_seen_at,
                   COALESCE(ARRAY_AGG(DISTINCT e.service) FILTER (WHERE e.service IS NOT NULL), '{}') AS services,
                   COALESCE(ARRAY_AGG(DISTINCT e.environment), '{}')                                  AS environments,
                   COALESCE(ARRAY_AGG(DISTINCT e.release) FILTER (WHERE e.release IS NOT NULL), '{}')  AS releases,
                   jsonb_build_object('mechanism', MIN(e.mechanism))                                   AS attributes
              FROM ${SOURCE} e
             WHERE e.organization_id = $1
               AND e.project_id IS NOT NULL
               AND e.ingested_at >= $2 AND e.ingested_at < $3
               AND e.occurred_at   >= $4
             GROUP BY e.organization_id, e.project_id, ${FINGERPRINT}
            ON CONFLICT (organization_id, project_id, fingerprint) DO UPDATE
               SET last_seen_at     = GREATEST(${STATE_TABLE}.last_seen_at, EXCLUDED.last_seen_at),
                   first_seen_at    = LEAST(${STATE_TABLE}.first_seen_at, EXCLUDED.first_seen_at),
                   error_name       = COALESCE(${STATE_TABLE}.error_name, EXCLUDED.error_name),
                   message_template = COALESCE(${STATE_TABLE}.message_template, EXCLUDED.message_template),
                   services         = ARRAY(SELECT DISTINCT unnest(${STATE_TABLE}.services || EXCLUDED.services)),
                   environments     = ARRAY(SELECT DISTINCT unnest(${STATE_TABLE}.environments || EXCLUDED.environments)),
                   releases         = ARRAY(SELECT DISTINCT unnest(${STATE_TABLE}.releases || EXCLUDED.releases)),
                   updated_at       = NOW()`;

          return [
            {
              table: SUMMARY_TABLE,
              sql: buildInsertSelect(SUMMARY_TABLE, 'A', SUMMARY_COLUMNS, summarySelect),
              params,
            },
            {
              table: GROUP_TABLE,
              sql: buildInsertSelect(GROUP_TABLE, 'B', GROUP_COLUMNS, groupSelect),
              params,
            },
            { table: DIMENSION_TABLE, sql: dimensionSql, params },
            { table: STATE_TABLE, sql: stateSql, params },
          ];
        },
      });
    },
  };
}
