import fp from 'fastify-plugin';
import promClient from 'prom-client';
const register = new promClient.Registry();
let metricsInitialized = false;
function initializeMetrics() {
    if (metricsInitialized)
        return;
    metricsInitialized = true;
    promClient.collectDefaultMetrics({ register });
}
const httpRequestDurationMicroseconds = new promClient.Histogram({
    name: 'http_request_duration_seconds',
    help: 'Duration of HTTP requests in seconds',
    labelNames: ['method', 'route', 'status_code'],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [register],
});
const httpRequestTotal = new promClient.Counter({
    name: 'http_requests_total',
    help: 'Total number of HTTP requests',
    labelNames: ['method', 'route', 'status_code'],
    registers: [register],
});
const httpRequestsInFlight = new promClient.Gauge({
    name: 'http_requests_in_flight',
    help: 'Number of HTTP requests currently being processed',
    registers: [register],
});
const STATUS_CODE_CACHE = [];
for (let i = 100; i < 600; i++) {
    STATUS_CODE_CACHE[i] = String(i);
}
function getStatusCodeString(code) {
    return STATUS_CODE_CACHE[code] || String(code);
}
async function metricsPlugin(fastify) {
    initializeMetrics();
    fastify.get('/metrics', async (_request, reply) => {
        reply.type(register.contentType);
        return register.metrics();
    });
    fastify.addHook('onRequest', async (request) => {
        httpRequestsInFlight.inc();
        if (!request.startTime) {
            request.startTime = Date.now();
        }
    });
    fastify.addHook('onResponse', async (request, reply) => {
        httpRequestsInFlight.dec();
        const startTime = request.startTime;
        const duration = startTime ? Math.max(0, (Date.now() - startTime) / 1000) : 0;
        // Strictly bound route label cardinality to prevent memory leak from random 404/unmatched URLs
        const route = request.routeOptions?.url || request.routerPath || 'unmatched';
        const labels = {
            method: request.method,
            route,
            status_code: getStatusCodeString(reply.statusCode),
        };
        httpRequestTotal.inc(labels);
        httpRequestDurationMicroseconds.observe(labels, duration);
    });
}
export const registerMetricsPlugin = fp(metricsPlugin, {
    name: 'metrics-plugin',
});
export { register, httpRequestDurationMicroseconds, httpRequestTotal, httpRequestsInFlight };
//# sourceMappingURL=metrics.js.map