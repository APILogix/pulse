/**
 * Stable Database Query Names Catalog.
 *
 * Every database query call in the system MUST supply a compile-time validated
 * stable query name. Never derive query names or metric labels from raw SQL.
 */

export const DB_QUERY_NAMES = {
  // ── Control-Plane Queries (PrimaryDB) ──────────────────────────────────
  AUTH_API_KEY_LOOKUP: 'auth.apiKeyLookup',
  AUTH_USER_LOOKUP_BY_EMAIL: 'auth.userLookupByEmail',
  AUTH_USER_LOOKUP_BY_ID: 'auth.userLookupById',
  AUTH_CREATE_SESSION: 'auth.createSession',
  AUTH_VALIDATE_SESSION: 'auth.validateSession',
  AUTH_REFRESH_TOKEN: 'auth.refreshToken',
  ORG_GET_BY_ID: 'org.getById',
  ORG_GET_BY_SLUG: 'org.getBySlug',
  ORG_CREATE: 'org.create',
  ORG_LIST_MEMBERS: 'org.listMembers',
  ORG_UPDATE_SETTINGS: 'org.updateSettings',
  PROJECT_GET_BY_ID: 'project.getById',
  PROJECT_LIST_BY_ORG: 'project.listByOrg',
  PROJECT_SDK_CONFIG_LOOKUP: 'project.sdkConfigLookup',
  BILLING_GET_SUBSCRIPTION: 'billing.getSubscription',
  BILLING_UPDATE_USAGE: 'billing.updateUsage',
  BILLING_RECORD_INVOICE: 'billing.recordInvoice',
  ALERTS_LIST_RULES: 'alerts.listRules',
  ALERTS_EVALUATE_RULE: 'alerts.evaluateRule',
  ALERTS_CREATE_INCIDENT: 'alerts.createIncident',
  CONNECTORS_GET_BY_ID: 'connectors.getById',
  CONNECTORS_LIST: 'connectors.list',
  PGMQ_ENQUEUE: 'pgmq.enqueue',
  PGMQ_DEQUEUE: 'pgmq.dequeue',
  CONTROL_HEALTH_CHECK: 'control.healthCheck',

  // ── Telemetry Queries (LogDB / TimescaleDB) ───────────────────────────
  INGEST_BATCH_INSERT_EVENTS: 'ingest.batchInsertEvents',
  INGEST_BATCH_INSERT_SPANS: 'ingest.batchInsertSpans',
  INGEST_BATCH_INSERT_LOGS: 'ingest.batchInsertLogs',
  INGEST_BATCH_INSERT_ERRORS: 'ingest.batchInsertErrors',
  INGEST_FLUSH_USAGE: 'ingest.flushUsage',
  DASHBOARD_WIDGET_ROLLUP: 'dashboard.widgetRollup',
  DASHBOARD_RAW_METRICS: 'dashboard.rawMetricsQuery',
  TRACES_GET_BY_ID: 'traces.getById',
  TRACES_SEARCH_SPANS: 'traces.searchSpans',
  LOGS_SEARCH_BOUNDED: 'logs.searchBounded',
  ERRORS_GET_GROUP: 'errors.getGroup',
  ERRORS_LIST_RECENT: 'errors.listRecent',
  ANALYTICS_WATERMARK_CHECK: 'analytics.watermarkCheck',
  ANALYTICS_ROLLUP_EXECUTION: 'analytics.rollupExecution',
  ANALYTICS_MAINTENANCE_PARTITIONS: 'analytics.maintenancePartitions',
  TELEMETRY_HEALTH_CHECK: 'telemetry.healthCheck',
} as const;

export type DbQueryName = typeof DB_QUERY_NAMES[keyof typeof DB_QUERY_NAMES];

/** Helper to validate that a string is a registered DbQueryName */
export function isRegisteredQueryName(name: string): name is DbQueryName {
  return Object.values(DB_QUERY_NAMES).includes(name as DbQueryName);
}
