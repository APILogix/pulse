/**
 * Errors explorer resource (Phase 6). Backed by `events_errors`.
 * Uses `idx_events_errors_fingerprint_time` for grouping/triage filters.
 */
import type { ExplorerResource, FieldDef } from '../query-engine/field-registry.js';
import { commonFields, commonSearchAliases, makeMapRow } from './common.js';

const errorFields: Record<string, FieldDef> = {
  ...commonFields,
  fingerprint: { column: 'fingerprint', type: 'string', filterable: true, searchable: true, projectable: true, label: 'Fingerprint' },
  errorGroupId: { column: 'error_group_id', type: 'uuid', filterable: true, projectable: true, label: 'Error Group' },
  errorName: { column: 'error_name', type: 'string', filterable: true, searchable: true, projectable: true, label: 'Exception' },
  requestId: { column: 'request_id', type: 'string', filterable: true, projectable: true, label: 'Request ID' },
  route: { column: 'route', type: 'string', filterable: true, searchable: true, projectable: true, label: 'Route' },
  mechanism: { column: 'mechanism', type: 'string', filterable: true, projectable: true, label: 'Mechanism' },
  handled: { column: 'handled', type: 'boolean', filterable: true, projectable: true, label: 'Handled' },
  isHandled: { column: 'handled', type: 'boolean', filterable: true, projectable: true, label: 'Is Handled' },
  userEmail: { column: 'attributes', selectExpr: "attributes->'user'->>'email'", type: 'string', filterable: true, searchable: true, projectable: true, label: 'User Email' },
  userIp: { column: 'attributes', selectExpr: "attributes->'user'->>'ip'", type: 'string', filterable: true, projectable: true, label: 'User IP' },
  serverName: { column: 'server_name', type: 'string', filterable: true, projectable: true, label: 'Server' },
  appName: { column: 'application_name', type: 'string', filterable: true, projectable: true, label: 'Application' },
  appVersion: { column: 'application_version', type: 'string', filterable: true, projectable: true, label: 'Application Version' },
  project: { column: 'project_slug', selectExpr: '(SELECT slug FROM project_lookup WHERE project_id = events_errors.project_id)', type: 'string', filterable: true, projectable: true, label: 'Project' },
  projectSlug: { column: 'project_slug', selectExpr: '(SELECT slug FROM project_lookup WHERE project_id = events_errors.project_id)', type: 'string', filterable: true, projectable: true, label: 'Project Slug' },
  projectName: { column: 'project_name', selectExpr: '(SELECT name FROM project_lookup WHERE project_id = events_errors.project_id)', type: 'string', filterable: true, projectable: true, label: 'Project Name' },
};

export const errorsResource: ExplorerResource = {
  name: 'errors',
  table: 'events_errors',
  timeColumn: 'occurred_at',
  idColumn: 'id',
  fields: errorFields,
  searchFields: ['message', 'errorName', 'fingerprint', 'route'],
  searchAliases: { ...commonSearchAliases, error: 'errorName', exception: 'errorName', fingerprint: 'fingerprint', route: 'route' },
  defaultSort: { field: 'occurredAt', direction: 'desc' },
  defaultProjection: [
    'id', 'occurredAt', 'message', 'errorGroupId', 'traceId',
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
  mapRow: makeMapRow(['statusCode', 'durationMs']),
};
