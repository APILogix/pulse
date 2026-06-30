import fp from 'fastify-plugin';
import { ProjectsRepository } from './repository.js';
import { projectsRoutes } from './routes.js';
import { ProjectsService } from './service.js';
import { logger } from '../../config/logger.js';
const projectsLogger = logger.child({ component: 'projects-module' });
async function projectsModule(fastify, _options) {
    const repository = new ProjectsRepository();
    // Caching is in-process LRU only (no Redis dependency). The ingestion module
    // still owns its own caches; the projects service only warms/evicts the
    // shared apiKeyCache LRU used for API-key resolution.
    //
    // Projects + API keys are organization-owned resources, so their lifecycle
    // events are written to organization_audit_logs via the organization
    // repository (decorated by the organization module, registered before this
    // module in app.ts).
    const service = new ProjectsService(repository, fastify.log, fastify.organization.repository);
    fastify.decorate('projects', {
        repository,
        service,
    });
    await fastify.register(projectsRoutes, {
        prefix: '/organizations/:orgId/projects',
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