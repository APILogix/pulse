/**
 * Fastify Performance Monitoring Plugin.
 *
 * Implements:
 * 1. AsyncLocalStorage context propagation from incoming HTTP requests.
 * 2. Response Server-Timing header injection (dev, staging, or sampled admin requests).
 * 3. Structured per-request JSON logging with database & cache durations and query counts.
 * 4. Internal diagnostic endpoint: GET /admin/perf/latency-summary.
 * 5. Startup validation of query latency budgets.
 */
import { performance } from 'node:perf_hooks';
import { env } from '../env.js';
import { logger } from '../logger.js';
import { pool } from '../database.js';
import { logDB } from '../log-database.js';
import { register } from '../metrics.js';
import { perfContextStorage, } from './context.js';
import { dbQueriesPerRequestHistogram, registerPoolConnectionMetrics, } from './metrics.js';
import { DB_QUERY_BUDGETS, validateQueryBudgets, } from './perf-budgets.js';
const perfLogger = logger.child({ component: 'http-perf' });
/**
 * Registers performance hooks, metrics pollers, and admin diagnostic routes.
 */
export async function registerPerfPlugin(app) {
    // 1. Startup budget validation & pool gauge registration
    app.addHook('onReady', async () => {
        try {
            validateQueryBudgets();
        }
        catch (err) {
            perfLogger.error({ err }, 'Query latency budget validation failed on startup');
            if (env.NODE_ENV === 'test' || env.NODE_ENV === 'development') {
                throw err;
            }
        }
        try {
            registerPoolConnectionMetrics('control', pool);
            registerPoolConnectionMetrics('telemetry', logDB.getPrimaryPool());
            perfLogger.info('Connection pool gauges registered');
        }
        catch (err) {
            perfLogger.warn({ err }, 'Failed to initialize pool connection gauges');
        }
    });
    // 2. Request context initialization hook
    app.addHook('onRequest', (request, _reply, done) => {
        const route = request.routeOptions?.url || request.url;
        const reqId = request.id || request.headers['x-request-id'] || 'req_unknown';
        const tier = request.headers['x-org-tier'] || 'default';
        const orgId = request.headers['x-org-id'] || undefined;
        request.startTimePerf = performance.now();
        const stats = {
            requestId: reqId,
            route,
            tier,
            orgId,
            queryCount: 0,
            totalDbTimeMs: 0,
            totalPoolWaitMs: 0,
            cacheOpCount: 0,
            totalCacheTimeMs: 0,
            queryFrequency: new Map(),
            nPlusOneLogged: false,
        };
        request.perfStats = stats;
        perfContextStorage.run(stats, () => {
            done();
        });
    });
    // 3. Server-Timing header injection (dev, staging, or sampled/admin requests)
    app.addHook('onSend', async (request, reply, payload) => {
        const stats = request.perfStats;
        if (!stats || !request.startTimePerf)
            return payload;
        const totalDurationMs = Math.round((performance.now() - request.startTimePerf) * 100) / 100;
        const isDevOrStaging = env.NODE_ENV !== 'production';
        const isSampled = request.headers['x-perf-sample'] === 'true' ||
            Boolean(request.headers['authorization']);
        if (isDevOrStaging || isSampled) {
            const dbDur = Math.round(stats.totalDbTimeMs * 100) / 100;
            const cacheDur = Math.round(stats.totalCacheTimeMs * 100) / 100;
            reply.header('Server-Timing', `db;dur=${dbDur}, cache;dur=${cacheDur}, total;dur=${totalDurationMs}`);
        }
        return payload;
    });
    // 4. Request summary logging and Prometheus metrics observation
    app.addHook('onResponse', async (request, reply) => {
        const stats = request.perfStats;
        const durationMs = request.startTimePerf
            ? Math.round((performance.now() - request.startTimePerf) * 100) / 100
            : 0;
        const routePattern = request.routeOptions?.url || request.url;
        // Observe db_queries_per_request histogram
        if (stats && stats.queryCount > 0) {
            try {
                dbQueriesPerRequestHistogram.observe({ route: routePattern }, stats.queryCount);
            }
            catch { }
        }
        // Structured JSON log per request
        perfLogger.info({
            requestId: request.id,
            route: routePattern,
            status: reply.statusCode,
            duration_ms: durationMs,
            db_time_ms: stats ? Math.round(stats.totalDbTimeMs * 100) / 100 : 0,
            cache_time_ms: stats ? Math.round(stats.totalCacheTimeMs * 100) / 100 : 0,
            db_query_count: stats ? stats.queryCount : 0,
        }, 'Request performance summary');
    });
    // 5. Admin Diagnostic Route: GET /admin/perf/latency-summary
    app.get('/admin/perf/latency-summary', async (request, reply) => {
        // Basic protection: require internal bearer token or dev environment
        if (env.NODE_ENV === 'production') {
            const authHeader = request.headers.authorization;
            const adminToken = process.env.ADMIN_DIAGNOSTICS_TOKEN;
            if (adminToken && authHeader !== `Bearer ${adminToken}`) {
                return reply.status(401).send({ error: 'Unauthorized internal diagnostics request' });
            }
        }
        const metricsJson = await register.getMetricsAsJSON();
        const queryDurationMetric = metricsJson.find((m) => m.name === 'db_query_duration_seconds');
        // Compute approximate percentiles from Prometheus histogram buckets
        const queryStatsMap = new Map();
        if (queryDurationMetric && Array.isArray(queryDurationMetric.values)) {
            for (const val of queryDurationMetric.values) {
                const queryName = String(val.labels?.query ?? '');
                if (!queryName)
                    continue;
                if (!queryStatsMap.has(queryName)) {
                    queryStatsMap.set(queryName, { count: 0, sum: 0 });
                }
                const entry = queryStatsMap.get(queryName);
                const metricName = String(val.metricName ?? '');
                if (metricName.endsWith('_count')) {
                    entry.count = val.value;
                }
                else if (metricName.endsWith('_sum')) {
                    entry.sum = val.value;
                }
            }
        }
        const summary = [];
        const breaches = [];
        for (const [name, budget] of Object.entries(DB_QUERY_BUDGETS)) {
            const stats = queryStatsMap.get(name);
            const totalCalls = stats?.count ?? 0;
            const approxAvgMs = totalCalls > 0 ? Math.round((stats.sum / totalCalls) * 1000 * 100) / 100 : 0;
            const isBreaching = approxAvgMs > budget.p95Ms;
            summary.push({
                query: name,
                budget,
                approxAvgMs,
                totalCalls,
                isBreaching,
            });
            if (isBreaching && totalCalls > 0) {
                breaches.push({
                    query: name,
                    approxAvgMs,
                    budgetP95Ms: budget.p95Ms,
                });
            }
        }
        summary.sort((a, b) => b.approxAvgMs - a.approxAvgMs);
        const top5Slowest = summary.slice(0, 5);
        const poolUtilization = {
            control: {
                total: pool.totalCount,
                idle: pool.idleCount,
                waiting: pool.waitingCount,
            },
            telemetry: logDB.getPoolStats(),
        };
        return reply.send({
            timestamp: new Date().toISOString(),
            poolUtilization,
            breachesCount: breaches.length,
            breaches,
            top5Slowest,
            allQueries: summary,
        });
    });
}
//# sourceMappingURL=http-plugin.js.map