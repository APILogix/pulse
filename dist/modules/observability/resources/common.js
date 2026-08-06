export const SEVERITY_VALUES = ['debug', 'info', 'warning', 'error', 'critical', 'fatal'];
/** Field definitions present on every telemetry resource. */
export const commonFields = {
    id: { column: 'id', type: 'uuid', filterable: true, sortable: false, projectable: true, label: 'ID' },
    eventId: { column: 'event_id', type: 'string', filterable: true, projectable: true, label: 'Event ID' },
    projectId: { column: 'project_id', type: 'uuid', filterable: true, projectable: true, label: 'Project' },
    environment: { column: 'environment', type: 'string', filterable: true, projectable: true, label: 'Environment' },
    traceId: { column: 'trace_id', type: 'string', filterable: true, searchable: true, projectable: true, label: 'Trace ID' },
    spanId: { column: 'span_id', type: 'string', filterable: true, projectable: true, label: 'Span ID' },
    parentSpanId: { column: 'parent_span_id', type: 'string', filterable: true, projectable: true, label: 'Parent Span ID' },
    sessionId: { column: 'session_id', type: 'string', filterable: true, projectable: true, label: 'Session ID' },
    userId: { column: 'user_id', type: 'string', filterable: true, searchable: true, projectable: true, label: 'User' },
    service: { column: 'service', type: 'string', filterable: true, searchable: true, projectable: true, label: 'Service' },
    endpoint: { column: 'endpoint', type: 'string', filterable: true, searchable: true, projectable: true, label: 'Endpoint' },
    release: { column: 'release', type: 'string', filterable: true, projectable: true, label: 'Release' },
    sdkName: { column: 'sdk_name', type: 'string', filterable: true, projectable: true, label: 'SDK Name' },
    sdkVersion: { column: 'sdk_version', type: 'string', filterable: true, projectable: true, label: 'SDK Version' },
    severity: { column: 'severity', type: 'enum', enumValues: SEVERITY_VALUES, filterable: true, projectable: true, label: 'Severity' },
    message: { column: 'message', type: 'string', filterable: true, searchable: true, projectable: true, label: 'Message' },
    name: { column: 'name', type: 'string', filterable: true, searchable: true, projectable: true, label: 'Name' },
    durationMs: { column: 'duration_ms', type: 'number', filterable: true, sortable: true, projectable: true, label: 'Duration (ms)' },
    occurredAt: { column: 'occurred_at', type: 'timestamp', filterable: true, sortable: true, projectable: true, label: 'Occurred At' },
    timestamp: { column: 'occurred_at', type: 'timestamp', filterable: true, sortable: true, projectable: true, label: 'Occurred At' },
    ingestedAt: { column: 'ingested_at', type: 'timestamp', filterable: true, projectable: true, label: 'Ingested At' },
};
/** Search key aliases common to every resource. */
export const commonSearchAliases = {
    trace: 'traceId',
    span: 'spanId',
    session: 'sessionId',
    user: 'userId',
    svc: 'service',
    env: 'environment',
    msg: 'message',
};
/**
 * Build a resource `mapRow` that normalizes pg output: drops the internal
 * cursor columns, coerces the given numeric columns from pg's string form, and
 * leaves JSONB (already parsed by pg) and everything else intact. Works with
 * dynamic field projection because it only touches keys that are present.
 */
export function makeMapRow(numericFields) {
    const numeric = new Set(numericFields);
    return (row) => {
        const out = {};
        for (const [key, value] of Object.entries(row)) {
            if (key === '__id' || key === '__t')
                continue;
            if (numeric.has(key) && value !== null && value !== undefined) {
                const n = typeof value === 'number' ? value : Number(value);
                out[key] = Number.isFinite(n) ? n : value;
                continue;
            }
            out[key] = value;
        }
        return out;
    };
}
//# sourceMappingURL=common.js.map