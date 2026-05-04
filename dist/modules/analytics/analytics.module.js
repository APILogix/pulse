import fp from "fastify-plugin";
import { pool } from "../../config/database.js";
import { redis } from "../../config/redis.js";
import { AnalyticsCache } from "./cache.js";
import { AnalyticsRepository } from "./repository.js";
import { analyticsRoutes } from "./routes.js";
import { AnalyticsService } from "./service.js";
async function analyticsModule(fastify, _options) {
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
//# sourceMappingURL=analytics.module.js.map