import fp from 'fastify-plugin';
import { ProjectsRepository } from './repository.js';
import { SettingsRepository } from './settings/settings.repository.js';
import { ApiKeyRepository } from './api-keys/api-key.repository.js';
import { EnvironmentRepository } from './environments/environment.repository.js';
import { ActivityRepository } from './activity/activity.repository.js';
import { UsageRepository } from './usage/usage.repository.js';
import { MemberRepository } from './members/member.repository.js';
import { projectsRoutes } from './routes.js';
import { projectMemberRoutes } from './members/member.routes.js';
import { projectConnectorSubscriptionRoutes } from './alerts/subscriptions/connector-subscription.routes.js';
import { ProjectsService } from './service.js';
import { logger } from '../../config/logger.js';
import { pool } from '../../config/database.js';
const projectsLogger = logger.child({ component: 'projects-module' });
async function projectsModule(fastify, _options) {
    const repository = new ProjectsRepository(pool);
    const settingsRepository = new SettingsRepository();
    const apiKeyRepository = new ApiKeyRepository();
    const environmentRepository = new EnvironmentRepository();
    const activityRepository = new ActivityRepository();
    const usageRepository = new UsageRepository();
    const membersRepository = new MemberRepository(pool);
    // Caching is in-process LRU only (no Redis dependency). The ingestion module
    // still owns its own caches; the projects service only warms/evicts the
    // shared apiKeyCache LRU used for API-key resolution.
    //
    // Projects + API keys are organization-owned resources, so their lifecycle
    // events are written to organization_audit_logs via the organization
    // repository (decorated by the organization module, registered before this
    // module in app.ts).
    const service = new ProjectsService(repository, fastify.log, fastify.organization.repository, settingsRepository, apiKeyRepository, environmentRepository, activityRepository, usageRepository);
    const { AlertRoutesRepository } = await import('./alerts/routes/alert-routes.repository.js');
    const { ProjectAlertRouteService } = await import('./alerts/routes/alert-routes.service.js');
    const { AlertPreferencesRepository } = await import('./alerts/preferences/alert-preferences.repository.js');
    const { ProjectMemberAlertPreferenceService } = await import('./alerts/preferences/alert-preferences.service.js');
    const { projectAlertRoutes } = await import('./alerts/routes/alert-routes.controller.js');
    const { projectAlertPreferencesRoutes } = await import('./alerts/preferences/alert-preferences.controller.js');
    const alertRoutesRepository = new AlertRoutesRepository();
    const alertPreferencesRepository = new AlertPreferencesRepository();
    const alertRoutesService = new ProjectAlertRouteService(alertRoutesRepository, service, fastify.organization.repository, fastify.log);
    const alertPreferencesService = new ProjectMemberAlertPreferenceService(alertPreferencesRepository, service, fastify.organization.repository, fastify.log);
    fastify.decorate('projects', {
        repository,
        settingsRepository,
        apiKeyRepository,
        environmentRepository,
        activityRepository,
        usageRepository,
        membersRepository,
        connectorSubscriptionsService: service.connectorSubscriptions,
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
//# sourceMappingURL=projects.module.js.map