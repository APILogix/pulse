/**
 * Event-analytics module for Fastify.
 *
 * Pulse SDK event analytics over the events_* / analytics_* tables (migration
 * 004). Organization-scoped, read-optimized. No cache, no rate limiting.
 *
 * Distinct from the existing project-scoped `analytics` module (telemetry).
 * Background rollup workers run in the worker process (see workers/main.ts).
 */
import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import fp from 'fastify-plugin';
import { pool } from '../../config/database.js';
import { logger } from '../../config/logger.js';
import { EventAnalyticsRepository } from './repository.js';
import { EventAnalyticsService } from './service.js';
import { eventAnalyticsRoutes } from './routes.js';

const moduleLogger = logger.child({ component: 'event-analytics-module' });

declare module 'fastify' {
  interface FastifyInstance {
    eventAnalytics: {
      repository: EventAnalyticsRepository;
      service: EventAnalyticsService;
    };
  }
}

async function eventAnalyticsModule(
  fastify: FastifyInstance,
  _options: FastifyPluginOptions,
): Promise<void> {
  const repository = new EventAnalyticsRepository(pool);
  const service = new EventAnalyticsService(repository, fastify.log);

  fastify.decorate('eventAnalytics', { repository, service });

  await fastify.register(eventAnalyticsRoutes, { prefix: '/organizations/:orgId/analytics' });

  fastify.addHook('onClose', async () => {
    moduleLogger.info('Event-analytics module shutting down');
  });

  moduleLogger.info('Event-analytics module registered');
}

export const registerEventAnalyticsModule = fp(eventAnalyticsModule, { name: 'event-analytics-module' });

export default registerEventAnalyticsModule;
