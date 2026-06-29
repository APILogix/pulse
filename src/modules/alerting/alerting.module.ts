/**
 * Alerting module for Fastify.
 *
 * Flow:
 * 1. Construct the alerting repository + service at boot.
 * 2. Decorate Fastify with the alerting service boundary.
 * 3. Register alerting routes under /organizations/:orgId/alerting.
 *
 * Background processing (batch delivery, auto-resolve) runs in the WORKER
 * process via registerAlertingWorkers() (see workers/main.ts), not here — the
 * API process stays thin and only ingests events into `pending`.
 */
import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import fp from 'fastify-plugin';
import { logger } from '../../config/logger.js';
import { AlertingRepository } from './repository.js';
import { AlertingService } from './service.js';
import { alertingRoutes } from './routes.js';

const moduleLogger = logger.child({ component: 'alerting-module' });

declare module 'fastify' {
  interface FastifyInstance {
    alerting: {
      repository: AlertingRepository;
      service: AlertingService;
    };
  }
}

async function alertingModule(
  fastify: FastifyInstance,
  _options: FastifyPluginOptions,
): Promise<void> {
  const repository = new AlertingRepository();
  const service = new AlertingService({ repository, logger: fastify.log });

  fastify.decorate('alerting', { repository, service });

  await fastify.register(alertingRoutes, { prefix: '/organizations/:orgId/alerting' });

  fastify.addHook('onClose', async () => {
    moduleLogger.info('Alerting module shutting down');
  });

  moduleLogger.info('Alerting module registered');
}

export const registerAlertingModule = fp(alertingModule, { name: 'alerting-module' });

export default registerAlertingModule;
