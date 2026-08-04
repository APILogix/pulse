import { authenticate } from "../../../shared/middleware/auth.js";
import { ProjectParamsSchema } from "../types.js";
import { ComparisonQuerySchema, HeatmapQuerySchema, TopListQuerySchema, UsageAnalyticsQuerySchema, } from "./analytics.types.js";
import { withErrorHandling, authenticatedUser } from "../shared/route-utils.js";
export async function projectAnalyticsRoutes(fastify) {
    const service = fastify.projects.service;
    const analytics = service.analytics;
    fastify.get("/:projectId/analytics/usage", { preHandler: [authenticate] }, withErrorHandling(async (request, reply) => {
        const { orgId, projectId } = ProjectParamsSchema.parse(request.params);
        const query = UsageAnalyticsQuerySchema.parse(request.query ?? {});
        const result = await analytics.getUsageAnalytics(orgId, projectId, authenticatedUser(request).id, query);
        return reply.send({ success: true, data: result });
    }));
    fastify.get("/:projectId/analytics/heatmap", { preHandler: [authenticate] }, withErrorHandling(async (request, reply) => {
        const { orgId, projectId } = ProjectParamsSchema.parse(request.params);
        const query = HeatmapQuerySchema.parse(request.query ?? {});
        const result = await analytics.getHeatmap(orgId, projectId, authenticatedUser(request).id, query);
        return reply.send({ success: true, data: result });
    }));
    fastify.get("/:projectId/analytics/top", { preHandler: [authenticate] }, withErrorHandling(async (request, reply) => {
        const { orgId, projectId } = ProjectParamsSchema.parse(request.params);
        const query = TopListQuerySchema.parse(request.query ?? {});
        const result = await analytics.getTopList(orgId, projectId, authenticatedUser(request).id, query);
        return reply.send({ success: true, data: result });
    }));
    fastify.get("/:projectId/analytics/comparison", { preHandler: [authenticate] }, withErrorHandling(async (request, reply) => {
        const { orgId, projectId } = ProjectParamsSchema.parse(request.params);
        const query = ComparisonQuerySchema.parse(request.query ?? {});
        const result = await analytics.getComparison(orgId, projectId, authenticatedUser(request).id, query);
        return reply.send({ success: true, data: result });
    }));
    fastify.get("/:projectId/analytics/monthly-usage", { preHandler: [authenticate] }, withErrorHandling(async (request, reply) => {
        const { orgId, projectId } = ProjectParamsSchema.parse(request.params);
        const result = await analytics.getMonthlyUsageVsPlan(orgId, projectId, authenticatedUser(request).id);
        return reply.send({ success: true, data: result });
    }));
}
//# sourceMappingURL=analytics.routes.js.map