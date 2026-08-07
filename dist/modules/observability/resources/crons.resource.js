import { commonFields, commonSearchAliases, makeMapRow } from './common.js';
const CRON_STATUS = ['ok', 'in_progress', 'error', 'failed', 'timeout', 'missed'];
const CHECKIN_TYPES = ['heartbeat', 'scheduled', 'manual', 'retry', 'unknown'];
const cronFields = {
    ...commonFields,
    // ── Monitor identity ─────────────────────────────────────────────────────────
    monitorSlug: { column: 'monitor_slug', type: 'string', filterable: true, searchable: true, projectable: true, label: 'Monitor' },
    monitorName: { column: 'monitor_name', type: 'string', filterable: true, searchable: true, projectable: true, label: 'Monitor Name' },
    // ── Status & derived ─────────────────────────────────────────────────────────
    status: { column: 'status', type: 'enum', enumValues: CRON_STATUS, filterable: true, projectable: true, label: 'Status' },
    isSuccess: { column: 'is_success', type: 'boolean', filterable: true, projectable: true, label: 'Success' },
    // ── Duration & execution timeline ─────────────────────────────────────────────
    durationMs: { column: 'duration_ms', type: 'number', filterable: true, sortable: true, projectable: true, label: 'Duration (ms)' },
    startedAt: { column: 'started_at', type: 'string', filterable: false, projectable: true, label: 'Started At' },
    finishedAt: { column: 'finished_at', type: 'string', filterable: false, projectable: true, label: 'Finished At' },
    // ── Classification ────────────────────────────────────────────────────────────
    checkinType: { column: 'checkin_type', type: 'enum', enumValues: CHECKIN_TYPES, filterable: true, projectable: true, label: 'Check-in Type' },
    scheduleType: { column: 'schedule_type', type: 'string', filterable: true, projectable: true, label: 'Schedule Type' },
    // ── Correlation IDs ──────────────────────────────────────────────────────────
    requestId: { column: 'request_id', type: 'string', filterable: true, projectable: true, label: 'Request ID' },
    sessionId: { column: 'session_id', type: 'string', filterable: true, projectable: true, label: 'Session ID' },
    traceId: { column: 'trace_id', type: 'string', filterable: true, projectable: true, label: 'Trace ID' },
    spanId: { column: 'span_id', type: 'string', filterable: true, projectable: true, label: 'Span ID' },
    tenantId: { column: 'tenant_id', type: 'string', filterable: true, projectable: true, label: 'Tenant ID' },
};
export const cronsResource = {
    name: 'crons',
    table: 'events_cron_checkins',
    timeColumn: 'occurred_at',
    idColumn: 'id',
    fields: cronFields,
    searchFields: ['monitorSlug', 'monitorName', 'service'],
    searchAliases: {
        ...commonSearchAliases,
        monitor: 'monitorSlug',
        job: 'monitorSlug',
        slug: 'monitorSlug',
        name: 'monitorName',
        status: 'status',
        type: 'checkinType',
    },
    defaultSort: { field: 'occurredAt', direction: 'desc' },
    defaultProjection: [
        'id', 'environment', 'occurredAt',
        'monitorSlug', 'monitorName', 'status', 'isSuccess',
        'durationMs', 'checkinType', 'service',
        'requestId', 'traceId',
    ],
    preferredIndexes: [
        'idx_events_cron_checkins_monitor_time',
        'idx_events_cron_checkins_tenant_env_time',
    ],
    errorPredicate: "status IN ('error','failed','timeout','missed')",
    summary: {
        total: 'COUNT(*)::bigint',
        ok: "(COUNT(*) FILTER (WHERE status = 'ok'))::bigint",
        failed: "(COUNT(*) FILTER (WHERE status IN ('error','failed','timeout','missed')))::bigint",
        inProgress: "(COUNT(*) FILTER (WHERE status = 'in_progress'))::bigint",
        uniqueMonitors: 'COUNT(DISTINCT monitor_slug)::bigint',
        successRate: 'ROUND(AVG(CASE WHEN is_success THEN 1.0 ELSE 0.0 END) * 100, 2)',
    },
    statistics: {
        avgRuntime: 'AVG(duration_ms)',
        maxRuntime: 'MAX(duration_ms)',
        minRuntime: 'MIN(duration_ms)',
        p95Runtime: 'PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms)',
    },
    mapRow: makeMapRow(['durationMs', 'statusCode']),
};
//# sourceMappingURL=crons.resource.js.map