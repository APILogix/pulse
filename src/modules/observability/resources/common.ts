/**
 * Common field definitions shared by every canonical `events_*` table.
 *
 * The Log DB migrations give every event table the same storage core
 * (organization_id, project_id, environment, trace/span/session/user ids,
 * service/endpoint/release, severity, timestamp, JSONB attributes/metadata/
 * payload, …). Resources spread {@link commonFields} and add signal-specific
 * fields on top, so filtering/search/projection stay consistent everywhere.
 */
import type { FieldDef } from '../query-engine/field-registry.js';

export const SEVERITY_VALUES = ['debug', 'info', 'warning', 'error', 'critical', 'fatal'] as const;

/** Field definitions present on every telemetry resource. */
export const commonFields: Record<string, FieldDef> = {
  id: { column: 'id', type: 'uuid', filterable: true, sortable: false, projectable: true, label: 'ID' },
  publicId: { column: 'public_id', type: 'string', filterable: true, searchable: true, projectable: true, label: 'Public ID' },
  eventId: { column: 'event_id', type: 'string', filterable: true, projectable: true, label: 'Event ID' },
  organizationId: { column: 'organization_id', type: 'uuid', filterable: false, projectable: false, label: 'Organization ID' },
  projectId: { column: 'project_id', type: 'uuid', filterable: false, projectable: false, label: 'Project' },
  tenantId: { column: 'tenant_id', type: 'string', filterable: false, projectable: false, label: 'Tenant ID' },
  apiKeyName: { column: 'api_key_name', type: 'string', filterable: false, projectable: false, label: 'API Key' },
  environment: { column: 'environment', type: 'string', filterable: true, projectable: true, label: 'Environment' },
  traceId: { column: 'trace_id', type: 'string', filterable: true, searchable: true, projectable: true, label: 'Trace ID' },
  tracePublicId: {
    column: 'trace_public_id',
    selectExpr: '(SELECT t.public_id FROM events_traces t WHERE t.trace_id = trace_id LIMIT 1)',
    type: 'string',
    filterable: true,
    searchable: true,
    projectable: true,
    label: 'Trace Public ID',
  },
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
  statusCode: { column: 'status_code', type: 'number', filterable: true, sortable: true, projectable: true, label: 'Status Code' },
  occurredAt: { column: 'occurred_at', type: 'timestamp', filterable: true, sortable: true, projectable: true, label: 'Occurred At' },
  ingestedAt: { column: 'ingested_at', type: 'timestamp', filterable: false, projectable: false, label: 'Ingested At' },
  createdAt: { column: 'created_at', type: 'timestamp', filterable: false, projectable: false, label: 'Created At' },
  project: {
    column: 'project_slug',
    selectExpr: '(SELECT p.slug FROM project_lookup p WHERE p.project_id = project_id LIMIT 1)',
    type: 'string',
    filterable: true,
    projectable: true,
    label: 'Project Slug',
  },
  projectSlug: {
    column: 'project_slug',
    selectExpr: '(SELECT p.slug FROM project_lookup p WHERE p.project_id = project_id LIMIT 1)',
    type: 'string',
    filterable: true,
    projectable: true,
    label: 'Project Slug',
  },
  projectName: {
    column: 'project_name',
    selectExpr: '(SELECT p.name FROM project_lookup p WHERE p.project_id = project_id LIMIT 1)',
    type: 'string',
    filterable: true,
    projectable: true,
    label: 'Project Name',
  },
  attributes: { column: 'attributes', type: 'json', filterable: false, projectable: false, label: 'Attributes' },
  metadata: { column: 'metadata', type: 'json', filterable: false, projectable: false, label: 'Metadata' },
  payload: { column: 'payload', type: 'json', filterable: false, projectable: false, label: 'Payload' },
};

/** Search key aliases common to every resource. */
export const commonSearchAliases: Record<string, string> = {
  // Correlation
  trace: 'traceId',
  trace_id: 'traceId',
  traceid: 'traceId',
  trace_public_id: 'tracePublicId',
  tracePublicId: 'tracePublicId',
  span: 'spanId',
  span_id: 'spanId',
  spanid: 'spanId',
  parent_span: 'parentSpanId',
  parent_span_id: 'parentSpanId',
  session: 'sessionId',
  session_id: 'sessionId',
  sessionid: 'sessionId',
  user: 'userId',

  // System & Environment
  service: 'service',
  environment: 'environment',
  release: 'release',
  sdkVersion: 'sdkVersion',
  sdkName: 'sdkName',
  project: 'project',
  projectSlug: 'project',
  project_slug: 'project',

  // Status & Performance
  statusCode: 'statusCode',
  durationMs: 'durationMs',

  // Content & Classification
  message: 'message',
  name: 'name',
  severity: 'severity',
  level: 'severity',
};

/**
 * Build a resource `mapRow` that normalizes pg output: drops the internal
 * cursor columns, coerces the given numeric columns from pg's string form, and
 * leaves JSONB (already parsed by pg) and everything else intact. Works with
 * dynamic field projection because it only touches keys that are present.
 */
export function makeMapRow(numericFields: readonly string[]): (row: Record<string, unknown>) => Record<string, unknown> {
  const numeric = new Set(numericFields);
  return (row: Record<string, unknown>): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      if (key === '__id' || key === '__t') continue;
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
