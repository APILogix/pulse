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
import { SettingsRepository } from './settings/settings.repository.js';
import { ApiKeyRepository } from './api-keys/api-key.repository.js';
import { EnvironmentRepository } from './environments/environment.repository.js';
import { ActivityRepository } from './activity/activity.repository.js';
import { UsageRepository } from './usage/usage.repository.js';
import { projectsRoutes } from './routes.js';
import { ProjectsService } from './service.js';
import { logger } from '../../config/logger.js';

const projectsLogger = logger.child({ component: 'projects-module' });

declare module 'fastify' {
  interface FastifyInstance {
    projects: {
      repository: ProjectsRepository;
      settingsRepository: SettingsRepository;
      apiKeyRepository: ApiKeyRepository;
      environmentRepository: EnvironmentRepository;
      activityRepository: ActivityRepository;
      usageRepository: UsageRepository;
      service: ProjectsService;
      alertRoutesRepository: import('./alerts/routes/alert-routes.repository.js').AlertRoutesRepository;
      alertRoutesService: import('./alerts/routes/alert-routes.service.js').ProjectAlertRouteService;
      alertPreferencesRepository: import('./alerts/preferences/alert-preferences.repository.js').AlertPreferencesRepository;
      alertPreferencesService: import('./alerts/preferences/alert-preferences.service.js').ProjectMemberAlertPreferenceService;
    };
  }
}

async function projectsModule(
  fastify: FastifyInstance,
  _options: FastifyPluginOptions,
): Promise<void> {
  const repository = new ProjectsRepository();
  const settingsRepository = new SettingsRepository();
  const apiKeyRepository = new ApiKeyRepository();
  const environmentRepository = new EnvironmentRepository();
  const activityRepository = new ActivityRepository();
  const usageRepository = new UsageRepository();

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
    settingsRepository,
    apiKeyRepository,
    environmentRepository,
    activityRepository,
    usageRepository
  );

  const { AlertRoutesRepository } = await import('./alerts/routes/alert-routes.repository.js');
  const { ProjectAlertRouteService } = await import('./alerts/routes/alert-routes.service.js');
  const { AlertPreferencesRepository } = await import('./alerts/preferences/alert-preferences.repository.js');
  const { ProjectMemberAlertPreferenceService } = await import('./alerts/preferences/alert-preferences.service.js');
  const { projectAlertRoutes } = await import('./alerts/routes/alert-routes.controller.js');
  const { projectAlertPreferencesRoutes } = await import('./alerts/preferences/alert-preferences.controller.js');

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
    settingsRepository,
    apiKeyRepository,
    environmentRepository,
    activityRepository,
    usageRepository,
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
