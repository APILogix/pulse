import fp from 'fastify-plugin';
import { ProjectsRepository } from './repository.js';
import { projectsRoutes } from './routes.js';
import { ProjectsService } from './service.js';
import { logger } from '../../config/logger.js';
const projectsLogger = logger.child({ component: 'projects-module' });
async function projectsModule(fastify, _options) {
    const repository = new ProjectsRepository();
    // fastify.redisCache is decorated by the ingestion module, which is
    // registered before this module in app.ts — so it is always available here.
    const service = new ProjectsService(repository, fastify.log, fastify.redisCache);
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
    dependencies: ['ingestion-module'], // Explicit dependency on ingestion for redisCache
});
export default registerProjectsModule;
//# sourceMappingURL=projects.module.js.map