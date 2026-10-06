import fp from 'fastify-plugin';
import { pool } from './database.js';
import { checkPostgresHealth, classifyPostgresHealthError, } from './postgres-network.js';
import { logDB } from './log-database.js';
import { checkRedis } from './redis.js';
import { logger } from './logger.js';
import { env } from './env.js';
const healthLogger = logger.child({ component: 'health' });
const DEPENDENCY_TIMEOUT_MS = 3000;
async function withTimeout(promise, timeoutMs) {
    let timeoutId;
    const timeout = new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('Health check timeout')), timeoutMs);
    });
    try {
        return await Promise.race([promise, timeout]);
    }
    finally {
        clearTimeout(timeoutId);
    }
}
/**
 * Health & Readiness Plugin
 *
 * Exposes Kubernetes-standard probe endpoints:
 * - /health  — shallow liveness (process is running)
 * - /live    — alias for liveness (always 200 if process is up)
 * - /ready   — deep readiness (required DBs, plus Redis when REDIS_REQUIRED=true)
 * - /metrics — Prometheus metrics (registered via metrics plugin)
 *
 * Wrapped in fastify-plugin so these routes are available at the root scope.
 */
async function healthPlugin(fastify) {
    // Liveness must answer while the process is alive, even when readiness is
    // temporarily degraded. Otherwise orchestrators restart a recoverable process
    // and create a pressure/restart loop. Readiness endpoints remain pressure-gated.
    const livenessConfig = { pressureHandler: () => undefined };
    fastify.get('/health', { config: livenessConfig }, async () => ({
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        version: process.env.npm_package_version ?? 'unknown',
        memory: {
            rssMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
            heapUsedMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
            heapTotalMB: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
        },
    }));
    fastify.get('/live', { config: livenessConfig }, async () => ({ status: 'alive' }));
    // Readiness probe — verifies all critical dependencies with timeout.
    fastify.get('/ready', async (_request, reply) => {
        const checks = {};
        // Primary DB check with timeout
        const dbStart = Date.now();
        try {
            const dbHealth = await withTimeout(checkPostgresHealth(pool), DEPENDENCY_TIMEOUT_MS);
            checks.database = {
                healthy: dbHealth.healthy,
                latencyMs: Date.now() - dbStart,
                ...(!dbHealth.healthy ? { error: dbHealth.failure } : {}),
            };
        }
        catch (err) {
            checks.database = {
                healthy: false,
                latencyMs: Date.now() - dbStart,
                error: classifyPostgresHealthError(err),
            };
        }
        // Redis check with timeout
        const redisStart = Date.now();
        try {
            const redisHealthy = await withTimeout(checkRedis(), DEPENDENCY_TIMEOUT_MS);
            checks.redis = {
                healthy: redisHealthy,
                latencyMs: Date.now() - redisStart,
                ...(!redisHealthy ? { error: 'unavailable' } : {}),
            };
        }
        catch {
            checks.redis = {
                healthy: false,
                latencyMs: Date.now() - redisStart,
                error: 'unavailable',
            };
        }
        // Log DB check with timeout
        const logDbStart = Date.now();
        try {
            const logHealth = await withTimeout(logDB.healthCheck(), DEPENDENCY_TIMEOUT_MS);
            checks.logDatabase = {
                healthy: logHealth.healthy,
                latencyMs: Date.now() - logDbStart,
                ...(!logHealth.healthy && logHealth.failure ? { error: logHealth.failure } : {}),
            };
        }
        catch (err) {
            checks.logDatabase = {
                healthy: false,
                latencyMs: Date.now() - logDbStart,
                error: classifyPostgresHealthError(err),
            };
        }
        const allHealthy = Object.entries(checks).every(([name, check]) => check.healthy || (name === 'redis' && !env.REDIS_REQUIRED));
        if (!allHealthy) {
            healthLogger.warn({ checks }, 'Readiness check failed — one or more dependencies unhealthy');
        }
        return reply.status(allHealthy ? 200 : 503).send({
            status: allHealthy ? 'ready' : 'degraded',
            checks,
        });
    });
    // Root endpoint
    fastify.get('/', async () => ({
        service: 'API Monitoring Backend',
        status: 'running',
    }));
}
export const registerHealthPlugin = fp(healthPlugin, { name: 'health-plugin' });
//# sourceMappingURL=plugins.js.map