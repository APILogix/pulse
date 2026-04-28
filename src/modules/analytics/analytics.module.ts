import type { FastifyInstance, FastifyPluginOptions } from "fastify";
import fp from "fastify-plugin";
import { pool } from "../../config/database.js";
import { redis } from "../../config/redis.js";
import { AnalyticsCache } from "./cache.js";
import { AnalyticsRepository } from "./repository.js";
import { analyticsRoutes } from "./routes.js";
import { AnalyticsService } from "./service.js";

declare module "fastify" {
  interface FastifyInstance {
    analytics: {
      cache: AnalyticsCache;
      repository: AnalyticsRepository;
      service: AnalyticsService;
    };
  }
}

async function analyticsModule(
  fastify: FastifyInstance,
  _options: FastifyPluginOptions,
): Promise<void> {
  const repository = new AnalyticsRepository(pool);
  const cache = new AnalyticsCache(redis);
  const service = new AnalyticsService(repository, cache);

  fastify.decorate("analytics", {
    cache,
    repository,
    service,
  });

  await fastify.register(analyticsRoutes, { prefix: "/analytics" });

  fastify.addHook("onClose", async () => {
    fastify.log.info("Analytics module shutting down");
  });
}

export const registerAnalyticsModule = fp(analyticsModule, {
  name: "analytics-module",
});

export default registerAnalyticsModule;
