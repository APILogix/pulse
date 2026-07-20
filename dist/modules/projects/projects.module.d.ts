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
import { ProjectsRepository } from './repository.js';
import { SettingsRepository } from './settings/settings.repository.js';
import { ApiKeyRepository } from './api-keys/api-key.repository.js';
import { EnvironmentRepository } from './environments/environment.repository.js';
import { ActivityRepository } from './activity/activity.repository.js';
import { UsageRepository } from './usage/usage.repository.js';
import { MemberRepository } from './members/member.repository.js';
import { ProjectsService } from './service.js';
declare module 'fastify' {
    interface FastifyInstance {
        projects: {
            repository: ProjectsRepository;
            settingsRepository: SettingsRepository;
            apiKeyRepository: ApiKeyRepository;
            environmentRepository: EnvironmentRepository;
            activityRepository: ActivityRepository;
            usageRepository: UsageRepository;
            membersRepository: MemberRepository;
            connectorSubscriptionsService: import('./alerts/subscriptions/connector-subscription.service.js').ProjectConnectorSubscriptionService;
            service: ProjectsService;
            alertRoutesRepository: import('./alerts/routes/alert-routes.repository.js').AlertRoutesRepository;
            alertRoutesService: import('./alerts/routes/alert-routes.service.js').ProjectAlertRouteService;
            alertPreferencesRepository: import('./alerts/preferences/alert-preferences.repository.js').AlertPreferencesRepository;
            alertPreferencesService: import('./alerts/preferences/alert-preferences.service.js').ProjectMemberAlertPreferenceService;
        };
    }
}
declare function projectsModule(fastify: FastifyInstance, _options: FastifyPluginOptions): Promise<void>;
export declare const registerProjectsModule: typeof projectsModule;
export default registerProjectsModule;
//# sourceMappingURL=projects.module.d.ts.map