/**
 * Event-analytics business service.
 *
 * Orchestrates repository reads, resolves time ranges, runs independent
 * queries concurrently (Promise.all — no N+1), and shapes responses. No
 * caching (per requirements); tenant isolation is enforced by passing orgId
 * into every repository call.
 */
import type { FastifyBaseLogger } from 'fastify';
import { logAudit } from '../../shared/middleware/audit-logger.js';
import { EventAnalyticsRepository } from './repository.js';
import { buildWaterfallTree, computeApdex, type FlatSpan } from './waterfall.js';
import {
  AnalyticsNotFoundError,
  resolveTimeRange,
  type CreateAnalyticsAlertBody,
  type CreateDashboardBody,
  type CreateSavedQueryBody,
  type ExportBody,
  type Granularity,
  type ListErrorGroupsQuery,
  type ListErrorsQuery,
  type ListLogsQuery,
  type ListRequestsQuery,
  type ListSessionsQuery,
  type ListTracesQuery,
  type MetricSeriesQuery,
  type RequestMeta,
  type RoutePerfQuery,
  type TimeRangeQuery,
  type TrendsQuery,
  type UpdateDashboardBody,
} from './types.js';

const APDEX_THRESHOLD_MS = 500;

export class EventAnalyticsService {
  constructor(
    private readonly repo: EventAnalyticsRepository,
    private readonly logger: FastifyBaseLogger,
  ) {}

  // ── Overview / trends / health ─────────────────────────────────────────
  async getOverview(orgId: string, q: TimeRangeQuery): Promise<Record<string, unknown>> {
    const range = resolveTimeRange(q);
    const [errors, requests, uniqueUsers] = await Promise.all([
      this.repo.getErrorStats(orgId, q.projectId, range),
      this.repo.getRequestStats(orgId, q.projectId, range),
      this.repo.getUniqueUserCount(orgId, q.projectId, range),
    ]);
    return {
      errors,
      requests,
      users: { unique: uniqueUsers },
      range: { from: range.from.toISOString(), to: range.to.toISOString() },
      generatedAt: new Date().toISOString(),
    };
  }

  async getTrends(orgId: string, q: TrendsQuery): Promise<Record<string, unknown>> {
    const range = resolveTimeRange(q);
    const bucket = q.granularity;
    const [errorSeries, requestSeries] = await Promise.all([
      this.repo.getEventTrend('errors', orgId, q.projectId, range, bucket,
        `COUNT(*) FILTER (WHERE severity='fatal')::bigint AS fatal, COUNT(*) FILTER (WHERE severity='error')::bigint AS error`),
      this.repo.getEventTrend('requests', orgId, q.projectId, range, bucket,
        `COUNT(*) FILTER (WHERE status_code >= 500)::bigint AS errors, AVG(latency_ms)::int AS avg_latency`),
    ]);
    return { errors: errorSeries, requests: requestSeries, granularity: bucket };
  }

  async getHealth(orgId: string, q: TimeRangeQuery): Promise<Record<string, unknown>> {
    const range = resolveTimeRange(q);
    const [dbOk, requests] = await Promise.all([
      this.repo.ping(),
      this.repo.getRequestStats(orgId, q.projectId, range),
    ]);
    // Simple health score: 100 minus error-rate penalty.
    const score = Math.max(0, Math.round(100 - requests.errorRate * 100));
    return {
      status: dbOk && score >= 80 ? 'healthy' : dbOk ? 'degraded' : 'unhealthy',
      score,
      database: dbOk ? 'connected' : 'disconnected',
      errorRate: requests.errorRate,
      checkedAt: new Date().toISOString(),
    };
  }

  // ── Errors ─────────────────────────────────────────────────────────────
  async listErrors(orgId: string, q: ListErrorsQuery): Promise<Record<string, unknown>> {
    const range = resolveTimeRange(q);
    const start = Date.now();
    const { rows, total } = await this.repo.listErrors(orgId, range, {
      ...(q.projectId !== undefined ? { projectId: q.projectId } : {}),
      ...(q.severity !== undefined ? { severity: q.severity } : {}),
      ...(q.service !== undefined ? { service: q.service } : {}),
      ...(q.release !== undefined ? { release: q.release } : {}),
      ...(q.search !== undefined ? { search: q.search } : {}),
      ...(q.fingerprint !== undefined ? { fingerprint: q.fingerprint } : {}),
      limit: q.limit, offset: q.offset,
    });
    return { data: rows, meta: { total, limit: q.limit, offset: q.offset, queryTimeMs: Date.now() - start } };
  }

  async getError(orgId: string, id: string): Promise<Record<string, unknown>> {
    const row = await this.repo.getErrorById(orgId, id);
    if (!row) throw new AnalyticsNotFoundError('Error event');
    return row;
  }

  async listErrorGroups(orgId: string, q: ListErrorGroupsQuery): Promise<Record<string, unknown>> {
    const { rows, total } = await this.repo.listErrorGroups(orgId, {
      ...(q.projectId !== undefined ? { projectId: q.projectId } : {}),
      ...(q.status !== undefined ? { status: q.status } : {}),
      ...(q.search !== undefined ? { search: q.search } : {}),
      sortBy: q.sortBy, sortOrder: q.sortOrder, limit: q.limit, offset: q.offset,
    });
    return { data: rows, meta: { total, limit: q.limit, offset: q.offset } };
  }

  async getErrorGroup(orgId: string, fingerprint: string): Promise<Record<string, unknown>> {
    const group = await this.repo.getErrorGroup(orgId, fingerprint);
    if (!group) throw new AnalyticsNotFoundError('Error group');
    return group;
  }

  async setErrorGroupStatus(orgId: string, meta: RequestMeta, fingerprint: string, status: 'resolved' | 'ignored' | 'unresolved' | 'muted', assignedTo: string | null): Promise<Record<string, unknown>> {
    const updated = await this.repo.updateErrorGroupStatus(orgId, fingerprint, status, assignedTo);
    if (!updated) throw new AnalyticsNotFoundError('Error group');
    this.audit(orgId, meta, `analytics.error_group.${status}`, 'analytics_error_group', fingerprint);
    return updated;
  }

  async getErrorTrends(orgId: string, q: TrendsQuery): Promise<Array<Record<string, unknown>>> {
    const range = resolveTimeRange(q);
    return this.repo.getEventTrend('errors', orgId, q.projectId, range, q.granularity,
      `COUNT(*) FILTER (WHERE severity='fatal')::bigint AS fatal`);
  }

  // ── Performance ──────────────────────────────────────────────────────────
  async getRoutePerformance(orgId: string, q: RoutePerfQuery): Promise<Array<Record<string, unknown>>> {
    const since = new Date(Date.now() - q.days * 24 * 60 * 60 * 1000);
    return this.repo.getRoutePerformance(orgId, q.projectId, since, q.limit);
  }

  async getLatencyDistribution(orgId: string, q: TimeRangeQuery): Promise<Array<Record<string, unknown>>> {
    return this.repo.getLatencyDistribution(orgId, q.projectId, resolveTimeRange(q));
  }

  async getApdex(orgId: string, q: TimeRangeQuery): Promise<Record<string, unknown>> {
    const range = resolveTimeRange(q);
    const counts = await this.repo.getApdexCounts(orgId, q.projectId, range, APDEX_THRESHOLD_MS);
    return { apdex: computeApdex(counts.satisfied, counts.tolerating, counts.total), thresholdMs: APDEX_THRESHOLD_MS, ...counts };
  }

  // ── Requests / traces ──────────────────────────────────────────────────
  async listRequests(orgId: string, q: ListRequestsQuery): Promise<Record<string, unknown>> {
    const range = resolveTimeRange(q);
    const { rows, total } = await this.repo.listRequests(orgId, range, {
      ...(q.projectId !== undefined ? { projectId: q.projectId } : {}),
      ...(q.method !== undefined ? { method: q.method } : {}),
      ...(q.statusCode !== undefined ? { statusCode: q.statusCode } : {}),
      ...(q.route !== undefined ? { route: q.route } : {}),
      ...(q.slowOnly !== undefined ? { slowOnly: q.slowOnly } : {}),
      ...(q.errorOnly !== undefined ? { errorOnly: q.errorOnly } : {}),
      limit: q.limit, offset: q.offset,
    });
    return { data: rows, meta: { total, limit: q.limit, offset: q.offset } };
  }

  async getRequest(orgId: string, id: string): Promise<Record<string, unknown>> {
    const row = await this.repo.getRequestById(orgId, id);
    if (!row) throw new AnalyticsNotFoundError('Request event');
    return row;
  }

  async getTraceWaterfall(orgId: string, traceId: string): Promise<Record<string, unknown>> {
    const [trace, spans] = await Promise.all([
      this.repo.getTraceById(orgId, traceId),
      this.repo.getSpansByTrace(orgId, traceId),
    ]);
    if (!trace && spans.length === 0) throw new AnalyticsNotFoundError('Trace');
    const waterfall = buildWaterfallTree(spans as unknown as FlatSpan[]);
    return { trace, spans: waterfall, totalSpans: spans.length };
  }

  async listTraces(orgId: string, q: ListTracesQuery): Promise<Record<string, unknown>> {
    const range = resolveTimeRange(q);
    const { rows, total } = await this.repo.listTraces(orgId, range, q.projectId, q.limit, q.offset);
    return { data: rows, meta: { total, limit: q.limit, offset: q.offset } };
  }

  async getTrace(orgId: string, traceId: string): Promise<Record<string, unknown>> {
    return this.getTraceWaterfall(orgId, traceId);
  }

  // ── Metrics ─────────────────────────────────────────────────────────────
  async listMetricNames(orgId: string, q: TimeRangeQuery): Promise<Array<Record<string, unknown>>> {
    return this.repo.listMetricNames(orgId, q.projectId, resolveTimeRange(q));
  }

  async getMetricSeries(orgId: string, name: string, q: MetricSeriesQuery): Promise<Array<Record<string, unknown>>> {
    return this.repo.getMetricSeries(orgId, name, resolveTimeRange(q), q.granularity, q.aggregate, q.projectId);
  }

  async getMetricStats(orgId: string, name: string, q: TimeRangeQuery): Promise<Record<string, unknown>> {
    const stats = await this.repo.getMetricStats(orgId, name, resolveTimeRange(q), q.projectId);
    if (!stats) throw new AnalyticsNotFoundError('Metric');
    return stats;
  }

  // ── Logs ─────────────────────────────────────────────────────────────────
  async listLogs(orgId: string, q: ListLogsQuery): Promise<Record<string, unknown>> {
    const range = resolveTimeRange(q);
    const { rows, total } = await this.repo.listLogs(orgId, range, {
      ...(q.projectId !== undefined ? { projectId: q.projectId } : {}),
      ...(q.level !== undefined ? { level: q.level } : {}),
      ...(q.search !== undefined ? { search: q.search } : {}),
      limit: q.limit, offset: q.offset,
    });
    return { data: rows, meta: { total, limit: q.limit, offset: q.offset } };
  }

  async pollLogsSince(orgId: string, since: Date, projectId: string | undefined): Promise<Array<Record<string, unknown>>> {
    return this.repo.listLogsSince(orgId, since, projectId, 100);
  }

  async pollErrorsSince(orgId: string, since: Date, projectId: string | undefined): Promise<Array<Record<string, unknown>>> {
    return this.repo.listErrorsSince(orgId, since, projectId, 100);
  }

  // ── Sessions / users ───────────────────────────────────────────────────
  async listSessions(orgId: string, q: ListSessionsQuery): Promise<Record<string, unknown>> {
    const range = resolveTimeRange(q);
    const { rows, total } = await this.repo.listSessions(orgId, range, {
      ...(q.projectId !== undefined ? { projectId: q.projectId } : {}),
      ...(q.userId !== undefined ? { userId: q.userId } : {}),
      ...(q.crashedOnly !== undefined ? { crashedOnly: q.crashedOnly } : {}),
      limit: q.limit, offset: q.offset,
    });
    return { data: rows, meta: { total, limit: q.limit, offset: q.offset } };
  }

  async getSession(orgId: string, sessionId: string): Promise<Record<string, unknown>> {
    const row = await this.repo.getSession(orgId, sessionId);
    if (!row) throw new AnalyticsNotFoundError('Session');
    return row;
  }

  async listUsers(orgId: string, q: TimeRangeQuery & { limit: number; offset: number }): Promise<Array<Record<string, unknown>>> {
    return this.repo.listUsers(orgId, resolveTimeRange(q), q.projectId, q.limit, q.offset);
  }

  async getUserJourney(orgId: string, userId: string, q: TimeRangeQuery): Promise<Record<string, unknown>> {
    const range = resolveTimeRange(q);
    return this.repo.getUserJourney(orgId, userId, range, 200);
  }

  // ── Crons ────────────────────────────────────────────────────────────────
  async listCrons(orgId: string, projectId: string | undefined): Promise<Array<Record<string, unknown>>> {
    return this.repo.listCrons(orgId, projectId);
  }

  async getCronHistory(orgId: string, slug: string, limit: number, offset: number): Promise<Array<Record<string, unknown>>> {
    return this.repo.getCronHistory(orgId, slug, limit, offset);
  }

  // ── Dashboards ──────────────────────────────────────────────────────────
  async createDashboard(orgId: string, meta: RequestMeta, body: CreateDashboardBody): Promise<Record<string, unknown>> {
    const row = await this.repo.createDashboard({
      orgId, projectId: body.projectId ?? null, name: body.name, description: body.description ?? null,
      layout: body.layout, widgets: body.widgets, isShared: body.isShared, createdBy: meta.actorUserId,
    });
    this.audit(orgId, meta, 'analytics.dashboard.created', 'analytics_dashboard', String(row.id));
    return row;
  }

  async listDashboards(orgId: string): Promise<Array<Record<string, unknown>>> { return this.repo.listDashboards(orgId); }

  async getDashboard(orgId: string, id: string): Promise<Record<string, unknown>> {
    const row = await this.repo.getDashboard(orgId, id);
    if (!row) throw new AnalyticsNotFoundError('Dashboard');
    return row;
  }

  async updateDashboard(orgId: string, meta: RequestMeta, id: string, body: UpdateDashboardBody): Promise<Record<string, unknown>> {
    const row = await this.repo.updateDashboard(orgId, id, body as Record<string, unknown>, meta.actorUserId);
    if (!row) throw new AnalyticsNotFoundError('Dashboard');
    this.audit(orgId, meta, 'analytics.dashboard.updated', 'analytics_dashboard', id);
    return row;
  }

  async deleteDashboard(orgId: string, meta: RequestMeta, id: string): Promise<void> {
    const ok = await this.repo.deleteDashboard(orgId, id);
    if (!ok) throw new AnalyticsNotFoundError('Dashboard');
    this.audit(orgId, meta, 'analytics.dashboard.deleted', 'analytics_dashboard', id);
  }

  async duplicateDashboard(orgId: string, meta: RequestMeta, id: string): Promise<Record<string, unknown>> {
    const src = await this.repo.getDashboard(orgId, id);
    if (!src) throw new AnalyticsNotFoundError('Dashboard');
    const row = await this.repo.createDashboard({
      orgId,
      projectId: (src.project_id as string | null) ?? null,
      name: `${String(src.name)} (copy)`,
      description: (src.description as string | null) ?? null,
      layout: (src.layout as Record<string, unknown>) ?? {},
      widgets: (src.widgets as unknown[]) ?? [],
      isShared: false,
      createdBy: meta.actorUserId,
    });
    this.audit(orgId, meta, 'analytics.dashboard.duplicated', 'analytics_dashboard', String(row.id));
    return row;
  }

  // ── Saved queries ──────────────────────────────────────────────────────
  async createSavedQuery(orgId: string, meta: RequestMeta, body: CreateSavedQueryBody): Promise<Record<string, unknown>> {
    const row = await this.repo.createSavedQuery({
      orgId, projectId: body.projectId ?? null, name: body.name, description: body.description ?? null,
      queryType: body.queryType, queryConfig: body.queryConfig,
      visualizationType: body.visualizationType ?? null, visualizationConfig: body.visualizationConfig, createdBy: meta.actorUserId,
    });
    this.audit(orgId, meta, 'analytics.saved_query.created', 'analytics_saved_query', String(row.id));
    return row;
  }

  async listSavedQueries(orgId: string): Promise<Array<Record<string, unknown>>> { return this.repo.listSavedQueries(orgId); }

  async deleteSavedQuery(orgId: string, meta: RequestMeta, id: string): Promise<void> {
    const ok = await this.repo.deleteSavedQuery(orgId, id);
    if (!ok) throw new AnalyticsNotFoundError('Saved query');
    this.audit(orgId, meta, 'analytics.saved_query.deleted', 'analytics_saved_query', id);
  }

  /**
   * Execute a saved query. Only the safe "builder" type is supported here —
   * arbitrary raw SQL execution is intentionally NOT implemented (injection /
   * blast-radius risk). A builder config maps to the typed read methods.
   */
  async executeSavedQuery(orgId: string, id: string): Promise<Record<string, unknown>> {
    const sq = await this.repo.getSavedQuery(orgId, id);
    if (!sq) throw new AnalyticsNotFoundError('Saved query');
    if (sq.query_type !== 'builder') {
      return { unsupported: true, message: 'Only builder queries can be executed via this endpoint', queryType: sq.query_type };
    }
    const cfg = (sq.query_config as Record<string, unknown>) ?? {};
    const dataset = String(cfg.dataset ?? 'errors');
    const range = resolveTimeRange({ range: '24h' });
    if (dataset === 'requests') return this.repo.listRequests(orgId, range, { limit: 100, offset: 0 });
    return this.repo.listErrors(orgId, range, { limit: 100, offset: 0 });
  }

  // ── Analytics alerts ──────────────────────────────────────────────────────
  async createAlert(orgId: string, meta: RequestMeta, body: CreateAnalyticsAlertBody): Promise<Record<string, unknown>> {
    const row = await this.repo.createAlert({
      orgId, projectId: body.projectId ?? null, name: body.name, metric: body.metric, operator: body.operator,
      threshold: body.threshold, windowMinutes: body.windowMinutes, notificationChannels: body.notificationChannels,
      isActive: body.isActive, createdBy: meta.actorUserId,
    });
    this.audit(orgId, meta, 'analytics.alert.created', 'analytics_alert', String(row.id));
    return row;
  }

  async listAlerts(orgId: string): Promise<Array<Record<string, unknown>>> { return this.repo.listAlerts(orgId); }

  async deleteAlert(orgId: string, meta: RequestMeta, id: string): Promise<void> {
    const ok = await this.repo.deleteAlert(orgId, id);
    if (!ok) throw new AnalyticsNotFoundError('Analytics alert');
    this.audit(orgId, meta, 'analytics.alert.deleted', 'analytics_alert', id);
  }

  // ── Export ─────────────────────────────────────────────────────────────
  async exportData(orgId: string, body: ExportBody): Promise<{ rows: Array<Record<string, unknown>>; format: 'csv' | 'json' }> {
    const range = resolveTimeRange({ range: body.range });
    const rows = await this.repo.exportDataset(orgId, body.dataset, range, body.projectId, body.limit);
    return { rows, format: body.format };
  }

  // ── Internals ──────────────────────────────────────────────────────────
  private audit(orgId: string, meta: RequestMeta, action: string, resourceType: string, resourceId: string): void {
    logAudit({
      user_id: meta.actorUserId, org_id: orgId, action, resource_type: resourceType, resource_id: resourceId,
      ip_address: meta.actorIp, ...(meta.actorUserAgent ? { user_agent: meta.actorUserAgent } : {}), request_id: meta.requestId,
    });
  }
}
