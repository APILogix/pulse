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
import { SettingsRepository } from './settings.repository.js';
import { ApiKeyRepository } from './api-key.repository.js';
import { UsageRepository } from './usage.repository.js';
import { ProjectsService } from './service.js';
declare module 'fastify' {
    interface FastifyInstance {
        projects: {
            repository: ProjectsRepository;
            settingsRepository: SettingsRepository;
            apiKeyRepository: ApiKeyRepository;
            usageRepository: UsageRepository;
            service: ProjectsService;
            alertRoutesRepository: import('./alert-routes.repository.js').AlertRoutesRepository;
            alertRoutesService: import('./alert-routes.service.js').ProjectAlertRouteService;
            alertPreferencesRepository: import('./alert-preferences.repository.js').AlertPreferencesRepository;
            alertPreferencesService: import('./alert-preferences.service.js').ProjectMemberAlertPreferenceService;
        };
    }
}
declare function projectsModule(fastify: FastifyInstance, _options: FastifyPluginOptions): Promise<void>;
export declare const registerProjectsModule: typeof projectsModule;
export default registerProjectsModule;
//# sourceMappingURL=projects.module.d.ts.map