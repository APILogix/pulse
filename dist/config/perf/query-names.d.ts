/**
 * Stable Database Query Names Catalog.
 *
 * Every database query call in the system MUST supply a compile-time validated
 * stable query name. Never derive query names or metric labels from raw SQL.
 */
export declare const DB_QUERY_NAMES: {
    readonly AUTH_API_KEY_LOOKUP: "auth.apiKeyLookup";
    readonly AUTH_USER_LOOKUP_BY_EMAIL: "auth.userLookupByEmail";
    readonly AUTH_USER_LOOKUP_BY_ID: "auth.userLookupById";
    readonly AUTH_CREATE_SESSION: "auth.createSession";
    readonly AUTH_VALIDATE_SESSION: "auth.validateSession";
    readonly AUTH_REFRESH_TOKEN: "auth.refreshToken";
    readonly ORG_GET_BY_ID: "org.getById";
    readonly ORG_GET_BY_SLUG: "org.getBySlug";
    readonly ORG_CREATE: "org.create";
    readonly ORG_LIST_MEMBERS: "org.listMembers";
    readonly ORG_UPDATE_SETTINGS: "org.updateSettings";
    readonly PROJECT_GET_BY_ID: "project.getById";
    readonly PROJECT_LIST_BY_ORG: "project.listByOrg";
    readonly PROJECT_SDK_CONFIG_LOOKUP: "project.sdkConfigLookup";
    readonly BILLING_GET_SUBSCRIPTION: "billing.getSubscription";
    readonly BILLING_UPDATE_USAGE: "billing.updateUsage";
    readonly BILLING_RECORD_INVOICE: "billing.recordInvoice";
    readonly ALERTS_LIST_RULES: "alerts.listRules";
    readonly ALERTS_EVALUATE_RULE: "alerts.evaluateRule";
    readonly ALERTS_CREATE_INCIDENT: "alerts.createIncident";
    readonly CONNECTORS_GET_BY_ID: "connectors.getById";
    readonly CONNECTORS_LIST: "connectors.list";
    readonly PGMQ_ENQUEUE: "pgmq.enqueue";
    readonly PGMQ_DEQUEUE: "pgmq.dequeue";
    readonly CONTROL_HEALTH_CHECK: "control.healthCheck";
    readonly INGEST_BATCH_INSERT_EVENTS: "ingest.batchInsertEvents";
    readonly INGEST_BATCH_INSERT_SPANS: "ingest.batchInsertSpans";
    readonly INGEST_BATCH_INSERT_LOGS: "ingest.batchInsertLogs";
    readonly INGEST_BATCH_INSERT_ERRORS: "ingest.batchInsertErrors";
    readonly INGEST_FLUSH_USAGE: "ingest.flushUsage";
    readonly DASHBOARD_WIDGET_ROLLUP: "dashboard.widgetRollup";
    readonly DASHBOARD_RAW_METRICS: "dashboard.rawMetricsQuery";
    readonly TRACES_GET_BY_ID: "traces.getById";
    readonly TRACES_SEARCH_SPANS: "traces.searchSpans";
    readonly LOGS_SEARCH_BOUNDED: "logs.searchBounded";
    readonly ERRORS_GET_GROUP: "errors.getGroup";
    readonly ERRORS_LIST_RECENT: "errors.listRecent";
    readonly ANALYTICS_WATERMARK_CHECK: "analytics.watermarkCheck";
    readonly ANALYTICS_ROLLUP_EXECUTION: "analytics.rollupExecution";
    readonly ANALYTICS_MAINTENANCE_PARTITIONS: "analytics.maintenancePartitions";
    readonly TELEMETRY_HEALTH_CHECK: "telemetry.healthCheck";
};
export type DbQueryName = typeof DB_QUERY_NAMES[keyof typeof DB_QUERY_NAMES];
/** Helper to validate that a string is a registered DbQueryName */
export declare function isRegisteredQueryName(name: string): name is DbQueryName;
//# sourceMappingURL=query-names.d.ts.map