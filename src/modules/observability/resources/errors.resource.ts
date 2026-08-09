/**
 * Errors explorer resource (Phase 6). Backed by `events_errors`.
 * Uses `idx_events_errors_fingerprint_time` for grouping/triage filters.
 *
 * Fields are defined explicitly against the `events_errors` schema in
 * `database/migrations/logdb/03_observability_v2/002_events_errors.sql`. We do
 * NOT spread `commonFields` here because that set assumes columns (tenant_id,
 * duration_ms, name, endpoint, attributes) that do not exist on this table.
 */
import type { ExplorerResource, FieldDef } from '../query-engine/field-registry.js';
import { SEVERITY_VALUES, makeMapRow } from './common.js';

const errorFields: Record<string, FieldDef> = {
  // Identity
  id: { column: 'id', type: 'uuid', filterable: true, sortable: false, projectable: true, label: 'ID' },
  publicId: { column: 'public_id', type: 'string', filterable: true, searchable: true, projectable: true, label: 'Public ID' },
  eventId: { column: 'event_id', type: 'string', filterable: true, projectable: true, label: 'Event ID' },
  organizationId: { column: 'organization_id', type: 'uuid', filterable: false, projectable: false, label: 'Organization ID' },
  projectId: { column: 'project_id', type: 'uuid', filterable: false, projectable: false, label: 'Project' },
  apiKeyName: { column: 'api_key_name', type: 'string', filterable: false, projectable: false, label: 'API Key' },

  // Environment
  environment: { column: 'environment', type: 'string', filterable: true, projectable: true, label: 'Environment' },

  // Correlation
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
  requestId: { column: 'request_id', type: 'string', filterable: true, projectable: true, label: 'Request ID' },

  // Error grouping
  fingerprint: { column: 'fingerprint', type: 'string', filterable: true, searchable: true, projectable: true, label: 'Fingerprint' },
  errorGroupId: { column: 'error_group_id', type: 'uuid', filterable: true, projectable: true, label: 'Error Group' },
  errorGroupPublicId: {
    column: 'error_group_public_id',
    selectExpr: 'COALESCE((SELECT eg.public_id FROM error_groups eg WHERE eg.id = error_group_id LIMIT 1), (SELECT eg.public_id FROM error_groups eg WHERE eg.fingerprint = events_errors.fingerprint AND eg.organization_id = events_errors.organization_id LIMIT 1))',
    type: 'string',
    filterable: true,
    searchable: true,
    projectable: true,
    label: 'Error Group Public ID',
  },

  // Error classification
  errorName: { column: 'error_name', type: 'string', filterable: true, searchable: true, projectable: true, label: 'Exception' },
  message: { column: 'message', type: 'string', filterable: true, searchable: true, projectable: true, label: 'Message' },
  severity: { column: 'severity', type: 'enum', enumValues: SEVERITY_VALUES, filterable: true, projectable: true, label: 'Severity' },
  mechanism: { column: 'mechanism', type: 'string', filterable: true, projectable: true, label: 'Mechanism' },
  handled: { column: 'handled', type: 'boolean', filterable: true, projectable: true, label: 'Handled' },
  isHandled: { column: 'handled', type: 'boolean', filterable: true, projectable: true, label: 'Is Handled' },

  // HTTP
  method: { column: 'method', type: 'string', filterable: true, searchable: true, projectable: true, label: 'Method' },
  route: { column: 'route', type: 'string', filterable: true, searchable: true, projectable: true, label: 'Route' },
  url: { column: 'url', type: 'string', filterable: true, projectable: true, label: 'URL' },
  statusCode: { column: 'status_code', type: 'number', filterable: true, sortable: true, projectable: true, label: 'Status Code' },
  statusText: { column: 'status_text', type: 'string', filterable: true, projectable: true, label: 'Status Text' },

  // Service / SDK
  service: { column: 'service', type: 'string', filterable: true, searchable: true, projectable: true, label: 'Service' },
  serverName: { column: 'server_name', type: 'string', filterable: true, projectable: true, label: 'Server' },
  release: { column: 'release', type: 'string', filterable: true, projectable: true, label: 'Release' },
  sdkName: { column: 'sdk_name', type: 'string', filterable: true, projectable: true, label: 'SDK Name' },
  sdkVersion: { column: 'sdk_version', type: 'string', filterable: true, projectable: true, label: 'SDK Version' },
  appName: { column: 'application_name', type: 'string', filterable: true, projectable: true, label: 'Application' },
  appVersion: { column: 'application_version', type: 'string', filterable: true, projectable: true, label: 'Application Version' },

  // Time
  occurredAt: { column: 'occurred_at', type: 'timestamp', filterable: true, sortable: true, projectable: true, label: 'Occurred At' },
  ingestedAt: { column: 'ingested_at', type: 'timestamp', filterable: false, projectable: false, label: 'Ingested At' },
  createdAt: { column: 'created_at', type: 'timestamp', filterable: false, projectable: false, label: 'Created At' },

  // Project lookups
  project: {
    column: 'project_slug',
    selectExpr: '(SELECT slug FROM project_lookup WHERE project_id = events_errors.project_id)',
    type: 'string',
    filterable: true,
    projectable: true,
    label: 'Project',
  },
  projectSlug: {
    column: 'project_slug',
    selectExpr: '(SELECT slug FROM project_lookup WHERE project_id = events_errors.project_id)',
    type: 'string',
    filterable: true,
    projectable: true,
    label: 'Project Slug',
  },
  projectName: {
    column: 'project_name',
    selectExpr: '(SELECT name FROM project_lookup WHERE project_id = events_errors.project_id)',
    type: 'string',
    filterable: true,
    projectable: true,
    label: 'Project Name',
  },

  // AI
  aiResponse: { column: 'ai_response', type: 'json', filterable: false, projectable: false, label: 'AI Response' },

  // JSONB payloads (not filterable/projectable in the explorer; exposed only for detail assembly)
  stackFrames: { column: 'stack_frames', type: 'json', filterable: false, projectable: false, label: 'Stack Frames' },
  breadcrumbs: { column: 'breadcrumbs', type: 'json', filterable: false, projectable: false, label: 'Breadcrumbs' },
  context: { column: 'context', type: 'json', filterable: false, projectable: false, label: 'Context' },
  tags: { column: 'tags', type: 'json', filterable: false, projectable: false, label: 'Tags' },
  extra: { column: 'extra', type: 'json', filterable: false, projectable: false, label: 'Extra' },
  metadata: { column: 'metadata', type: 'json', filterable: false, projectable: false, label: 'Metadata' },
  payload: { column: 'payload', type: 'json', filterable: false, projectable: false, label: 'Payload' },
};

const errorsSearchAliases: Record<string, string> = {
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
  service: 'service',
  environment: 'environment',
  release: 'release',
  sdkVersion: 'sdkVersion',
  sdkName: 'sdkName',
  project: 'project',
  projectSlug: 'project',
  project_slug: 'project',
  statusCode: 'statusCode',
  error: 'errorName',
  exception: 'errorName',
  fingerprint: 'fingerprint',
  route: 'route',
  error_group_public_id: 'errorGroupPublicId',
  errorGroupPublicId: 'errorGroupPublicId',
  error_group: 'errorGroupPublicId',
  errorGroup: 'errorGroupPublicId',
  group: 'errorGroupPublicId',
  severity: 'severity',
  level: 'severity',
};

export const errorsResource: ExplorerResource = {
  name: 'errors',
  table: 'events_errors',
  timeColumn: 'occurred_at',
  idColumn: 'id',
  fields: errorFields,
  searchFields: ['publicId', 'errorGroupPublicId', 'tracePublicId', 'message', 'errorName', 'fingerprint', 'route'],
  searchAliases: errorsSearchAliases,
  defaultSort: { field: 'occurredAt', direction: 'desc' },
  defaultProjection: [
    'id', 'publicId', 'occurredAt', 'message', 'errorGroupId', 'errorGroupPublicId', 'traceId', 'tracePublicId',
    'route', 'statusCode', 'severity', 'handled', 'environment',
  ],
  preferredIndexes: ['idx_events_errors_tenant_env_time', 'idx_events_errors_fingerprint_time'],
  errorPredicate: "severity IN ('error','critical','fatal')",
  summary: {
    total: 'COUNT(*)::bigint',
    uniqueFingerprints: 'COUNT(DISTINCT fingerprint)::bigint',
    affectedUsers: 'COUNT(DISTINCT user_id)::bigint',
    fatal: "(COUNT(*) FILTER (WHERE severity = 'fatal'))::bigint",
  },
  mapRow: makeMapRow(['statusCode']),
};
