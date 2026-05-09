/**
 * Analytics module for Fastify.
 *
 * Flow:
 * 1. Construct repository (with shared pool), cache (with shared Redis), and service.
 * 2. Decorate Fastify with analytics dependencies.
 * 3. Register analytics routes under /analytics.
 */

import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import fp from 'fastify-plugin';
import { pool } from '../../config/database.js';
import { redis } from '../../config/redis.js';
import { logger } from '../../config/logger.js';
import { AnalyticsCache } from './cache.js';
import { AnalyticsRepository } from './repository.js';
import { analyticsRoutes } from './routes.js';
import { AnalyticsService } from './service.js';

const analyticsLogger = logger.child({ component: 'analytics-module' });

declare module 'fastify' {
  interface FastifyInstance {
    analytics: {
      cache: AnalyticsCache;
      repository: AnalyticsRepository;
      service: AnalyticsService;
    };
  }
}

async function analyticsModule(
  fastify: FastifyInstance,
  _options: FastifyPluginOptions,
): Promise<void> {
  const repository = new AnalyticsRepository(pool);
  const cache = new AnalyticsCache(redis);
  const service = new AnalyticsService(repository, cache);

  fastify.decorate('analytics', {
    cache,
    repository,
    service,
  });

  await fastify.register(analyticsRoutes, { prefix: '/analytics' });

  fastify.addHook('onClose', async () => {
    analyticsLogger.info('Analytics module shutting down');
  });

  analyticsLogger.info('Analytics module registered');
}

export const registerAnalyticsModule = fp(analyticsModule, {
  name: 'analytics-module',
});

export default registerAnalyticsModule;
