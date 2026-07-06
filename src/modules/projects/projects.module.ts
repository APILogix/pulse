/**
 * Projects module for Fastify.
 *
 * Flow:
 * 1. Construct project repository and service at boot.
 * 2. Reuse the Redis cache decorator created by the ingestion module for API-key
 *    cache population.
 * 3. Decorate Fastify with project dependencies.
 * 4. Register project routes under the organization-scoped prefix.
 */
import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import fp from 'fastify-plugin';
import { ProjectsRepository } from './repository.js';
import { projectsRoutes } from './routes.js';
import { ProjectsService } from './service.js';
import { logger } from '../../config/logger.js';

const projectsLogger = logger.child({ component: 'projects-module' });

declare module 'fastify' {
  interface FastifyInstance {
    projects: {
      repository: ProjectsRepository;
      service: ProjectsService;
      alertRoutesRepository: import('./alert-routes.repository.js').AlertRoutesRepository;
      alertRoutesService: import('./alert-routes.service.js').ProjectAlertRouteService;
      alertPreferencesRepository: import('./alert-preferences.repository.js').AlertPreferencesRepository;
      alertPreferencesService: import('./alert-preferences.service.js').ProjectMemberAlertPreferenceService;
    };
  }
}

async function projectsModule(
  fastify: FastifyInstance,
  _options: FastifyPluginOptions,
): Promise<void> {
  const repository = new ProjectsRepository();

  // Caching is in-process LRU only (no Redis dependency). The ingestion module
  // still owns its own caches; the projects service only warms/evicts the
  // shared apiKeyCache LRU used for API-key resolution.
  //
  // Projects + API keys are organization-owned resources, so their lifecycle
  // events are written to organization_audit_logs via the organization
  // repository (decorated by the organization module, registered before this
  // module in app.ts).
  const service = new ProjectsService(
    repository,
    fastify.log,
    fastify.organization.repository,
  );

  const { AlertRoutesRepository } = await import('./alert-routes.repository.js');
  const { ProjectAlertRouteService } = await import('./alert-routes.service.js');
  const { AlertPreferencesRepository } = await import('./alert-preferences.repository.js');
  const { ProjectMemberAlertPreferenceService } = await import('./alert-preferences.service.js');
  const { projectAlertRoutes } = await import('./alert-routes.controller.js');
  const { projectAlertPreferencesRoutes } = await import('./alert-preferences.controller.js');

  const alertRoutesRepository = new AlertRoutesRepository();
  const alertPreferencesRepository = new AlertPreferencesRepository();

  const alertRoutesService = new ProjectAlertRouteService(
    alertRoutesRepository,
    service,
    fastify.organization.repository,
    fastify.log
  );

  const alertPreferencesService = new ProjectMemberAlertPreferenceService(
    alertPreferencesRepository,
    alertRoutesRepository,
    service,
    fastify.organization.repository,
    fastify.log
  );

  fastify.decorate('projects', {
    repository,
    service,
    alertRoutesRepository,
    alertRoutesService,
    alertPreferencesRepository,
    alertPreferencesService,
  });

  await fastify.register(projectsRoutes, {
    prefix: '/organizations/:orgId/projects',
  });

  await fastify.register(projectAlertRoutes, {
    prefix: '/organizations/:orgId/projects/:projectId/alert-routes',
  });

  await fastify.register(projectAlertPreferencesRoutes, {
    prefix: '/organizations/:orgId/projects/:projectId/members/me/alert-preferences',
  });

  fastify.addHook('onClose', async () => {
    projectsLogger.info('Projects module shutting down');
  });

  projectsLogger.info('Projects module registered');
}

export const registerProjectsModule = fp(projectsModule, {
  name: 'projects-module',
  dependencies: ['organization-module'],
});

export default registerProjectsModule;
