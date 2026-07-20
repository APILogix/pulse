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
export declare class EventAnalyticsRepository {
    private readonly db;
    constructor(db: Pool);
    private withTransaction;
    getErrorStats(orgId: string, projectId: string | undefined, range: TimeRange): Promise<{
        total: number;
        fatal: number;
        error: number;
        warning: number;
    }>;
    getRequestStats(orgId: string, projectId: string | undefined, range: TimeRange): Promise<{
        total: number;
        errors: number;
        errorRate: number;
        avgLatencyMs: number | null;
        p95: number | null;
        p99: number | null;
    }>;
    getUniqueUserCount(orgId: string, projectId: string | undefined, range: TimeRange): Promise<number>;
    getEventTrend(tableKey: AnalyticsTableKey, orgId: string, projectId: string | undefined, range: TimeRange, bucket: TimeBucket, extraSelects?: string): Promise<Array<Record<string, unknown>>>;
    listErrors(orgId: string, range: TimeRange, filters: {
        projectId?: string;
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
    getErrorById(orgId: string, id: string): Promise<Record<string, unknown> | null>;
    listErrorGroups(orgId: string, filters: {
        projectId?: string;
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
    getErrorGroup(orgId: string, fingerprint: string): Promise<Record<string, unknown> | null>;
    updateErrorGroupStatus(orgId: string, fingerprint: string, status: string, assignedTo: string | null): Promise<Record<string, unknown> | null>;
    /** Route performance from the pre-aggregated summary; falls back to live compute. */
    getRoutePerformance(orgId: string, projectId: string | undefined, sinceDate: Date, limit: number): Promise<Array<Record<string, unknown>>>;
    getLatencyDistribution(orgId: string, projectId: string | undefined, range: TimeRange): Promise<Array<Record<string, unknown>>>;
    /** Raw counts needed for an Apdex score (T = satisfied threshold ms). */
    getApdexCounts(orgId: string, projectId: string | undefined, range: TimeRange, thresholdMs: number): Promise<{
        satisfied: number;
        tolerating: number;
        total: number;
    }>;
    listRequests(orgId: string, range: TimeRange, filters: {
        projectId?: string;
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
    getRequestById(orgId: string, id: string): Promise<Record<string, unknown> | null>;
    getSpansByTrace(orgId: string, traceId: string): Promise<Array<Record<string, unknown>>>;
    getTraceById(orgId: string, traceId: string): Promise<Record<string, unknown> | null>;
    listTraces(orgId: string, range: TimeRange, projectId: string | undefined, limit: number, offset: number): Promise<{
        rows: Array<Record<string, unknown>>;
        total: number;
    }>;
    listMetricNames(orgId: string, projectId: string | undefined, range: TimeRange): Promise<Array<Record<string, unknown>>>;
    getMetricSeries(orgId: string, name: string, range: TimeRange, bucket: TimeBucket, aggregate: string, projectId: string | undefined): Promise<Array<Record<string, unknown>>>;
    getMetricStats(orgId: string, name: string, range: TimeRange, projectId: string | undefined): Promise<Record<string, unknown> | null>;
    listLogs(orgId: string, range: TimeRange, filters: {
        projectId?: string;
        level?: string;
        search?: string;
        limit: number;
        offset: number;
    }): Promise<{
        rows: Array<Record<string, unknown>>;
        total: number;
    }>;
    /** Logs newer than a cursor timestamp — used by the SSE poll loop. */
    listLogsSince(orgId: string, since: Date, projectId: string | undefined, limit: number): Promise<Array<Record<string, unknown>>>;
    listErrorsSince(orgId: string, since: Date, projectId: string | undefined, limit: number): Promise<Array<Record<string, unknown>>>;
    listSessions(orgId: string, range: TimeRange, filters: {
        projectId?: string;
        userId?: string;
        crashedOnly?: boolean;
        limit: number;
        offset: number;
    }): Promise<{
        rows: Array<Record<string, unknown>>;
        total: number;
    }>;
    getSession(orgId: string, sessionId: string): Promise<Record<string, unknown> | null>;
    listUsers(orgId: string, range: TimeRange, projectId: string | undefined, limit: number, offset: number): Promise<Array<Record<string, unknown>>>;
    getUserJourney(orgId: string, userId: string, range: TimeRange, limit: number): Promise<{
        errors: Array<Record<string, unknown>>;
        requests: Array<Record<string, unknown>>;
    }>;
    listCrons(orgId: string, projectId: string | undefined): Promise<Array<Record<string, unknown>>>;
    getCronHistory(orgId: string, slug: string, limit: number, offset: number): Promise<Array<Record<string, unknown>>>;
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
    listDashboards(orgId: string): Promise<Array<Record<string, unknown>>>;
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
    listSavedQueries(orgId: string): Promise<Array<Record<string, unknown>>>;
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
    listAlerts(orgId: string): Promise<Array<Record<string, unknown>>>;
    getAlert(orgId: string, id: string): Promise<Record<string, unknown> | null>;
    deleteAlert(orgId: string, id: string): Promise<boolean>;
    exportDataset(orgId: string, dataset: 'errors' | 'requests' | 'logs' | 'metrics', range: TimeRange, projectId: string | undefined, limit: number): Promise<Array<Record<string, unknown>>>;
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