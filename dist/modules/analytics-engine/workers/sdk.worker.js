/**
 * analytics.sdk — SDK name/version adoption across every signal.
 *
 * Spec: docs/analytics/06-worker-architecture.md §3.15
 * Metrics: docs/analytics/10-analytics-catalog.md §12
 *
 * Reads  : events_requests (representative signal; every typed table carries
 *          sdk_name/sdk_version, and requests are the highest-coverage source)
 * Writes : sdk_metrics_1h
 */
import { AGG, defineSimpleRollupWorker } from './base.js';
const SOURCE = 'events_requests';
const TABLE = 'sdk_metrics_1h';
const ENTITY = "COALESCE(e.sdk_name, 'unknown') || ':' || COALESCE(e.sdk_version, '0')";
const COLUMNS = [
    'organization_id',
    'project_id',
    'environment',
    'bucket',
    'entity_key',
    'entity_label',
    'sdk_name',
    'sdk_version',
    'event_count',
    'request_count',
    'error_count',
    'project_count',
    'first_seen_at',
    'last_seen_at',
    'sample_count',
];
export function createSdkWorker(watermarks) {
    return defineSimpleRollupWorker({
        id: 'analytics.sdk',
        tier: 'slow',
        window: '1h',
        source: SOURCE,
        table: TABLE,
        shape: 'B',
        columns: COLUMNS,
        entityKeyExpr: ENTITY,
        entityLabelExpr: ENTITY,
        concurrency: 1,
        lateGraceSeconds: 3_600,
        maxSpanMinutes: 240,
        description: 'SDK name/version adoption: event and request volume, error volume, project reach and first/last seen timestamps.',
        aggregates: () => [
            "MIN(COALESCE(e.sdk_name, 'unknown'))",
            "MIN(COALESCE(e.sdk_version, '0'))",
            AGG.count(),
            AGG.count(),
            AGG.filterCount('e.status_code >= 500'),
            'COUNT(DISTINCT e.project_id)::int',
            'MIN(e.occurred_at)',
            'MAX(e.occurred_at)',
            AGG.count(),
        ],
    }, watermarks);
}
//# sourceMappingURL=sdk.worker.js.map