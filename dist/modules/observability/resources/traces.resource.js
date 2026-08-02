import { commonFields, commonSearchAliases, makeMapRow } from './common.js';
const traceFields = {
    ...commonFields,
    rootSpanName: { column: 'root_span_name', type: 'string', filterable: true, searchable: true, projectable: true, label: 'Operation' },
    rootSpanId: { column: 'root_span_id', type: 'string', filterable: true, projectable: true, label: 'Root Span' },
    spanCount: { column: 'span_count', type: 'number', filterable: true, sortable: true, projectable: true, label: 'Spans' },
    totalDurationMs: { column: 'total_duration_ms', type: 'number', filterable: true, sortable: true, projectable: true, label: 'Duration (ms)' },
    isPartial: { column: 'is_partial', type: 'boolean', filterable: true, projectable: true, label: 'Partial' },
    requestId: { column: 'request_id', type: 'string', filterable: true, projectable: true, label: 'Request ID' },
    tenantId: { column: 'tenant_id', type: 'string', filterable: true, projectable: true, label: 'Tenant' },
};
export const tracesResource = {
    name: 'traces',
    table: 'events_traces',
    timeColumn: 'timestamp',
    idColumn: 'id',
    fields: traceFields,
    searchFields: ['rootSpanName', 'service', 'traceId'],
    searchAliases: {
        ...commonSearchAliases,
        operation: 'rootSpanName',
        root: 'rootSpanName',
        duration: 'totalDurationMs',
        spans: 'spanCount',
    },
    defaultSort: { field: 'timestamp', direction: 'desc' },
    defaultProjection: [
        'id', 'projectId', 'environment', 'timestamp', 'traceId', 'rootSpanName', 'spanCount',
        'totalDurationMs', 'service', 'isPartial', 'requestId',
    ],
    preferredIndexes: ['idx_events_traces_tenant_env_time', 'idx_events_traces_trace'],
    errorPredicate: "severity IN ('error','critical','fatal')",
    summary: {
        total: 'COUNT(*)::bigint',
        avgSpans: 'AVG(span_count)',
        partial: '(COUNT(*) FILTER (WHERE is_partial))::bigint',
        uniqueOperations: 'COUNT(DISTINCT root_span_name)::bigint',
    },
    statistics: {
        avgDuration: 'AVG(total_duration_ms)',
        maxDuration: 'MAX(total_duration_ms)',
        p50: 'percentile_cont(0.5) WITHIN GROUP (ORDER BY total_duration_ms)',
        p95: 'percentile_cont(0.95) WITHIN GROUP (ORDER BY total_duration_ms)',
        p99: 'percentile_cont(0.99) WITHIN GROUP (ORDER BY total_duration_ms)',
    },
    mapRow: makeMapRow(['totalDurationMs', 'spanCount', 'durationMs', 'statusCode']),
};
//# sourceMappingURL=traces.resource.js.map