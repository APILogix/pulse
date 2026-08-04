/**
 * Analytics module for Fastify.
 *
 * Flow:
 * 1. Construct the Log DB repository, in-process LRU cache, and service.
 * 2. Decorate Fastify with analytics dependencies.
 * 3. Register analytics routes under /analytics.
 */

import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import fp from 'fastify-plugin';
import { logDB } from '../../config/log-database.js';
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
  const repository = new AnalyticsRepository(logDB.getPrimaryPool());
  // In-process LRU cache only (no Redis dependency).
  const cache = new AnalyticsCache();
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
