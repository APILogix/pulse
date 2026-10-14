/**
 * Requests explorer resource (Phase 5). Backed by `events_requests`.
 *
 * Exposes the full request column set from the architecture doc plus latency
 * statistics and traffic summary. Ingestion keeps this table intentionally
 * light on synchronous indexes; explorers should prefer tenant/time-bounded
 * scans and rollups unless a query earns a dedicated index with EXPLAIN proof.
 * The generated `is_error`/`is_slow` columns power error timelines.
 */
import type { ExplorerResource, FieldDef } from '../query-engine/field-registry.js';
import { commonFields, commonSearchAliases, makeMapRow } from './common.js';

const requestFields: Record<string, FieldDef> = {
  ...commonFields,
  requestId: { column: 'request_id', type: 'string', filterable: true, searchable: true, projectable: true, label: 'Request ID' },
  method: { column: 'method', type: 'string', filterable: true, searchable: true, projectable: true, label: 'Method' },
  endpoint: { column: 'endpoint', type: 'string', filterable: true, searchable: true, projectable: true, label: 'Endpoint' },
  name: { column: 'name', type: 'string', filterable: true, searchable: true, projectable: true, label: 'Name' },
  tracePublicId: {
    column: 'trace_public_id',
    selectExpr: 'CASE WHEN events_requests.trace_id IS NOT NULL THEN (SELECT t.public_id FROM events_traces t WHERE t.trace_id = events_requests.trace_id AND t.organization_id = events_requests.organization_id AND t.project_id IS NOT DISTINCT FROM events_requests.project_id LIMIT 1) ELSE NULL END',
    type: 'string',
    filterable: true,
    searchable: true,
    projectable: true,
    label: 'Trace Public ID',
  }, 
  framework: { column: 'framework', type: 'string', filterable: true, projectable: true, label: 'Framework' },
  bodySize: { column: 'body_size', type: 'number', filterable: true, projectable: true, label: 'Request Size' },
  responseSize: { column: 'response_size', type: 'number', filterable: true, projectable: true, label: 'Response Size' },
  clientIp: { column: 'client_ip_hash', type: 'string', filterable: true, projectable: true, label: 'IP' },
  clientIpHash: { column: 'client_ip_hash', type: 'string', filterable: true, projectable: true, label: 'IP Hash' },
  userAgent: { column: 'user_agent', type: 'string', filterable: true, searchable: true, projectable: true, label: 'User Agent' },
  referer: { column: 'referer', type: 'string', filterable: true, projectable: true, label: 'Referer' },
  geoCountry: { column: 'geo_country_code', type: 'string', filterable: true, projectable: true, label: 'Country' },
  geoRegion: { column: 'geo_region', type: 'string', filterable: true, projectable: true, label: 'Region' },
  geoAsn: { column: 'geo_asn', type: 'number', filterable: true, projectable: true, label: 'ASN' },
  browser: { column: 'browser_family', type: 'string', filterable: true, projectable: true, label: 'Browser' },
  browserVersion: { column: 'browser_version_major', type: 'string', filterable: true, projectable: true, label: 'Browser Version' },
  os: { column: 'os_name', type: 'string', filterable: true, projectable: true, label: 'OS' },
  osVersion: { column: 'os_version_major', type: 'string', filterable: true, projectable: true, label: 'OS Version' },
  device: { column: 'device_type', type: 'string', filterable: true, projectable: true, label: 'Device' },
  isBot: { column: 'is_bot', type: 'boolean', filterable: true, projectable: true, label: 'Is Bot' },
  isSlow: { column: 'is_slow', type: 'boolean', filterable: true, projectable: true, label: 'Is Slow' },
  hasError: { column: 'is_error', type: 'boolean', filterable: true, projectable: true, label: 'Has Error' },
  hasTrace: { column: 'trace_id', selectExpr: '(events_requests.trace_id IS NOT NULL)', type: 'boolean', filterable: false, projectable: true, label: 'Has Trace' },
  service: { column: 'service', type: 'string', filterable: true, searchable: true, projectable: true, label: 'Service' },
  serverName: { column: 'server_name', type: 'string', filterable: true, projectable: true, label: 'Server' },
  tenantId: { column: 'tenant_id', type: 'string', filterable: true, projectable: true, label: 'Tenant' },
  aiResponse: { column: 'ai_response', type: 'json', filterable: false, projectable: false, label: 'AI Response' },
  project: { column: 'project_slug', selectExpr: '(SELECT slug FROM project_lookup WHERE project_id = events_requests.project_id)', type: 'string', filterable: true, projectable: true, label: 'Project' },
  projectSlug: { column: 'project_slug', selectExpr: '(SELECT slug FROM project_lookup WHERE project_id = events_requests.project_id)', type: 'string', filterable: true, projectable: true, label: 'Project Slug' },
  projectName: { column: 'project_name', selectExpr: '(SELECT name FROM project_lookup WHERE project_id = events_requests.project_id)', type: 'string', filterable: true, projectable: true, label: 'Project Name' },
};

// Events_requests table does not have a message column
delete requestFields.message;

const NUMERIC = ['statusCode', 'bodySize', 'responseSize', 'durationMs', 'geoAsn'];

const requestsSearchAliases: Record<string, string> = {
  ...commonSearchAliases,
  status: 'statusCode',
  latency: 'durationMs',
  duration: 'durationMs',
  project: 'project',
  project_slug: 'project',
  country: 'geoCountry',
  browser: 'browser',
  os: 'os',
  device: 'device',
  ip: 'clientIp',
};
// `events_requests` has no message column, so the common alias is invalid here.
delete requestsSearchAliases.message;

export const requestsResource: ExplorerResource = {
  name: 'requests',
  table: 'events_requests',
  timeColumn: 'occurred_at',
  idColumn: 'id',
  fields: requestFields,
  searchFields: ['publicId', 'endpoint', 'name', 'method', 'requestId', 'userId', 'service'],
  searchAliases: requestsSearchAliases,
  defaultSort: { field: 'occurredAt', direction: 'desc' },
  defaultProjection: [
    'id', 'publicId', 'occurredAt', 'method', 'endpoint', 'name', 'statusCode',
    'durationMs', 'environment', 'service', 'project', 'projectSlug', 'projectName',
    'traceId', 'tracePublicId', 'requestId', 'isSlow', 'hasError',
  ],
  preferredIndexes: [
    'idx_events_requests_tenant_time',
    'idx_events_requests_occurred_brin',
    'idx_events_requests_pubid',
  ],
  errorPredicate: 'is_error',
  summary: {
    total: 'COUNT(*)::bigint',
    errors: '(COUNT(*) FILTER (WHERE is_error))::bigint',
    slow: '(COUNT(*) FILTER (WHERE is_slow))::bigint',
    uniqueUsers: 'COUNT(DISTINCT user_id)::bigint',
    uniqueRoutes: 'COUNT(DISTINCT endpoint)::bigint',
  },
  statistics: {
    avgLatency: 'ROUND(COALESCE(AVG(duration_ms), 0))::int',
    maxLatency: 'COALESCE(MAX(duration_ms), 0)::int',
    p50: 'ROUND(COALESCE(percentile_cont(0.5) WITHIN GROUP (ORDER BY duration_ms), 0))::int',
    p95: 'ROUND(COALESCE(percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms), 0))::int',
    p99: 'ROUND(COALESCE(percentile_cont(0.99) WITHIN GROUP (ORDER BY duration_ms), 0))::int',
    errorRate: '(COUNT(*) FILTER (WHERE is_error))::float8 / NULLIF(COUNT(*), 0)',
  },
  mapRow: makeMapRow(NUMERIC),
};
