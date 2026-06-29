import { logAudit } from '../../shared/middleware/audit-logger.js';
import { EventAnalyticsRepository } from './repository.js';
import { buildWaterfallTree, computeApdex } from './waterfall.js';
import { AnalyticsNotFoundError, resolveTimeRange, } from './types.js';
const APDEX_THRESHOLD_MS = 500;
export class EventAnalyticsService {
    repo;
    logger;
    constructor(repo, logger) {
        this.repo = repo;
        this.logger = logger;
    }
    // ── Overview / trends / health ─────────────────────────────────────────
    async getOverview(orgId, q) {
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
    async getTrends(orgId, q) {
        const range = resolveTimeRange(q);
        const bucket = q.granularity;
        const [errorSeries, requestSeries] = await Promise.all([
            this.repo.getEventTrend('errors', orgId, q.projectId, range, bucket, `COUNT(*) FILTER (WHERE severity='fatal')::bigint AS fatal, COUNT(*) FILTER (WHERE severity='error')::bigint AS error`),
            this.repo.getEventTrend('requests', orgId, q.projectId, range, bucket, `COUNT(*) FILTER (WHERE status_code >= 500)::bigint AS errors, AVG(latency_ms)::int AS avg_latency`),
        ]);
        return { errors: errorSeries, requests: requestSeries, granularity: bucket };
    }
    async getHealth(orgId, q) {
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
    async listErrors(orgId, q) {
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
    async getError(orgId, id) {
        const row = await this.repo.getErrorById(orgId, id);
        if (!row)
            throw new AnalyticsNotFoundError('Error event');
        return row;
    }
    async listErrorGroups(orgId, q) {
        const { rows, total } = await this.repo.listErrorGroups(orgId, {
            ...(q.projectId !== undefined ? { projectId: q.projectId } : {}),
            ...(q.status !== undefined ? { status: q.status } : {}),
            ...(q.search !== undefined ? { search: q.search } : {}),
            sortBy: q.sortBy, sortOrder: q.sortOrder, limit: q.limit, offset: q.offset,
        });
        return { data: rows, meta: { total, limit: q.limit, offset: q.offset } };
    }
    async getErrorGroup(orgId, fingerprint) {
        const group = await this.repo.getErrorGroup(orgId, fingerprint);
        if (!group)
            throw new AnalyticsNotFoundError('Error group');
        return group;
    }
    async setErrorGroupStatus(orgId, meta, fingerprint, status, assignedTo) {
        const updated = await this.repo.updateErrorGroupStatus(orgId, fingerprint, status, assignedTo);
        if (!updated)
            throw new AnalyticsNotFoundError('Error group');
        this.audit(orgId, meta, `analytics.error_group.${status}`, 'analytics_error_group', fingerprint);
        return updated;
    }
    async getErrorTrends(orgId, q) {
        const range = resolveTimeRange(q);
        return this.repo.getEventTrend('errors', orgId, q.projectId, range, q.granularity, `COUNT(*) FILTER (WHERE severity='fatal')::bigint AS fatal`);
    }
    // ── Performance ──────────────────────────────────────────────────────────
    async getRoutePerformance(orgId, q) {
        const since = new Date(Date.now() - q.days * 24 * 60 * 60 * 1000);
        return this.repo.getRoutePerformance(orgId, q.projectId, since, q.limit);
    }
    async getLatencyDistribution(orgId, q) {
        return this.repo.getLatencyDistribution(orgId, q.projectId, resolveTimeRange(q));
    }
    async getApdex(orgId, q) {
        const range = resolveTimeRange(q);
        const counts = await this.repo.getApdexCounts(orgId, q.projectId, range, APDEX_THRESHOLD_MS);
        return { apdex: computeApdex(counts.satisfied, counts.tolerating, counts.total), thresholdMs: APDEX_THRESHOLD_MS, ...counts };
    }
    // ── Requests / traces ──────────────────────────────────────────────────
    async listRequests(orgId, q) {
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
    async getRequest(orgId, id) {
        const row = await this.repo.getRequestById(orgId, id);
        if (!row)
            throw new AnalyticsNotFoundError('Request event');
        return row;
    }
    async getTraceWaterfall(orgId, traceId) {
        const [trace, spans] = await Promise.all([
            this.repo.getTraceById(orgId, traceId),
            this.repo.getSpansByTrace(orgId, traceId),
        ]);
        if (!trace && spans.length === 0)
            throw new AnalyticsNotFoundError('Trace');
        const waterfall = buildWaterfallTree(spans);
        return { trace, spans: waterfall, totalSpans: spans.length };
    }
    async listTraces(orgId, q) {
        const range = resolveTimeRange(q);
        const { rows, total } = await this.repo.listTraces(orgId, range, q.projectId, q.limit, q.offset);
        return { data: rows, meta: { total, limit: q.limit, offset: q.offset } };
    }
    async getTrace(orgId, traceId) {
        return this.getTraceWaterfall(orgId, traceId);
    }
    // ── Metrics ─────────────────────────────────────────────────────────────
    async listMetricNames(orgId, q) {
        return this.repo.listMetricNames(orgId, q.projectId, resolveTimeRange(q));
    }
    async getMetricSeries(orgId, name, q) {
        return this.repo.getMetricSeries(orgId, name, resolveTimeRange(q), q.granularity, q.aggregate, q.projectId);
    }
    async getMetricStats(orgId, name, q) {
        const stats = await this.repo.getMetricStats(orgId, name, resolveTimeRange(q), q.projectId);
        if (!stats)
            throw new AnalyticsNotFoundError('Metric');
        return stats;
    }
    // ── Logs ─────────────────────────────────────────────────────────────────
    async listLogs(orgId, q) {
        const range = resolveTimeRange(q);
        const { rows, total } = await this.repo.listLogs(orgId, range, {
            ...(q.projectId !== undefined ? { projectId: q.projectId } : {}),
            ...(q.level !== undefined ? { level: q.level } : {}),
            ...(q.search !== undefined ? { search: q.search } : {}),
            limit: q.limit, offset: q.offset,
        });
        return { data: rows, meta: { total, limit: q.limit, offset: q.offset } };
    }
    async pollLogsSince(orgId, since, projectId) {
        return this.repo.listLogsSince(orgId, since, projectId, 100);
    }
    async pollErrorsSince(orgId, since, projectId) {
        return this.repo.listErrorsSince(orgId, since, projectId, 100);
    }
    // ── Sessions / users ───────────────────────────────────────────────────
    async listSessions(orgId, q) {
        const range = resolveTimeRange(q);
        const { rows, total } = await this.repo.listSessions(orgId, range, {
            ...(q.projectId !== undefined ? { projectId: q.projectId } : {}),
            ...(q.userId !== undefined ? { userId: q.userId } : {}),
            ...(q.crashedOnly !== undefined ? { crashedOnly: q.crashedOnly } : {}),
            limit: q.limit, offset: q.offset,
        });
        return { data: rows, meta: { total, limit: q.limit, offset: q.offset } };
    }
    async getSession(orgId, sessionId) {
        const row = await this.repo.getSession(orgId, sessionId);
        if (!row)
            throw new AnalyticsNotFoundError('Session');
        return row;
    }
    async listUsers(orgId, q) {
        return this.repo.listUsers(orgId, resolveTimeRange(q), q.projectId, q.limit, q.offset);
    }
    async getUserJourney(orgId, userId, q) {
        const range = resolveTimeRange(q);
        return this.repo.getUserJourney(orgId, userId, range, 200);
    }
    // ── Crons ────────────────────────────────────────────────────────────────
    async listCrons(orgId, projectId) {
        return this.repo.listCrons(orgId, projectId);
    }
    async getCronHistory(orgId, slug, limit, offset) {
        return this.repo.getCronHistory(orgId, slug, limit, offset);
    }
    // ── Dashboards ──────────────────────────────────────────────────────────
    async createDashboard(orgId, meta, body) {
        const row = await this.repo.createDashboard({
            orgId, projectId: body.projectId ?? null, name: body.name, description: body.description ?? null,
            layout: body.layout, widgets: body.widgets, isShared: body.isShared, createdBy: meta.actorUserId,
        });
        this.audit(orgId, meta, 'analytics.dashboard.created', 'analytics_dashboard', String(row.id));
        return row;
    }
    async listDashboards(orgId) { return this.repo.listDashboards(orgId); }
    async getDashboard(orgId, id) {
        const row = await this.repo.getDashboard(orgId, id);
        if (!row)
            throw new AnalyticsNotFoundError('Dashboard');
        return row;
    }
    async updateDashboard(orgId, meta, id, body) {
        const row = await this.repo.updateDashboard(orgId, id, body, meta.actorUserId);
        if (!row)
            throw new AnalyticsNotFoundError('Dashboard');
        this.audit(orgId, meta, 'analytics.dashboard.updated', 'analytics_dashboard', id);
        return row;
    }
    async deleteDashboard(orgId, meta, id) {
        const ok = await this.repo.deleteDashboard(orgId, id);
        if (!ok)
            throw new AnalyticsNotFoundError('Dashboard');
        this.audit(orgId, meta, 'analytics.dashboard.deleted', 'analytics_dashboard', id);
    }
    async duplicateDashboard(orgId, meta, id) {
        const src = await this.repo.getDashboard(orgId, id);
        if (!src)
            throw new AnalyticsNotFoundError('Dashboard');
        const row = await this.repo.createDashboard({
            orgId,
            projectId: src.project_id ?? null,
            name: `${String(src.name)} (copy)`,
            description: src.description ?? null,
            layout: src.layout ?? {},
            widgets: src.widgets ?? [],
            isShared: false,
            createdBy: meta.actorUserId,
        });
        this.audit(orgId, meta, 'analytics.dashboard.duplicated', 'analytics_dashboard', String(row.id));
        return row;
    }
    // ── Saved queries ──────────────────────────────────────────────────────
    async createSavedQuery(orgId, meta, body) {
        const row = await this.repo.createSavedQuery({
            orgId, projectId: body.projectId ?? null, name: body.name, description: body.description ?? null,
            queryType: body.queryType, queryConfig: body.queryConfig,
            visualizationType: body.visualizationType ?? null, visualizationConfig: body.visualizationConfig, createdBy: meta.actorUserId,
        });
        this.audit(orgId, meta, 'analytics.saved_query.created', 'analytics_saved_query', String(row.id));
        return row;
    }
    async listSavedQueries(orgId) { return this.repo.listSavedQueries(orgId); }
    async deleteSavedQuery(orgId, meta, id) {
        const ok = await this.repo.deleteSavedQuery(orgId, id);
        if (!ok)
            throw new AnalyticsNotFoundError('Saved query');
        this.audit(orgId, meta, 'analytics.saved_query.deleted', 'analytics_saved_query', id);
    }
    /**
     * Execute a saved query. Only the safe "builder" type is supported here —
     * arbitrary raw SQL execution is intentionally NOT implemented (injection /
     * blast-radius risk). A builder config maps to the typed read methods.
     */
    async executeSavedQuery(orgId, id) {
        const sq = await this.repo.getSavedQuery(orgId, id);
        if (!sq)
            throw new AnalyticsNotFoundError('Saved query');
        if (sq.query_type !== 'builder') {
            return { unsupported: true, message: 'Only builder queries can be executed via this endpoint', queryType: sq.query_type };
        }
        const cfg = sq.query_config ?? {};
        const dataset = String(cfg.dataset ?? 'errors');
        const range = resolveTimeRange({ range: '24h' });
        if (dataset === 'requests')
            return this.repo.listRequests(orgId, range, { limit: 100, offset: 0 });
        return this.repo.listErrors(orgId, range, { limit: 100, offset: 0 });
    }
    // ── Analytics alerts ──────────────────────────────────────────────────────
    async createAlert(orgId, meta, body) {
        const row = await this.repo.createAlert({
            orgId, projectId: body.projectId ?? null, name: body.name, metric: body.metric, operator: body.operator,
            threshold: body.threshold, windowMinutes: body.windowMinutes, notificationChannels: body.notificationChannels,
            isActive: body.isActive, createdBy: meta.actorUserId,
        });
        this.audit(orgId, meta, 'analytics.alert.created', 'analytics_alert', String(row.id));
        return row;
    }
    async listAlerts(orgId) { return this.repo.listAlerts(orgId); }
    async deleteAlert(orgId, meta, id) {
        const ok = await this.repo.deleteAlert(orgId, id);
        if (!ok)
            throw new AnalyticsNotFoundError('Analytics alert');
        this.audit(orgId, meta, 'analytics.alert.deleted', 'analytics_alert', id);
    }
    // ── Export ─────────────────────────────────────────────────────────────
    async exportData(orgId, body) {
        const range = resolveTimeRange({ range: body.range });
        const rows = await this.repo.exportDataset(orgId, body.dataset, range, body.projectId, body.limit);
        return { rows, format: body.format };
    }
    // ── Internals ──────────────────────────────────────────────────────────
    audit(orgId, meta, action, resourceType, resourceId) {
        logAudit({
            user_id: meta.actorUserId, org_id: orgId, action, resource_type: resourceType, resource_id: resourceId,
            ip_address: meta.actorIp, ...(meta.actorUserAgent ? { user_agent: meta.actorUserAgent } : {}), request_id: meta.requestId,
        });
    }
}
//# sourceMappingURL=service.js.map