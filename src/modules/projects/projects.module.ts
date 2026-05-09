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
    };
  }
}

async function projectsModule(
  fastify: FastifyInstance,
  _options: FastifyPluginOptions,
): Promise<void> {
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
