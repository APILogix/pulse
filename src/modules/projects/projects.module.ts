import type { FastifyInstance, FastifyPluginOptions } from "fastify";
import fp from "fastify-plugin";
import { ProjectsRepository } from "./repository.js";
import { projectsRoutes } from "./routes.js";
import { ProjectsService } from "./service.js";

declare module "fastify" {
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

  fastify.decorate("projects", {
    repository,
    service,
  });

  await fastify.register(projectsRoutes, {
    prefix: "/organizations/:orgId/projects",
  });
}

export const registerProjectsModule = fp(projectsModule, {
  name: "projects-module",
});

export default registerProjectsModule;
