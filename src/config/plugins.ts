import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { pool } from './database.js';
import { logDB } from './log-database.js';
import { redis } from './redis.js';
import { logger } from './logger.js';

const healthLogger = logger.child({ component: 'health' });

/**
 * Health & Readiness Plugin
 *
 * Exposes Kubernetes-standard probe endpoints:
 * - /health  — shallow liveness (process is running)
 * - /live    — alias for liveness (always 200 if process is up)
 * - /ready   — deep readiness (checks DB, Redis, Log DB)
 *
 * Wrapped in fastify-plugin so these routes are available at the root scope.
 */
async function healthPlugin(fastify: FastifyInstance): Promise<void> {

  // Liveness probe — always returns 200 if the process is running.
  // Kubernetes uses this to decide whether to restart the container.
  fastify.get('/health', async () => ({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: process.env.npm_package_version ?? 'unknown',
  }));

  fastify.get('/live', async () => ({ status: 'alive' }));

  // Readiness probe — verifies all critical dependencies are available.
  // Kubernetes uses this to decide whether to route traffic to this pod.
  fastify.get('/ready', async (_request, reply) => {
    const checks: Record<string, { healthy: boolean; latencyMs?: number }> = {};

    // Primary DB check
    const dbStart = Date.now();
    try {
      await pool.query('SELECT 1');
      checks.database = { healthy: true, latencyMs: Date.now() - dbStart };
    } catch {
      checks.database = { healthy: false, latencyMs: Date.now() - dbStart };
    }

    // Redis check
    const redisStart = Date.now();
    try {
      await redis.ping();
      checks.redis = { healthy: true, latencyMs: Date.now() - redisStart };
    } catch {
      checks.redis = { healthy: false, latencyMs: Date.now() - redisStart };
    }

    // Log DB check
    const logDbStart = Date.now();
    try {
      const logHealth = await logDB.healthCheck();
      checks.logDatabase = { healthy: logHealth.healthy, latencyMs: Date.now() - logDbStart };
    } catch {
      checks.logDatabase = { healthy: false, latencyMs: Date.now() - logDbStart };
    }

    const allHealthy = Object.values(checks).every((c) => c.healthy);

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