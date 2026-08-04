/**
 * /analytics/v2 read API.
 *
 * Contract: docs/analytics/08-dashboard-api-contracts.md
 *
 * Scoping deviates slightly from the document (recorded in DEVIATIONS.md D10):
 * routes are nested under `/org/:orgId` or `/projects/:projectId` so the existing
 * `requireOrgMembership` / `requireProjectMembership` guards apply unchanged,
 * rather than inventing a new org-resolution path.
 *
 * Every handler follows the same shape:
 *   parse scope → read rollups (current + previous window) → format → envelope.
 * No handler aggregates raw telemetry.
 */
import { authenticate } from '../../../shared/middleware/auth.js';
import { requireOrgMembership, requireProjectMembership } from '../../../shared/middleware/tenant.js';
import { env } from '../../../config/env.js';
import { histogramView, percentilesFromHistogram } from '../histogram.js';
import { buildCard, buildFreshness, buildMeta, buildRankedList, buildSeries, buildTable, formatLatency, num, ratePct, sparklineFrom, tableToCsv, } from '../read/formatters.js';
import { AnalyticsQueryError, cacheKeyFor, isCsvRequested, parseScope, } from '../read/query-scope.js';
/** Worker sets whose watermark determines each route's freshness. */
const FRESHNESS_SOURCES = {
    requests: ['analytics.requests'],
    endpoints: ['analytics.endpoints'],
    services: ['analytics.services'],
    errors: ['analytics.errors'],
    logs: ['analytics.logs'],
    traces: ['analytics.traces'],
    overview: ['analytics.requests', 'analytics.errors', 'analytics.services'],
};
function fail(reply, request, error) {
    if (error instanceof AnalyticsQueryError) {
        return reply.status(error.statusCode).send({
            error: {
                code: error.code,
                message: error.message,
                requestId: request.id,
                timestamp: new Date().toISOString(),
                ...(error.details ? { details: error.details } : {}),
            },
        });
    }
    request.log.error({ err: error }, 'Analytics v2 read failed');
    return reply.status(503).send({
        error: {
            code: 'ANALYTICS_UNAVAILABLE',
            message: 'Analytics store is unavailable',
            requestId: request.id,
            timestamp: new Date().toISOString(),
        },
    });
}
export async function analyticsV2Routes(fastify, _options) {
    const { read, cache, watermarks } = fastify.analyticsEngine;
    const staleSeconds = env.ANALYTICS_FRESHNESS_STALE_SECONDS;
    /** Shared response assembly: freshness + envelope + LRU caching. */
    async function respond(request, reply, params) {
        const startedAt = Date.now();
        const key = cacheKeyFor(params.route, params.scope);
        const cached = cache.get(key);
        const data = cached ?? (await params.build());
        if (!cached)
            cache.set(key, data, params.scope.window);
        const watermark = await watermarks
            .freshnessFor(params.workers, params.scope.organizationId)
            .catch(() => null);
        return reply.send({
            meta: buildMeta({
                scope: params.scope,
                freshness: buildFreshness(watermark, staleSeconds),
                queryTimeMs: Date.now() - startedAt,
                cacheHit: cached !== undefined,
            }),
            data,
        });
    }
    /** Resolves scope for an org-scoped route. */
    function orgScope(request, options) {
        const { orgId } = request.params;
        return parseScope(request.query, {
            organizationId: orgId,
            projectId: null,
            ...options,
        });
    }
    /** Resolves scope for a project-scoped route. Org id comes from the project. */
    async function projectScope(request, options) {
        const { projectId } = request.params;
        const organizationId = await fastify.analyticsEngine.resolveProjectOrg(projectId);
        if (!organizationId) {
            throw new AnalyticsQueryError('PROJECT_NOT_FOUND', 'Project not found', 404);
        }
        return parseScope(request.query, {
            organizationId,
            projectId,
            ...options,
        });
    }
    // ── Request metrics ──────────────────────────────────────────────────────
    const requestSummaryPayload = async (scope) => {
        const [current, previous] = await Promise.all([
            read.requestSummary(scope),
            scope.compareRange
                ? read.requestSummary(scope, scope.compareRange)
                : Promise.resolve(null),
        ]);
        const latency = read.latencyView(current);
        const previousLatency = previous ? read.latencyView(previous) : null;
        const windowSeconds = (scope.range.to.getTime() - scope.range.from.getTime()) / 1_000;
        const cards = [
            buildCard({
                key: 'requests.total',
                label: 'Requests',
                value: current.total,
                unit: 'count',
                direction: 'neutral',
                previous: previous?.total ?? null,
            }, scope),
            buildCard({
                key: 'requests.rate',
                label: 'Throughput',
                value: windowSeconds > 0 ? current.total / windowSeconds : null,
                unit: 'ratio',
                direction: 'neutral',
                previous: previous && windowSeconds > 0 ? previous.total / windowSeconds : null,
                context: 'Requests per second across the selected window.',
            }, scope),
            buildCard({
                key: 'requests.error_rate',
                label: 'Error rate',
                value: ratePct(current.error, current.total),
                unit: 'percent',
                direction: 'lower_is_better',
                previous: previous ? ratePct(previous.error, previous.total) : null,
                context: `${current.error} of ${current.total} requests returned 5xx.`,
            }, scope),
            buildCard({
                key: 'requests.client_error_rate',
                label: '4xx rate',
                value: ratePct(current.clientError, current.total),
                unit: 'percent',
                direction: 'lower_is_better',
                previous: previous ? ratePct(previous.clientError, previous.total) : null,
            }, scope),
            buildCard({
                key: 'requests.availability',
                label: 'Availability',
                value: current.total > 0 ? ((current.total - current.error) / current.total) * 100 : null,
                unit: 'percent',
                direction: 'higher_is_better',
                previous: previous && previous.total > 0
                    ? ((previous.total - previous.error) / previous.total) * 100
                    : null,
            }, scope),
            buildCard({
                key: 'requests.latency_p50',
                label: 'p50 latency',
                value: latency.percentiles.p50,
                unit: 'ms',
                direction: 'lower_is_better',
                previous: previousLatency?.percentiles.p50 ?? null,
            }, scope),
            buildCard({
                key: 'requests.latency_p95',
                label: 'p95 latency',
                value: latency.percentiles.p95,
                unit: 'ms',
                direction: 'lower_is_better',
                previous: previousLatency?.percentiles.p95 ?? null,
                context: `Merged from ${current.sampleCount} sampled requests.`,
            }, scope),
            buildCard({
                key: 'requests.latency_p99',
                label: 'p99 latency',
                value: latency.percentiles.p99,
                unit: 'ms',
                direction: 'lower_is_better',
                previous: previousLatency?.percentiles.p99 ?? null,
            }, scope),
            buildCard({
                key: 'requests.apdex',
                label: 'Apdex',
                value: current.total > 0
                    ? (current.apdexSatisfied + current.apdexTolerating / 2) / current.total
                    : null,
                unit: 'ratio',
                direction: 'higher_is_better',
                previous: previous && previous.total > 0
                    ? (previous.apdexSatisfied + previous.apdexTolerating / 2) / previous.total
                    : null,
                context: `Satisfied threshold ${env.ANALYTICS_APDEX_THRESHOLD_MS}ms.`,
            }, scope),
            buildCard({
                key: 'requests.unique_users',
                label: 'Unique users',
                value: current.uniqueUsersEstimate,
                unit: 'count',
                direction: 'neutral',
                previous: previous?.uniqueUsersEstimate ?? null,
            }, scope),
            buildCard({
                key: 'requests.throughput_bytes_out',
                label: 'Bytes out',
                value: current.bytesOut,
                unit: 'bytes',
                direction: 'neutral',
                previous: previous?.bytesOut ?? null,
            }, scope),
            buildCard({
                key: 'requests.rate_limited_count',
                label: 'Rate limited',
                value: current.rateLimited,
                unit: 'count',
                direction: 'lower_is_better',
                previous: previous?.rateLimited ?? null,
            }, scope),
        ];
        return {
            cards,
            latency: {
                percentiles: { ...latency.percentiles },
                avgMs: latency.avgMs,
            },
        };
    };
    const registerRequestRoutes = (prefix, resolve, guards) => {
        fastify.get(`${prefix}/requests/summary`, { preHandler: guards }, async (request, reply) => {
            try {
                const scope = await resolve(request);
                return respond(request, reply, {
                    route: 'requests.summary',
                    scope,
                    workers: FRESHNESS_SOURCES.requests,
                    build: () => requestSummaryPayload(scope),
                });
            }
            catch (error) {
                return fail(reply, request, error);
            }
        });
        fastify.get(`${prefix}/requests/series`, { preHandler: guards }, async (request, reply) => {
            try {
                const scope = await resolve(request);
                const query = request.query;
                const requested = (query.metrics ?? 'total,errors').split(',').map((value) => value.trim());
                const allowed = ['total', 'errors', 'client_errors', 'rate_limited', 'auth_failures', 'bytes_out'];
                const metrics = allowed.filter((metric) => requested.includes(metric));
                return respond(request, reply, {
                    route: `requests.series:${metrics.join('+')}`,
                    scope,
                    workers: FRESHNESS_SOURCES.requests,
                    build: async () => {
                        const [counters, latency] = await Promise.all([
                            read.requestSeries(scope, metrics.length > 0 ? metrics : ['total']),
                            requested.includes('latency') ? read.latencySeries(scope) : Promise.resolve([]),
                        ]);
                        const series = [...counters.entries()].map(([metric, rows]) => buildSeries(`requests.${metric}`, metric.replace(/_/g, ' '), metric === 'bytes_out' ? 'bytes' : 'count', scope.window, rows.map((row) => ({ bucket: row.bucket, value: row.value })), scope.range, 'zero'));
                        if (latency.length > 0) {
                            for (const quantile of ['p50', 'p90', 'p95', 'p99']) {
                                series.push(buildSeries(`requests.latency_${quantile}`, `${quantile} latency`, 'ms', scope.window, latency.map((row) => ({ bucket: row.bucket, value: row[quantile] })), scope.range, 'null'));
                            }
                        }
                        return { series };
                    },
                });
            }
            catch (error) {
                return fail(reply, request, error);
            }
        });
        fastify.get(`${prefix}/requests/status-distribution`, { preHandler: guards }, async (request, reply) => {
            try {
                const scope = await resolve(request);
                return respond(request, reply, {
                    route: 'requests.status',
                    scope,
                    workers: FRESHNESS_SOURCES.requests,
                    build: async () => {
                        const summary = await read.requestSummary(scope);
                        const classes = [
                            { key: '2xx', count: summary.success },
                            { key: '3xx', count: summary.redirect },
                            { key: '4xx', count: summary.clientError },
                            { key: '5xx', count: summary.error },
                        ];
                        return {
                            total: summary.total,
                            distribution: classes.map((entry) => ({
                                class: entry.key,
                                count: entry.count,
                                pct: ratePct(entry.count, summary.total) ?? 0,
                            })),
                        };
                    },
                });
            }
            catch (error) {
                return fail(reply, request, error);
            }
        });
        fastify.get(`${prefix}/requests/latency-histogram`, { preHandler: guards }, async (request, reply) => {
            try {
                const scope = await resolve(request);
                return respond(request, reply, {
                    route: 'requests.histogram',
                    scope,
                    workers: FRESHNESS_SOURCES.requests,
                    build: async () => {
                        const [summary, heatmap] = await Promise.all([
                            read.requestSummary(scope),
                            read.latencyHeatmap(scope),
                        ]);
                        return {
                            buckets: histogramView(summary.latencyHistogram),
                            percentiles: read.latencyView(summary).percentiles,
                            heatmap: {
                                columns: heatmap.map((entry) => entry.bucket.toISOString()),
                                rows: histogramView(summary.latencyHistogram).map((band, index) => ({
                                    label: band.toMs === null
                                        ? `${formatLatency(band.fromMs)}+`
                                        : `${formatLatency(band.fromMs)}–${formatLatency(band.toMs)}`,
                                    cells: heatmap.map((entry) => num(entry.histogram[index])),
                                })),
                            },
                        };
                    },
                });
            }
            catch (error) {
                return fail(reply, request, error);
            }
        });
        fastify.get(`${prefix}/endpoints`, { preHandler: guards }, async (request, reply) => {
            try {
                const scope = await resolve(request, {
                    sortable: ['requests', 'errors', 'p95', 'p50'],
                    defaultSort: { column: 'requests', direction: 'desc' },
                    defaultLimit: 25,
                });
                const raw = request.query;
                const build = async () => {
                    const rows = await read.topEntities(scope, {
                        base: 'endpoint_metrics',
                        available: ['1m', '5m', '1h', '1d'],
                        valueColumn: 'total_count',
                        extraColumns: ['entity_label', 'method', 'route', 'service', 'error_count', 'client_error_count', 'bytes_out'],
                        orderBy: 'value',
                        direction: scope.sort?.direction ?? 'desc',
                        excludeOther: false,
                    });
                    const table = buildTable('endpoints', [
                        { key: 'endpoint', label: 'Endpoint', align: 'left', format: 'mono', sortable: true },
                        { key: 'requests', label: 'Requests', align: 'right', format: 'compact', sortable: true },
                        { key: 'errorRatePct', label: 'Error %', align: 'right', format: 'percent', sortable: true },
                        { key: 'p50Ms', label: 'p50', align: 'right', format: 'latency', sortable: true },
                        { key: 'p95Ms', label: 'p95', align: 'right', format: 'latency', sortable: true },
                        { key: 'p99Ms', label: 'p99', align: 'right', format: 'latency', sortable: false },
                        { key: 'bytesOut', label: 'Bytes out', align: 'right', format: 'bytes', sortable: false },
                        { key: 'service', label: 'Service', align: 'left', format: 'text', sortable: false },
                    ], rows.map((row) => {
                        const percentiles = row.latencyPercentiles;
                        const requests = num(row.value);
                        return {
                            endpoint: row.entity_label ?? row.entity_key,
                            requests,
                            errorRatePct: ratePct(num(row.error_count), requests),
                            p50Ms: percentiles?.p50 ?? null,
                            p95Ms: percentiles?.p95 ?? null,
                            p99Ms: percentiles?.p99 ?? null,
                            bytesOut: num(row.bytes_out),
                            service: row.service ?? null,
                        };
                    }), scope.sort ?? { column: 'requests', direction: 'desc' });
                    return { table };
                };
                if (isCsvRequested(raw)) {
                    const payload = (await build());
                    return reply
                        .header('content-type', 'text/csv; charset=utf-8')
                        .header('content-disposition', `attachment; filename="endpoints-${scope.range.from.toISOString()}-${scope.range.to.toISOString()}.csv"`)
                        .send(tableToCsv(payload.table));
                }
                return respond(request, reply, {
                    route: 'endpoints',
                    scope,
                    workers: FRESHNESS_SOURCES.endpoints,
                    build,
                });
            }
            catch (error) {
                return fail(reply, request, error);
            }
        });
        fastify.get(`${prefix}/endpoints/slowest`, { preHandler: guards }, async (request, reply) => {
            try {
                const scope = await resolve(request, { defaultLimit: 10 });
                return respond(request, reply, {
                    route: 'endpoints.slowest',
                    scope,
                    workers: FRESHNESS_SOURCES.endpoints,
                    build: async () => {
                        const rows = await read.topEntities(scope, {
                            base: 'endpoint_metrics',
                            available: ['1m', '5m', '1h', '1d'],
                            valueColumn: 'total_count',
                            extraColumns: ['entity_label', 'error_count'],
                            orderBy: 'value',
                            direction: 'desc',
                        });
                        const items = rows
                            .map((row) => {
                            const percentiles = row.latencyPercentiles;
                            return {
                                key: String(row.entity_key),
                                label: String(row.entity_label ?? row.entity_key),
                                value: percentiles?.p95 ?? 0,
                                secondary: `${num(row.value)} req`,
                                severity: (percentiles?.p95 ?? 0) > 1_000 ? 'critical' : (percentiles?.p95 ?? 0) > 500 ? 'warn' : 'ok',
                            };
                        })
                            .sort((a, b) => b.value - a.value);
                        return {
                            list: buildRankedList({
                                key: 'endpoints.top_slowest',
                                label: 'Slowest endpoints',
                                unit: 'ms',
                                items,
                            }),
                        };
                    },
                });
            }
            catch (error) {
                return fail(reply, request, error);
            }
        });
        // ── Errors ─────────────────────────────────────────────────────────────
        fastify.get(`${prefix}/errors/summary`, { preHandler: guards }, async (request, reply) => {
            try {
                const scope = await resolve(request);
                return respond(request, reply, {
                    route: 'errors.summary',
                    scope,
                    workers: FRESHNESS_SOURCES.errors,
                    build: async () => {
                        const [current, previous] = await Promise.all([
                            read.errorSummary(scope),
                            scope.compareRange ? read.errorSummary(scope, scope.compareRange) : Promise.resolve(null),
                        ]);
                        return {
                            cards: [
                                buildCard({
                                    key: 'errors.total',
                                    label: 'Errors',
                                    value: current.total,
                                    unit: 'count',
                                    direction: 'lower_is_better',
                                    previous: previous?.total ?? null,
                                }, scope),
                                buildCard({
                                    key: 'errors.unique_groups',
                                    label: 'Error groups',
                                    value: current.uniqueFingerprints,
                                    unit: 'count',
                                    direction: 'lower_is_better',
                                    previous: previous?.uniqueFingerprints ?? null,
                                }, scope),
                                buildCard({
                                    key: 'errors.affected_users',
                                    label: 'Affected users',
                                    value: current.affectedUsers,
                                    unit: 'count',
                                    direction: 'lower_is_better',
                                    previous: previous?.affectedUsers ?? null,
                                }, scope),
                                buildCard({
                                    key: 'errors.severity_mix',
                                    label: 'Fatal errors',
                                    value: current.fatal,
                                    unit: 'count',
                                    direction: 'lower_is_better',
                                    previous: previous?.fatal ?? null,
                                }, scope),
                            ],
                        };
                    },
                });
            }
            catch (error) {
                return fail(reply, request, error);
            }
        });
        fastify.get(`${prefix}/errors/groups`, { preHandler: guards }, async (request, reply) => {
            try {
                const scope = await resolve(request, {
                    sortable: ['occurrences', 'lastSeen', 'firstSeen', 'users', 'regression'],
                    defaultSort: { column: 'lastSeen', direction: 'desc' },
                    defaultLimit: 25,
                });
                const query = request.query;
                const status = query.status === 'resolved' || query.status === 'unresolved' ? query.status : 'all';
                return respond(request, reply, {
                    route: `errors.groups:${status}:${query.mechanism ?? '-'}`,
                    scope,
                    workers: FRESHNESS_SOURCES.errors,
                    build: async () => {
                        const rows = await read.errorGroups(scope, {
                            status,
                            ...(query.mechanism ? { mechanism: query.mechanism } : {}),
                        });
                        return {
                            table: buildTable('errorGroups', [
                                { key: 'errorName', label: 'Error', align: 'left', format: 'text', sortable: false },
                                { key: 'message', label: 'Message', align: 'left', format: 'text', sortable: false },
                                { key: 'occurrences', label: 'Events', align: 'right', format: 'compact', sortable: true },
                                { key: 'affectedUsers', label: 'Users', align: 'right', format: 'compact', sortable: true },
                                { key: 'severity', label: 'Severity', align: 'left', format: 'severity', sortable: false },
                                { key: 'mechanism', label: 'Mechanism', align: 'left', format: 'text', sortable: false },
                                { key: 'regressionScore', label: 'Regression', align: 'right', format: 'number', sortable: true },
                                { key: 'status', label: 'Status', align: 'left', format: 'text', sortable: false },
                                { key: 'firstSeen', label: 'First seen', align: 'left', format: 'timestamp', sortable: true },
                                { key: 'lastSeen', label: 'Last seen', align: 'left', format: 'timestamp', sortable: true },
                            ], rows.map((row) => ({
                                fingerprint: row.fingerprint,
                                errorName: row.error_name,
                                message: row.message_template,
                                occurrences: num(row.occurrences),
                                affectedUsers: num(row.affected_users),
                                severity: row.severity,
                                mechanism: row.mechanism,
                                regressionScore: row.regression_score,
                                status: row.status ?? 'unresolved',
                                priority: row.priority ?? 3,
                                isNew: row.is_new ?? false,
                                services: row.services ?? [],
                                releases: row.releases ?? [],
                                firstSeen: row.first_seen_at,
                                lastSeen: row.last_seen_at,
                                href: `/observability/errors/${encodeURIComponent(String(row.fingerprint))}`,
                                aiContext: `Error group ${String(row.error_name)} (${String(row.mechanism ?? 'unknown mechanism')}) ` +
                                    `occurred ${num(row.occurrences)} times affecting ${num(row.affected_users)} users. ` +
                                    `Message: ${String(row.message_template ?? '')}`,
                            })), scope.sort ?? { column: 'lastSeen', direction: 'desc' }),
                        };
                    },
                });
            }
            catch (error) {
                return fail(reply, request, error);
            }
        });
        // ── Logs / traces / services ───────────────────────────────────────────
        fastify.get(`${prefix}/logs/summary`, { preHandler: guards }, async (request, reply) => {
            try {
                const scope = await resolve(request);
                return respond(request, reply, {
                    route: 'logs.summary',
                    scope,
                    workers: FRESHNESS_SOURCES.logs,
                    build: async () => {
                        const [current, previous] = await Promise.all([
                            read.logSummary(scope),
                            scope.compareRange ? read.logSummary(scope, scope.compareRange) : Promise.resolve(null),
                        ]);
                        return {
                            cards: [
                                buildCard({ key: 'logs.total', label: 'Log lines', value: current.total, unit: 'count', direction: 'neutral', previous: previous?.total ?? null }, scope),
                                buildCard({ key: 'logs.volume_by_level', label: 'Errors', value: current.error, unit: 'count', direction: 'lower_is_better', previous: previous?.error ?? null }, scope),
                                buildCard({ key: 'logs.error_ratio', label: 'Error ratio', value: ratePct(current.error, current.total), unit: 'percent', direction: 'lower_is_better', previous: previous ? ratePct(previous.error, previous.total) : null }, scope),
                            ],
                            byLevel: [
                                { level: 'error', count: current.error },
                                { level: 'warn', count: current.warn },
                                { level: 'info', count: current.info },
                                { level: 'debug', count: current.debug },
                            ],
                        };
                    },
                });
            }
            catch (error) {
                return fail(reply, request, error);
            }
        });
        fastify.get(`${prefix}/traces/summary`, { preHandler: guards }, async (request, reply) => {
            try {
                const scope = await resolve(request);
                return respond(request, reply, {
                    route: 'traces.summary',
                    scope,
                    workers: FRESHNESS_SOURCES.traces,
                    build: async () => {
                        const [current, previous] = await Promise.all([
                            read.traceSummary(scope),
                            scope.compareRange ? read.traceSummary(scope, scope.compareRange) : Promise.resolve(null),
                        ]);
                        const percentiles = percentilesFromHistogram(current.durationHistogram);
                        return {
                            cards: [
                                buildCard({ key: 'traces.total', label: 'Traces', value: current.traces, unit: 'count', direction: 'neutral', previous: previous?.traces ?? null }, scope),
                                buildCard({ key: 'traces.partial_rate', label: 'Partial traces', value: ratePct(current.partial, current.traces), unit: 'percent', direction: 'lower_is_better', previous: previous ? ratePct(previous.partial, previous.traces) : null }, scope),
                                buildCard({ key: 'traces.error_trace_rate', label: 'Error traces', value: ratePct(current.errorTraces, current.traces), unit: 'percent', direction: 'lower_is_better', previous: previous ? ratePct(previous.errorTraces, previous.traces) : null }, scope),
                                buildCard({ key: 'traces.span_count_avg', label: 'Avg spans / trace', value: current.traces > 0 ? current.spanCountSum / current.traces : null, unit: 'ratio', direction: 'neutral', previous: previous && previous.traces > 0 ? previous.spanCountSum / previous.traces : null }, scope),
                                buildCard({ key: 'traces.duration_p95', label: 'p95 trace duration', value: percentiles.p95, unit: 'ms', direction: 'lower_is_better' }, scope),
                            ],
                        };
                    },
                });
            }
            catch (error) {
                return fail(reply, request, error);
            }
        });
        fastify.get(`${prefix}/services`, { preHandler: guards }, async (request, reply) => {
            try {
                const scope = await resolve(request, { defaultLimit: 50 });
                return respond(request, reply, {
                    route: 'services',
                    scope,
                    workers: FRESHNESS_SOURCES.services,
                    build: async () => {
                        const rows = await read.services(scope);
                        return {
                            table: buildTable('services', [
                                { key: 'service', label: 'Service', align: 'left', format: 'text', sortable: true },
                                { key: 'requests', label: 'Requests', align: 'right', format: 'compact', sortable: true },
                                { key: 'errorRatePct', label: 'Error %', align: 'right', format: 'percent', sortable: true },
                                { key: 'p95Ms', label: 'p95', align: 'right', format: 'latency', sortable: true },
                                { key: 'availabilityPct', label: 'Availability', align: 'right', format: 'percent', sortable: true },
                                { key: 'apdex', label: 'Apdex', align: 'right', format: 'number', sortable: true },
                                { key: 'healthScore', label: 'Health', align: 'right', format: 'number', sortable: true },
                                { key: 'release', label: 'Release', align: 'left', format: 'text', sortable: false },
                            ], rows.map((row) => {
                                const percentiles = row.latencyPercentiles;
                                return {
                                    service: row.service,
                                    requests: num(row.total_count),
                                    errorRatePct: row.error_rate_pct,
                                    p95Ms: percentiles?.p95 ?? null,
                                    availabilityPct: row.availability_pct,
                                    apdex: row.apdex,
                                    healthScore: row.health_score,
                                    release: row.release_current,
                                    status: num(row.health_score) >= 90
                                        ? 'healthy'
                                        : num(row.health_score) >= 70
                                            ? 'degraded'
                                            : 'critical',
                                };
                            }), { column: 'requests', direction: 'desc' }),
                        };
                    },
                });
            }
            catch (error) {
                return fail(reply, request, error);
            }
        });
        // ── Composite overview ─────────────────────────────────────────────────
        fastify.get(`${prefix}/overview`, { preHandler: guards }, async (request, reply) => {
            try {
                const scope = await resolve(request, { defaultLimit: 6 });
                return respond(request, reply, {
                    route: 'overview',
                    scope,
                    workers: FRESHNESS_SOURCES.overview,
                    build: async () => {
                        const [requestPayload, errorSummary, previousErrors, services, counters, slowest] = await Promise.all([
                            requestSummaryPayload(scope),
                            read.errorSummary(scope),
                            scope.compareRange ? read.errorSummary(scope, scope.compareRange) : Promise.resolve(null),
                            read.services(scope),
                            read.requestSeries(scope, ['total', 'errors']),
                            read.topEntities(scope, {
                                base: 'endpoint_metrics',
                                available: ['1m', '5m', '1h', '1d'],
                                valueColumn: 'total_count',
                                extraColumns: ['entity_label', 'error_count'],
                            }),
                        ]);
                        const requestSeries = buildSeries('requests.total', 'Requests', 'count', scope.window, (counters.get('total') ?? []).map((row) => ({ bucket: row.bucket, value: row.value })), scope.range);
                        const errorSeries = buildSeries('requests.error_count', 'Errors', 'count', scope.window, (counters.get('errors') ?? []).map((row) => ({ bucket: row.bucket, value: row.value })), scope.range);
                        // Attach the traffic sparkline to the volume card.
                        const cards = requestPayload.cards.map((card) => card.key === 'requests.total'
                            ? { ...card, sparkline: sparklineFrom(requestSeries) }
                            : card);
                        return {
                            cards: [
                                ...cards,
                                buildCard({
                                    key: 'errors.total',
                                    label: 'Errors',
                                    value: errorSummary.total,
                                    unit: 'count',
                                    direction: 'lower_is_better',
                                    previous: previousErrors?.total ?? null,
                                    sparkline: sparklineFrom(errorSeries),
                                }, scope),
                                buildCard({
                                    key: 'errors.unique_groups',
                                    label: 'Error groups',
                                    value: errorSummary.uniqueFingerprints,
                                    unit: 'count',
                                    direction: 'lower_is_better',
                                    previous: previousErrors?.uniqueFingerprints ?? null,
                                }, scope),
                            ],
                            series: { requests: requestSeries, errors: errorSeries },
                            latency: requestPayload.latency,
                            services: services.slice(0, scope.limit),
                            topSlowEndpoints: buildRankedList({
                                key: 'endpoints.top_slowest',
                                label: 'Slowest endpoints',
                                unit: 'ms',
                                items: slowest.map((row) => {
                                    const percentiles = row.latencyPercentiles;
                                    return {
                                        key: String(row.entity_key),
                                        label: String(row.entity_label ?? row.entity_key),
                                        value: percentiles?.p95 ?? 0,
                                        secondary: `${num(row.value)} req`,
                                    };
                                }),
                            }),
                        };
                    },
                });
            }
            catch (error) {
                return fail(reply, request, error);
            }
        });
    };
    // Org-scoped surface: /analytics/v2/org/:orgId/*
    registerRequestRoutes('/org/:orgId', async (request, options) => orgScope(request, options), [authenticate, requireOrgMembership]);
    // Project-scoped surface: /analytics/v2/projects/:projectId/*
    registerRequestRoutes('/projects/:projectId', async (request, options) => projectScope(request, options), [authenticate, requireProjectMembership]);
    // ── Cross-cutting ────────────────────────────────────────────────────────
    fastify.get('/org/:orgId/projects/health', { preHandler: [authenticate, requireOrgMembership] }, async (request, reply) => {
        try {
            const { orgId } = request.params;
            const rows = await read.projectHealth(orgId);
            const watermark = await watermarks.freshnessFor(['analytics.health'], orgId).catch(() => null);
            return reply.send({
                meta: {
                    scope: 'org',
                    organizationId: orgId,
                    generatedAt: new Date().toISOString(),
                    freshness: buildFreshness(watermark, staleSeconds),
                },
                data: { items: rows },
            });
        }
        catch (error) {
            return fail(reply, request, error);
        }
    });
    fastify.get('/system/health', { preHandler: [authenticate] }, async (_request, reply) => {
        const snapshots = await watermarks.healthSnapshot().catch(() => []);
        const worstLag = snapshots.reduce((max, snapshot) => Math.max(max, snapshot.lagSeconds), 0);
        const status = snapshots.some((snapshot) => snapshot.status === 'unhealthy')
            ? 'unhealthy'
            : worstLag > staleSeconds * 2
                ? 'degraded'
                : 'healthy';
        return reply.status(status === 'unhealthy' ? 503 : 200).send({
            data: { status, worstLagSeconds: worstLag, workers: snapshots },
        });
    });
}
/** Exposed for the contract test so route registration can be asserted. */
export { ANALYTICS_V2_SCOPED_ROUTES, ANALYTICS_V2_GLOBAL_ROUTES, analyticsV2Paths, } from './route-manifest.js';
//# sourceMappingURL=analytics-v2.routes.js.map