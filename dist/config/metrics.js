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
async function metricsPlugin(fastify) {
    initializeMetrics();
    fastify.get('/metrics', async (_request, reply) => {
        reply.type(register.contentType);
        return register.metrics();
    });
    fastify.addHook('onRequest', async () => {
        httpRequestsInFlight.inc();
    });
    fastify.addHook('onResponse', async (request, reply) => {
        httpRequestsInFlight.dec();
        const duration = (Date.now() - request.startTime) / 1000;
        const route = request.routerPath || request.url;
        const labels = {
            method: request.method,
            route,
            status_code: reply.statusCode.toString(),
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