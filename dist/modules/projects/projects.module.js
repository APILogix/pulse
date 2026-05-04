import fp from "fastify-plugin";
import { ProjectsRepository } from "./repository.js";
import { projectsRoutes } from "./routes.js";
import { ProjectsService } from "./service.js";
async function projectsModule(fastify, _options) {
    // Project service depends on Redis cache because API-key creation primes the
    // same cache the ingestion service reads on the hot path.
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
//# sourceMappingURL=projects.module.js.map