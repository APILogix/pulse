/**
 * Event-analytics persistence layer.
 *
 * All reads are organization-scoped (tenant isolation) and time-ranged so they
 * use the indexes from migration 004. No N+1: detail endpoints fetch related
 * rows via bulk/`= ANY` queries or run independent queries concurrently in the
 * service layer. No caching (per requirements).
 */
import type { Pool } from 'pg';
import { type AnalyticsTableKey, type TimeBucket } from './query-builder.js';
import type { TimeRange } from './types.js';
export declare const ANALYTICS_ERROR_GROUP_COLUMNS = "\n  id, organization_id, project_id, fingerprint, error_name, message_template, first_seen_at, last_seen_at, total_count, today_count, week_count, month_count, status, assigned_to, services, environments, releases, created_at, updated_at\n";
export declare const ANALYTICS_DASHBOARD_COLUMNS = "\n  id, organization_id, project_id, name, description, layout, widgets, is_shared, created_by, created_at, updated_at\n";
export declare const ANALYTICS_SAVED_QUERY_COLUMNS = "\n  id, organization_id, project_id, name, description, query_type, query_config, visualization_type, visualization_config, created_by, created_at, updated_at\n";
export declare const ANALYTICS_ALERT_COLUMNS = "\n  id, organization_id, project_id, name, metric, operator, threshold, window_minutes, notification_channels, is_active, created_by, created_at, updated_at\n";
export declare const ANALYTICS_USER_SESSION_COLUMNS = "\n  id, organization_id, project_id, session_id, user_id, started_at, ended_at, duration_seconds, event_count, error_count, pages, is_crashed, created_at\n";
export declare class EventAnalyticsRepository {
    private readonly db;
    constructor(db: Pool);
    private withTransaction;
    getErrorStats(orgId: string, projectId: string | undefined, environment: string | undefined, range: TimeRange): Promise<{
        total: number;
        fatal: number;
        error: number;
        warning: number;
    }>;
    /**
     * Request statistics across a time range.
     *
     * ANL-Q006 optimization: reads from pre-aggregated rollups (request_metrics_1h / request_metrics_1m)
     * where available, merging logarithmic histograms in memory to estimate p50/p95/p99 without
     * heavy PERCENTILE_CONT sorting over raw events_requests partitions. Falls back to raw table
     * only if rollup data is not yet available for the requested range.
     */
    getRequestStats(orgId: string, projectId: string | undefined, environment: string | undefined, range: TimeRange): Promise<{
        total: number;
        errors: number;
        errorRate: number;
        avgLatencyMs: number | null;
        p50: number | null;
        p95: number | null;
        p99: number | null;
    }>;
    /**
     * Unique user count across a time range.
     *
     * ANL-Q007 optimization: reads from pre-aggregated rollups using HLL sketches
     * (or exact bucket counts) where available, avoiding massive HashAggregates over
     * raw events_requests.
     */
    getUniqueUserCount(orgId: string, projectId: string | undefined, environment: string | undefined, range: TimeRange): Promise<number>;
    getEventTrend(tableKey: AnalyticsTableKey, orgId: string, projectId: string | undefined, environment: string | undefined, range: TimeRange, bucket: TimeBucket, extraSelects?: string): Promise<Array<Record<string, unknown>>>;
    listErrors(orgId: string, range: TimeRange, filters: {
        projectId?: string;
        environment?: string;
        severity?: string;
        service?: string;
        release?: string;
        search?: string;
        fingerprint?: string;
        limit: number;
        offset: number;
    }): Promise<{
        rows: Array<Record<string, unknown>>;
        total: number;
    }>;
    getErrorById(orgId: string, id: string, projectId?: string, environment?: string): Promise<Record<string, unknown> | null>;
    listErrorGroups(orgId: string, filters: {
        projectId?: string;
        environment?: string;
        status?: string;
        search?: string;
        sortBy: string;
        sortOrder: 'asc' | 'desc';
        limit: number;
        offset: number;
    }): Promise<{
        rows: Array<Record<string, unknown>>;
        total: number;
    }>;
    getErrorGroup(orgId: string, projectId: string, fingerprint: string, environment: string): Promise<Record<string, unknown> | null>;
    updateErrorGroupStatus(orgId: string, projectId: string, fingerprint: string, environment: string, status: string, assignedTo: string | null): Promise<Record<string, unknown> | null>;
    /** Route performance from the pre-aggregated summary; falls back to live compute. */
    getRoutePerformance(orgId: string, projectId: string | undefined, environment: string | undefined, sinceDate: Date, limit: number): Promise<Array<Record<string, unknown>>>;
    getLatencyDistribution(orgId: string, projectId: string | undefined, environment: string | undefined, range: TimeRange): Promise<Array<Record<string, unknown>>>;
    /** Raw counts needed for an Apdex score (T = satisfied threshold ms). */
    getApdexCounts(orgId: string, projectId: string | undefined, environment: string | undefined, range: TimeRange, thresholdMs: number): Promise<{
        satisfied: number;
        tolerating: number;
        total: number;
    }>;
    listRequests(orgId: string, range: TimeRange, filters: {
        projectId?: string;
        environment?: string;
        method?: string;
        statusCode?: number;
        route?: string;
        slowOnly?: boolean;
        errorOnly?: boolean;
        limit: number;
        offset: number;
    }): Promise<{
        rows: Array<Record<string, unknown>>;
        total: number;
    }>;
    getRequestById(orgId: string, id: string, projectId?: string, environment?: string): Promise<Record<string, unknown> | null>;
    getSpansByTrace(orgId: string, traceId: string, projectId: string, environment: string, limit?: number): Promise<Array<Record<string, unknown>>>;
    getTraceById(orgId: string, traceId: string, projectId: string, environment: string): Promise<Record<string, unknown> | null>;
    listTraces(orgId: string, range: TimeRange, filters: {
        projectId?: string;
        environment?: string;
        traceId?: string;
        requestId?: string;
        service?: string;
        rootSpanName?: string;
        minDurationMs?: number;
        errorOnly?: boolean;
        limit: number;
        offset: number;
    }): Promise<{
        rows: Array<Record<string, unknown>>;
        total: number;
    }>;
    listMetricNames(orgId: string, projectId: string | undefined, environment: string | undefined, range: TimeRange): Promise<Array<Record<string, unknown>>>;
    getMetricSeries(orgId: string, name: string, range: TimeRange, bucket: TimeBucket, aggregate: string, projectId: string | undefined, environment: string | undefined): Promise<Array<Record<string, unknown>>>;
    getMetricStats(orgId: string, name: string, range: TimeRange, projectId: string | undefined, environment: string | undefined): Promise<Record<string, unknown> | null>;
    listLogs(orgId: string, range: TimeRange, filters: {
        projectId?: string;
        environment?: string;
        level?: string;
        service?: string;
        search?: string;
        securityOnly?: boolean;
        limit: number;
        offset: number;
    }): Promise<{
        rows: Array<Record<string, unknown>>;
        total: number;
    }>;
    getLog(orgId: string, id: string): Promise<Record<string, unknown> | null>;
    summarizeLogs(orgId: string, range: TimeRange, filters: {
        projectId?: string;
        environment?: string;
        level?: string;
        service?: string;
        search?: string;
        limit: number;
    }): Promise<Array<Record<string, unknown>>>;
    listObservedServices(orgId: string, range: TimeRange, projectId: string | undefined, environment: string | undefined, limit: number): Promise<Array<Record<string, unknown>>>;
    listServiceEndpoints(orgId: string, service: string, range: TimeRange, projectId: string | undefined, environment: string | undefined, limit: number): Promise<Array<Record<string, unknown>>>;
    /** Logs newer than a cursor timestamp — used by the SSE poll loop. */
    listLogsSince(orgId: string, since: Date, projectId: string | undefined, environment: string | undefined, limit: number): Promise<Array<Record<string, unknown>>>;
    listErrorsSince(orgId: string, since: Date, projectId: string | undefined, environment: string | undefined, limit: number): Promise<Array<Record<string, unknown>>>;
    listSessions(orgId: string, range: TimeRange, filters: {
        projectId?: string;
        environment?: string;
        userId?: string;
        crashedOnly?: boolean;
        limit: number;
        offset: number;
    }): Promise<{
        rows: Array<Record<string, unknown>>;
        total: number;
    }>;
    getSession(orgId: string, sessionId: string, projectId: string, environment: string): Promise<Record<string, unknown> | null>;
    listUsers(orgId: string, range: TimeRange, projectId: string | undefined, environment: string | undefined, limit: number, offset: number): Promise<Array<Record<string, unknown>>>;
    getUserJourney(orgId: string, userId: string, range: TimeRange, projectId: string | undefined, environment: string | undefined, limit: number): Promise<{
        errors: Array<Record<string, unknown>>;
        requests: Array<Record<string, unknown>>;
    }>;
    listCrons(orgId: string, projectId: string | undefined, environment: string | undefined): Promise<Array<Record<string, unknown>>>;
    getCronHistory(orgId: string, slug: string, projectId: string | undefined, environment: string | undefined, limit: number, offset: number): Promise<Array<Record<string, unknown>>>;
    createDashboard(input: {
        orgId: string;
        projectId: string | null;
        name: string;
        description: string | null;
        layout: Record<string, unknown>;
        widgets: unknown[];
        isShared: boolean;
        createdBy: string;
    }): Promise<Record<string, unknown>>;
    listDashboards(orgId: string, limit?: number): Promise<Array<Record<string, unknown>>>;
    getDashboard(orgId: string, id: string): Promise<Record<string, unknown> | null>;
    updateDashboard(orgId: string, id: string, fields: Record<string, unknown>, updatedBy: string): Promise<Record<string, unknown> | null>;
    deleteDashboard(orgId: string, id: string): Promise<boolean>;
    createSavedQuery(input: {
        orgId: string;
        projectId: string | null;
        name: string;
        description: string | null;
        queryType: string;
        queryConfig: Record<string, unknown>;
        visualizationType: string | null;
        visualizationConfig: Record<string, unknown>;
        createdBy: string;
    }): Promise<Record<string, unknown>>;
    listSavedQueries(orgId: string, limit?: number): Promise<Array<Record<string, unknown>>>;
    getSavedQuery(orgId: string, id: string): Promise<Record<string, unknown> | null>;
    deleteSavedQuery(orgId: string, id: string): Promise<boolean>;
    createAlert(input: {
        orgId: string;
        projectId: string | null;
        name: string;
        metric: string;
        operator: string;
        threshold: number;
        windowMinutes: number;
        notificationChannels: string[];
        isActive: boolean;
        createdBy: string;
    }): Promise<Record<string, unknown>>;
    listAlerts(orgId: string, limit?: number): Promise<Array<Record<string, unknown>>>;
    getAlert(orgId: string, id: string): Promise<Record<string, unknown> | null>;
    deleteAlert(orgId: string, id: string): Promise<boolean>;
    exportDataset(orgId: string, dataset: 'errors' | 'requests' | 'logs' | 'metrics', range: TimeRange, projectId: string | undefined, environment: string | undefined, limit: number): Promise<Array<Record<string, unknown>>>;
    refreshHourlyRollup(orgId: string, startHour: Date, endHour: Date): Promise<void>;
    listOrgsWithRecentErrors(sinceHours: number): Promise<string[]>;
    /**
     * Reconcile error groups from recent error events (single statement).
     *
     * The ingestion worker's inline grouper owns occurrence counts in real time
     * (analytics_error_groups.total_count etc. are incremented per inserted
     * event). This periodic job must NOT add to counts — re-adding a trailing
     * window's COUNT(*) double-counts on every overlapping run (it did even
     * before inline grouping existed). It now only:
     *   - INSERTs groups the inline path missed (e.g. grouping failed while the
     *     event insert succeeded), with the window count as the initial total;
     *   - refreshes descriptive fields and last_seen_at for existing groups.
     */
    refreshErrorGroups(orgId: string, sinceHours: number): Promise<void>;
    ping(): Promise<boolean>;
}
//# sourceMappingURL=repository.d.ts.map