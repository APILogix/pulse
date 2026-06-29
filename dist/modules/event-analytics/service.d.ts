/**
 * Event-analytics business service.
 *
 * Orchestrates repository reads, resolves time ranges, runs independent
 * queries concurrently (Promise.all — no N+1), and shapes responses. No
 * caching (per requirements); tenant isolation is enforced by passing orgId
 * into every repository call.
 */
import type { FastifyBaseLogger } from 'fastify';
import { EventAnalyticsRepository } from './repository.js';
import { type CreateAnalyticsAlertBody, type CreateDashboardBody, type CreateSavedQueryBody, type ExportBody, type ListErrorGroupsQuery, type ListErrorsQuery, type ListLogsQuery, type ListRequestsQuery, type ListSessionsQuery, type ListTracesQuery, type MetricSeriesQuery, type RequestMeta, type RoutePerfQuery, type TimeRangeQuery, type TrendsQuery, type UpdateDashboardBody } from './types.js';
export declare class EventAnalyticsService {
    private readonly repo;
    private readonly logger;
    constructor(repo: EventAnalyticsRepository, logger: FastifyBaseLogger);
    getOverview(orgId: string, q: TimeRangeQuery): Promise<Record<string, unknown>>;
    getTrends(orgId: string, q: TrendsQuery): Promise<Record<string, unknown>>;
    getHealth(orgId: string, q: TimeRangeQuery): Promise<Record<string, unknown>>;
    listErrors(orgId: string, q: ListErrorsQuery): Promise<Record<string, unknown>>;
    getError(orgId: string, id: string): Promise<Record<string, unknown>>;
    listErrorGroups(orgId: string, q: ListErrorGroupsQuery): Promise<Record<string, unknown>>;
    getErrorGroup(orgId: string, fingerprint: string): Promise<Record<string, unknown>>;
    setErrorGroupStatus(orgId: string, meta: RequestMeta, fingerprint: string, status: 'resolved' | 'ignored' | 'unresolved' | 'muted', assignedTo: string | null): Promise<Record<string, unknown>>;
    getErrorTrends(orgId: string, q: TrendsQuery): Promise<Array<Record<string, unknown>>>;
    getRoutePerformance(orgId: string, q: RoutePerfQuery): Promise<Array<Record<string, unknown>>>;
    getLatencyDistribution(orgId: string, q: TimeRangeQuery): Promise<Array<Record<string, unknown>>>;
    getApdex(orgId: string, q: TimeRangeQuery): Promise<Record<string, unknown>>;
    listRequests(orgId: string, q: ListRequestsQuery): Promise<Record<string, unknown>>;
    getRequest(orgId: string, id: string): Promise<Record<string, unknown>>;
    getTraceWaterfall(orgId: string, traceId: string): Promise<Record<string, unknown>>;
    listTraces(orgId: string, q: ListTracesQuery): Promise<Record<string, unknown>>;
    getTrace(orgId: string, traceId: string): Promise<Record<string, unknown>>;
    listMetricNames(orgId: string, q: TimeRangeQuery): Promise<Array<Record<string, unknown>>>;
    getMetricSeries(orgId: string, name: string, q: MetricSeriesQuery): Promise<Array<Record<string, unknown>>>;
    getMetricStats(orgId: string, name: string, q: TimeRangeQuery): Promise<Record<string, unknown>>;
    listLogs(orgId: string, q: ListLogsQuery): Promise<Record<string, unknown>>;
    pollLogsSince(orgId: string, since: Date, projectId: string | undefined): Promise<Array<Record<string, unknown>>>;
    pollErrorsSince(orgId: string, since: Date, projectId: string | undefined): Promise<Array<Record<string, unknown>>>;
    listSessions(orgId: string, q: ListSessionsQuery): Promise<Record<string, unknown>>;
    getSession(orgId: string, sessionId: string): Promise<Record<string, unknown>>;
    listUsers(orgId: string, q: TimeRangeQuery & {
        limit: number;
        offset: number;
    }): Promise<Array<Record<string, unknown>>>;
    getUserJourney(orgId: string, userId: string, q: TimeRangeQuery): Promise<Record<string, unknown>>;
    listCrons(orgId: string, projectId: string | undefined): Promise<Array<Record<string, unknown>>>;
    getCronHistory(orgId: string, slug: string, limit: number, offset: number): Promise<Array<Record<string, unknown>>>;
    createDashboard(orgId: string, meta: RequestMeta, body: CreateDashboardBody): Promise<Record<string, unknown>>;
    listDashboards(orgId: string): Promise<Array<Record<string, unknown>>>;
    getDashboard(orgId: string, id: string): Promise<Record<string, unknown>>;
    updateDashboard(orgId: string, meta: RequestMeta, id: string, body: UpdateDashboardBody): Promise<Record<string, unknown>>;
    deleteDashboard(orgId: string, meta: RequestMeta, id: string): Promise<void>;
    duplicateDashboard(orgId: string, meta: RequestMeta, id: string): Promise<Record<string, unknown>>;
    createSavedQuery(orgId: string, meta: RequestMeta, body: CreateSavedQueryBody): Promise<Record<string, unknown>>;
    listSavedQueries(orgId: string): Promise<Array<Record<string, unknown>>>;
    deleteSavedQuery(orgId: string, meta: RequestMeta, id: string): Promise<void>;
    /**
     * Execute a saved query. Only the safe "builder" type is supported here —
     * arbitrary raw SQL execution is intentionally NOT implemented (injection /
     * blast-radius risk). A builder config maps to the typed read methods.
     */
    executeSavedQuery(orgId: string, id: string): Promise<Record<string, unknown>>;
    createAlert(orgId: string, meta: RequestMeta, body: CreateAnalyticsAlertBody): Promise<Record<string, unknown>>;
    listAlerts(orgId: string): Promise<Array<Record<string, unknown>>>;
    deleteAlert(orgId: string, meta: RequestMeta, id: string): Promise<void>;
    exportData(orgId: string, body: ExportBody): Promise<{
        rows: Array<Record<string, unknown>>;
        format: 'csv' | 'json';
    }>;
    private audit;
}
//# sourceMappingURL=service.d.ts.map