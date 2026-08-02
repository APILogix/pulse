/**
 * Errors explorer resource (Phase 6). Backed by `events_errors`.
 * Uses `idx_events_errors_fingerprint_time` for grouping/triage filters.
 */
import type { ExplorerResource, FieldDef } from '../query-engine/field-registry.js';
import { commonFields, commonSearchAliases, makeMapRow } from './common.js';

const errorFields: Record<string, FieldDef> = {
  ...commonFields,
  fingerprint: { column: 'fingerprint', type: 'string', filterable: true, searchable: true, projectable: true, label: 'Fingerprint' },
  errorName: { column: 'error_name', type: 'string', filterable: true, searchable: true, projectable: true, label: 'Exception' },
  requestId: { column: 'request_id', type: 'string', filterable: true, projectable: true, label: 'Request ID' },
  source: { column: 'source', type: 'string', filterable: true, searchable: true, projectable: true, label: 'Source' },
  mechanism: { column: 'mechanism', type: 'string', filterable: true, projectable: true, label: 'Mechanism' },
  handled: { column: 'mechanism', selectExpr: "(mechanism = 'handled')", type: 'boolean', filterable: false, projectable: true, label: 'Handled' },
  userEmail: { column: 'attributes', selectExpr: "attributes->'user'->>'email'", type: 'string', filterable: true, searchable: true, projectable: true, label: 'User Email' },
  userIp: { column: 'attributes', selectExpr: "attributes->'user'->>'ip'", type: 'string', filterable: true, projectable: true, label: 'User IP' },
  serverName: { column: 'server_name', type: 'string', filterable: true, projectable: true, label: 'Server' },
  appName: { column: 'application_name', type: 'string', filterable: true, projectable: true, label: 'Application' },
  appVersion: { column: 'application_version', type: 'string', filterable: true, projectable: true, label: 'Application Version' },
};

export const errorsResource: ExplorerResource = {
  name: 'errors',
  table: 'events_errors',
  timeColumn: 'timestamp',
  idColumn: 'id',
  fields: errorFields,
  searchFields: ['message', 'errorName', 'fingerprint'],
  searchAliases: { ...commonSearchAliases, error: 'errorName', exception: 'errorName', fingerprint: 'fingerprint' },
  defaultSort: { field: 'timestamp', direction: 'desc' },
  defaultProjection: [
    'id', 'projectId', 'environment', 'timestamp', 'severity', 'errorName', 'message',
    'fingerprint', 'traceId', 'requestId', 'userId', 'service', 'release', 'source', 'handled',
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
