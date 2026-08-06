import { commonFields, commonSearchAliases, makeMapRow } from './common.js';
const metricFields = {
    ...commonFields,
    // ── Metric identity ──────────────────────────────────────────────────────────
    metricName: { column: 'metric_name', type: 'string', filterable: true, searchable: true, projectable: true, label: 'Metric' },
    metricType: { column: 'metric_type', type: 'string', filterable: true, projectable: true, label: 'Type' },
    metricUnit: { column: 'metric_unit', type: 'string', filterable: true, projectable: true, label: 'Unit' },
    metricNamespace: { column: 'metric_namespace', type: 'string', filterable: true, projectable: true, label: 'Namespace' },
    metricDescription: { column: 'metric_description', type: 'string', filterable: false, projectable: true, label: 'Description' },
    // ── Classification ───────────────────────────────────────────────────────────
    metricCategory: { column: 'metric_category', type: 'string', filterable: true, projectable: true, label: 'Category' },
    aggregationType: { column: 'aggregation_type', type: 'string', filterable: true, projectable: true, label: 'Aggregation' },
    temporality: { column: 'temporality', type: 'string', filterable: true, projectable: true, label: 'Temporality' },
    isMonotonic: { column: 'is_monotonic', type: 'boolean', filterable: true, projectable: true, label: 'Monotonic' },
    // ── Numeric aggregates ───────────────────────────────────────────────────────
    value: { column: 'value', type: 'number', filterable: true, sortable: true, projectable: true, label: 'Value' },
    count: { column: 'count', type: 'number', filterable: true, projectable: true, label: 'Count' },
    sum: { column: 'sum', type: 'number', filterable: true, projectable: true, label: 'Sum' },
    min: { column: 'min', type: 'number', filterable: true, projectable: true, label: 'Min' },
    max: { column: 'max', type: 'number', filterable: true, projectable: true, label: 'Max' },
    avg: { column: 'avg', type: 'number', filterable: true, projectable: true, label: 'Avg' },
    rate: { column: 'rate', type: 'number', filterable: true, projectable: true, label: 'Rate' },
    p50: { column: 'p50', type: 'number', filterable: true, projectable: true, label: 'p50' },
    p75: { column: 'p75', type: 'number', filterable: true, projectable: true, label: 'p75' },
    p90: { column: 'p90', type: 'number', filterable: true, projectable: true, label: 'p90' },
    p95: { column: 'p95', type: 'number', filterable: true, projectable: true, label: 'p95' },
    p99: { column: 'p99', type: 'number', filterable: true, projectable: true, label: 'p99' },
    // ── HTTP context (promoted from tags) ────────────────────────────────────────
    endpoint: { column: 'endpoint', type: 'string', filterable: true, searchable: true, projectable: true, label: 'Endpoint' },
    httpMethod: { column: 'http_method', type: 'string', filterable: true, projectable: true, label: 'Method' },
    statusCode: { column: 'status_code', type: 'number', filterable: true, projectable: true, label: 'Status' },
    // ── Correlation IDs ──────────────────────────────────────────────────────────
    requestId: { column: 'request_id', type: 'string', filterable: true, projectable: true, label: 'Request ID' },
    sessionId: { column: 'session_id', type: 'string', filterable: true, projectable: true, label: 'Session ID' },
    traceId: { column: 'trace_id', type: 'string', filterable: true, projectable: true, label: 'Trace ID' },
    spanId: { column: 'span_id', type: 'string', filterable: true, projectable: true, label: 'Span ID' },
    tenantId: { column: 'tenant_id', type: 'string', filterable: true, projectable: true, label: 'Tenant ID' },
};
export const metricsResource = {
    name: 'metrics',
    table: 'events_metrics',
    timeColumn: 'occurredAt',
    idColumn: 'id',
    fields: metricFields,
    searchFields: ['metricName', 'service', 'endpoint'],
    searchAliases: {
        ...commonSearchAliases,
        metric: 'metricName',
        type: 'metricType',
        unit: 'metricUnit',
        category: 'metricCategory',
        endpoint: 'endpoint',
        method: 'httpMethod',
        namespace: 'metricNamespace',
    },
    defaultSort: { field: 'occurredAt', direction: 'desc' },
    defaultProjection: [
        'id', 'projectId', 'environment', 'occurredAt', 'metricName', 'metricType', 'value', 'metricUnit',
        'metricCategory', 'aggregationType', 'endpoint', 'httpMethod', 'statusCode',
        'service', 'requestId', 'traceId', 'p95', 'p99',
    ],
    preferredIndexes: ['idx_events_metrics_tenant_env_time', 'idx_events_metrics_name_time'],
    errorPredicate: "severity IN ('error','critical','fatal')",
    summary: {
        total: 'COUNT(*)::bigint',
        uniqueMetrics: 'COUNT(DISTINCT metric_name)::bigint',
    },
    statistics: {
        avgValue: 'AVG(value)',
        maxValue: 'MAX(value)',
        minValue: 'MIN(value)',
        sumValue: 'SUM(value)',
    },
    mapRow: makeMapRow([
        'value', 'count', 'sum', 'min', 'max', 'avg', 'rate',
        'p50', 'p75', 'p90', 'p95', 'p99', 'statusCode',
    ]),
};
//# sourceMappingURL=metrics.resource.js.map