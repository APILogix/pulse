import { logger } from '../config/logger.js';
const healthLogger = logger.child({ component: 'health-check' });
/**
 * Load-balancer health checks.
 *
 * /health/live is a liveness signal. /health/ready is the Oracle Cloud Load
 * Balancer traffic gate and fails closed when the shared gauge is stale or deep.
 */
export async function registerHealthChecks(app, config) {
    app.get('/health/live', async (_req, reply) => {
        return reply.status(200).send({
            status: 'alive',
            timestamp: new Date().toISOString(),
        });
    });
    app.get('/health/ready', async (_req, reply) => {
        try {
            const gauge = await config.gauge.read();
            if (!gauge) {
                healthLogger.warn('Backpressure gauge unavailable');
                return reply.status(503).send({
                    status: 'unavailable',
                    reason: 'gauge_unavailable',
                    timestamp: new Date().toISOString(),
                });
            }
            const ageMs = Date.now() - gauge.updatedAt.getTime();
            const isStale = config.gauge.isStale(gauge, config.maxGaugeAgeMs);
            const isDeep = gauge.pendingDepth > config.maxQueueDepth;
            const customResult = config.customReadyCheck
                ? await config.customReadyCheck()
                : { healthy: true };
            if (isDeep || isStale || !customResult.healthy) {
                const reason = isDeep
                    ? 'queue_depth_exceeded'
                    : isStale
                        ? 'gauge_stale'
                        : customResult.reason ?? 'custom_check_failed';
                healthLogger.warn({
                    depth: gauge.pendingDepth,
                    maxDepth: config.maxQueueDepth,
                    ageMs,
                    maxAgeMs: config.maxGaugeAgeMs,
                    reason,
                }, 'Readiness check failed');
                return reply.status(503).send({
                    status: 'unavailable',
                    reason,
                    depth: gauge.pendingDepth,
                    maxDepth: config.maxQueueDepth,
                    gaugeAgeMs: ageMs,
                    timestamp: new Date().toISOString(),
                });
            }
            healthLogger.debug({ pendingDepth: gauge.pendingDepth, gaugeAgeMs: ageMs }, 'health.ready.status');
            return reply.status(200).send({
                status: 'ready',
                depth: gauge.pendingDepth,
                gaugeAgeMs: ageMs,
                timestamp: new Date().toISOString(),
            });
        }
        catch (err) {
            healthLogger.error({ err }, 'Health check exception');
            return reply.status(503).send({
                status: 'error',
                reason: 'health_check_exception',
                timestamp: new Date().toISOString(),
            });
        }
    });
}
//# sourceMappingURL=health.js.map