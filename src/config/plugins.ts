import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { pool } from './database.js';
import { logDB } from './log-database.js';
import { redis } from './redis.js';
import { logger } from './logger.js';

const healthLogger = logger.child({ component: 'health' });

const DEPENDENCY_TIMEOUT_MS = 3000;

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeoutId: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error('Health check timeout')), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timeoutId!);
  }
}

/**
 * Health & Readiness Plugin
 *
 * Exposes Kubernetes-standard probe endpoints:
 * - /health  — shallow liveness (process is running)
 * - /live    — alias for liveness (always 200 if process is up)
 * - /ready   — deep readiness (checks DB, Redis, Log DB)
 * - /metrics — Prometheus metrics (registered via metrics plugin)
 *
 * Wrapped in fastify-plugin so these routes are available at the root scope.
 */
async function healthPlugin(fastify: FastifyInstance): Promise<void> {

  // Liveness probe — always returns 200 if the process is running.
  fastify.get('/health', async () => ({
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

  fastify.get('/live', async () => ({ status: 'alive' }));

  // Readiness probe — verifies all critical dependencies with timeout.
  fastify.get('/ready', async (_request, reply) => {
    const checks: Record<string, { healthy: boolean; latencyMs?: number; error?: string }> = {};

    // Primary DB check with timeout
    const dbStart = Date.now();
    try {
      await withTimeout(pool.query('SELECT 1'), DEPENDENCY_TIMEOUT_MS);
      checks.database = { healthy: true, latencyMs: Date.now() - dbStart };
    } catch (err) {
      checks.database = { healthy: false, latencyMs: Date.now() - dbStart, error: (err as Error).message };
    }

    // Redis check with timeout
    const redisStart = Date.now();
    try {
      await withTimeout(redis.ping(), DEPENDENCY_TIMEOUT_MS);
      checks.redis = { healthy: true, latencyMs: Date.now() - redisStart };
    } catch (err) {
      checks.redis = { healthy: false, latencyMs: Date.now() - redisStart, error: (err as Error).message };
    }

    // Log DB check with timeout
    const logDbStart = Date.now();
    try {
      const logHealth = await withTimeout(logDB.healthCheck(), DEPENDENCY_TIMEOUT_MS);
      checks.logDatabase = { healthy: logHealth.healthy, latencyMs: Date.now() - logDbStart };
    } catch (err) {
      checks.logDatabase = { healthy: false, latencyMs: Date.now() - logDbStart, error: (err as Error).message };
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