/**
 * Logs explorer resource. Backed by `events_logs`.
 * Uses specialized composite indices for ultra-fast filtering.
 */
import type { ExplorerResource, FieldDef } from '../query-engine/field-registry.js';
import { commonFields, commonSearchAliases, makeMapRow } from './common.js';

const LOG_LEVELS = ['debug', 'info', 'warn', 'warning', 'error', 'fatal'] as const;
const LOG_CATEGORIES = ['http', 'application', 'database', 'cache', 'queue', 'worker', 'cron', 'security', 'authentication', 'authorization', 'business', 'system', 'runtime', 'custom', 'unknown'] as const;
const LOG_SOURCES = ['sdk', 'console', 'framework', 'middleware', 'application', 'worker', 'cron', 'queue', 'unknown'] as const;

const logFields: Record<string, FieldDef> = {
  ...commonFields,
  // ── Core Log Fields ──────────────────────────────────────────────────────────
  level:       { column: 'level',        type: 'enum',    enumValues: LOG_LEVELS, filterable: true, projectable: true, label: 'Level' },
  name:        { column: 'name',         type: 'string',  filterable: true, searchable: true, projectable: true, label: 'Name' },
  logger:      { column: 'logger',       type: 'string',  filterable: true, searchable: true, projectable: true, label: 'Original Logger' },
  loggerName:  { column: 'logger_name',  type: 'string',  filterable: true, searchable: true, projectable: true, label: 'Logger Name' },
  // ── Categorization ───────────────────────────────────────────────────────────
  logCategory: { column: 'log_category', type: 'enum',    enumValues: LOG_CATEGORIES, filterable: true, projectable: true, label: 'Category' },
  logSource:   { column: 'log_source',   type: 'enum',    enumValues: LOG_SOURCES, filterable: true, projectable: true, label: 'Source' },
  // ── HTTP Context ─────────────────────────────────────────────────────────────
  endpoint:    { column: 'endpoint',     type: 'string',  filterable: true, searchable: true, projectable: true, label: 'Endpoint' },
  httpMethod:  { column: 'http_method',  type: 'string',  filterable: true, projectable: true, label: 'HTTP Method' },
  statusCode:  { column: 'status_code',  type: 'number',  filterable: true, sortable: true, projectable: true, label: 'Status Code' },
  durationMs:  { column: 'duration_ms',  type: 'number',  filterable: true, sortable: true, projectable: true, label: 'Duration (ms)' },
  // ── Correlation ──────────────────────────────────────────────────────────────
  requestId:   { column: 'request_id',   type: 'string',  filterable: true, projectable: true, label: 'Request ID' },
  traceId:     { column: 'trace_id',     type: 'string',  filterable: true, projectable: true, label: 'Trace ID' },
  spanId:      { column: 'span_id',      type: 'string',  filterable: true, projectable: true, label: 'Span ID' },
  parentSpanId:{ column: 'parent_span_id',type:'string',  filterable: true, projectable: true, label: 'Parent Span' },
  sessionId:   { column: 'session_id',   type: 'string',  filterable: true, projectable: true, label: 'Session ID' },
  tenantId:    { column: 'tenant_id',    type: 'string',  filterable: true, projectable: true, label: 'Tenant ID' },
  // ── User ─────────────────────────────────────────────────────────────────────
  userIp:      { column: 'user_ip',      selectExpr: 'user_ip::text', type: 'string', filterable: true, projectable: true, label: 'User IP' },
};

export const logsResource: ExplorerResource = {
  name: 'logs',
  table: 'events_logs',
  timeColumn: 'timestamp',
  idColumn: 'id',
  fields: logFields,
  searchFields: ['message', 'logger', 'loggerName', 'name', 'endpoint', 'service'],
  searchAliases: {
    ...commonSearchAliases,
    level:    'level',
    logger:   'logger',
    source:   'logSource',
    category: 'logCategory',
    endpoint: 'endpoint',
    method:   'httpMethod',
    status:   'statusCode',
    tenant:   'tenantId',
  },
  defaultSort: { field: 'timestamp', direction: 'desc' },
  defaultProjection: [
    'id', 'projectId', 'environment', 'timestamp', 'level', 'name', 'message',
    'logCategory', 'endpoint', 'statusCode', 'durationMs',
    'service', 'traceId', 'requestId',
  ],
  preferredIndexes: [
    'idx_events_logs_level_time',
    'idx_events_logs_endpoint_time',
    'idx_events_logs_category_time',
    'idx_events_logs_logger_time',
  ],
  errorPredicate: "level IN ('error','fatal') OR status_code >= 500",
  summary: {
    total:         'COUNT(*)::bigint',
    errorLogs:     "(COUNT(*) FILTER (WHERE level IN ('error','fatal')))::bigint",
    warnLogs:      "(COUNT(*) FILTER (WHERE level IN ('warn','warning')))::bigint",
    http5xx:       "(COUNT(*) FILTER (WHERE status_code >= 500))::bigint",
    uniqueLoggers: 'COUNT(DISTINCT logger_name)::bigint',
  },
  statistics: {
    avgRuntime: 'AVG(duration_ms)',
    maxRuntime: 'MAX(duration_ms)',
    p95Runtime: 'PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms)',
  },
  mapRow: makeMapRow(['statusCode', 'durationMs']),
};
