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
import { alertingWorkspaceRoutes } from './workspace/alerting-workspace.routes.js';
import { pool } from '../../config/database.js';
import { logDB } from '../../config/log-database.js';
import { ProjectAlertQueryService } from './runtime/project-alert-query.service.js';
import { projectAlertQueryRoutes } from './runtime/project-alert-query.routes.js';
import { IncidentsRepository } from './incidents/incidents.repository.js';
import { IncidentsService } from './incidents/incidents.service.js';

const moduleLogger = logger.child({ component: 'alerting-module' });

declare module 'fastify' {
  interface FastifyInstance {
    alerting: {
      repository: AlertingRepository;
      service: AlertingService;
      projectAlerts: ProjectAlertQueryService;
      incidents: IncidentsService;
    };
  }
}

async function alertingModule(
  fastify: FastifyInstance,
  _options: FastifyPluginOptions,
): Promise<void> {
  const repository = new AlertingRepository();
  const service = new AlertingService({ repository, logger: fastify.log });
  const projectAlerts = new ProjectAlertQueryService(logDB.getPrimaryPool(), pool);

  // Incidents are control-plane state, so the repository takes the PRIMARY pool.
  // The Log DB pool is passed separately and is used ONLY to enrich timeline /
  // notification views; incident correctness never depends on it.
  const incidents = new IncidentsService({
    repository: new IncidentsRepository(pool),
    logger: fastify.log,
    logDb: logDB.getPrimaryPool(),
  });

  fastify.decorate('alerting', { repository, service, projectAlerts, incidents });

  await fastify.register(alertingWorkspaceRoutes, { prefix: '/organizations/:orgId' });
  await fastify.register(alertingRoutes, { prefix: '/organizations/:orgId/alerting' });
  await fastify.register(projectAlertQueryRoutes, { prefix: '/organizations/:orgId' });

  fastify.addHook('onClose', async () => {
    moduleLogger.info('Alerting module shutting down');
  });

  moduleLogger.info('Alerting module registered');
}

export const registerAlertingModule = fp(alertingModule, { name: 'alerting-module' });

export default registerAlertingModule;
