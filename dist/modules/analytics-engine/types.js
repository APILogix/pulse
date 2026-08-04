/**
 * Analytics engine shared types.
 *
 * Contracts implemented here:
 *   docs/analytics/00-architecture-overview.md  (processing model, windows)
 *   docs/analytics/06-worker-architecture.md    (worker registry contract)
 *   docs/analytics/07-rollup-tables.md          (rollup shapes, sentinels)
 *   docs/analytics/08-dashboard-api-contracts.md (API primitives)
 */
// ── Windows ────────────────────────────────────────────────────────────────
export const WINDOW_SIZES = ['1m', '5m', '1h', '1d'];
export const WINDOW_SECONDS = {
    '1m': 60,
    '5m': 300,
    '1h': 3_600,
    '1d': 86_400,
};
/** Postgres `date_trunc` unit + multiple used to align a bucket. */
export const WINDOW_TRUNC = {
    '1m': { unit: 'minute', multiple: 1 },
    '5m': { unit: 'minute', multiple: 5 },
    '1h': { unit: 'hour', multiple: 1 },
    '1d': { unit: 'day', multiple: 1 },
};
/** Retention per tier (docs/analytics/00-architecture-overview.md §5). */
export const WINDOW_RETENTION_SECONDS = {
    '1m': 6 * 3_600,
    '5m': 48 * 3_600,
    '1h': 45 * 86_400,
    '1d': 400 * 86_400,
};
/** Suggested client refetch interval per tier. */
export const WINDOW_REFRESH_MS = {
    '1m': 5_000,
    '5m': 30_000,
    '1h': 60_000,
    '1d': 300_000,
};
/** Compaction chain: each window is built from the finer one. */
export const WINDOW_SOURCE = {
    '5m': '1m',
    '1h': '5m',
    '1d': '1h',
};
// ── Sentinels ──────────────────────────────────────────────────────────────
/** Rollup rows that aggregate every project of an organization. */
export const ALL_PROJECTS_SENTINEL = '00000000-0000-0000-0000-000000000000';
/** Rollup rows that aggregate every environment. Cannot be produced by ingestion. */
export const ALL_ENVIRONMENTS_SENTINEL = '__all__';
/** Overflow bucket for Shape B rollups beyond ANALYTICS_ENTITY_TOPK. */
export const OTHER_ENTITY_SENTINEL = '__other__';
// ── Signals ────────────────────────────────────────────────────────────────
export const TELEMETRY_SIGNALS = [
    'requests',
    'errors',
    'logs',
    'metrics',
    'spans',
    'traces',
    'messages',
    'profiles',
    'replays',
    'cron_checkins',
];
/** Canonical Log DB table for each signal. */
export const SIGNAL_TABLE = {
    requests: 'events_requests',
    errors: 'events_errors',
    logs: 'events_logs',
    metrics: 'events_metrics',
    spans: 'events_spans',
    traces: 'events_traces',
    messages: 'events_messages',
    profiles: 'events_profiles',
    replays: 'events_replays',
    cron_checkins: 'events_cron_checkins',
};
// ── Worker identity ────────────────────────────────────────────────────────
export const ANALYTICS_WORKER_IDS = [
    'analytics.requests',
    'analytics.endpoints',
    'analytics.services',
    'analytics.errors',
    'analytics.logs',
    'analytics.metrics',
    'analytics.runtime',
    'analytics.spans',
    'analytics.traces',
    'analytics.crons',
    'analytics.profiles',
    'analytics.replays',
    'analytics.sessions',
    'analytics.geo',
    'analytics.sdk',
    'analytics.releases',
    'analytics.slo',
    'analytics.security',
    'analytics.usage',
    'analytics.alerts',
    'analytics.ai',
    'analytics.anomalies',
    'analytics.health',
    'analytics.compaction',
    'analytics.retention',
    'analytics.partitions',
    'analytics.dispatch',
];
export const TIER_INTERVAL_MS = {
    live: 30_000,
    standard: 120_000,
    slow: 600_000,
    platform: 300_000,
};
/** Key columns per shape (docs/analytics/07-rollup-tables.md §1). */
export const SHAPE_A_KEYS = ['organization_id', 'project_id', 'environment', 'bucket'];
export const SHAPE_B_KEYS = [...SHAPE_A_KEYS, 'entity_key'];
export function isWindowSize(value) {
    return typeof value === 'string' && WINDOW_SIZES.includes(value);
}
//# sourceMappingURL=types.js.map