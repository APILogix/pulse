import { authenticate } from "../../../../shared/middleware/auth.js";
import { authenticatedUser, requestMeta, withErrorHandling, } from "../../shared/route-utils.js";
import { CreateThresholdBodySchema, ListThresholdsQuerySchema, ProjectThresholdParamsSchema, ThresholdDetailParamsSchema, ToggleThresholdBodySchema, UpdateThresholdBodySchema, } from "./threshold.types.js";
/** Mount with prefix /organizations/:orgId/projects/:projectId/alert-thresholds. */
export async function thresholdRoutes(fastify, options) {
    const service = options.service ?? fastify.projects.alertThresholdsService;
    fastify.get("/", { preHandler: [authenticate] }, withErrorHandling(async (request, reply) => {
        const { orgId, projectId } = ProjectThresholdParamsSchema.parse(request.params);
        const query = ListThresholdsQuerySchema.parse(request.query ?? {});
        const result = await service.list(orgId, projectId, authenticatedUser(request).id, query);
        return reply.send({
            success: true,
            data: result.thresholds,
            meta: { total: result.total, limit: result.limit, offset: result.offset },
        });
    }));
    fastify.get("/:thresholdId", { preHandler: [authenticate] }, withErrorHandling(async (request, reply) => {
        const { orgId, projectId, thresholdId } = ThresholdDetailParamsSchema.parse(request.params);
        const threshold = await service.get(orgId, projectId, thresholdId, authenticatedUser(request).id);
        return reply.send({ success: true, data: threshold });
    }));
    fastify.post("/", { preHandler: [authenticate] }, withErrorHandling(async (request, reply) => {
        const { orgId, projectId } = ProjectThresholdParamsSchema.parse(request.params);
        const body = CreateThresholdBodySchema.parse(request.body);
        const threshold = await service.create(orgId, projectId, authenticatedUser(request).id, body, requestMeta(request));
        return reply.code(201).send({ success: true, data: threshold });
    }));
    fastify.patch("/:thresholdId", { preHandler: [authenticate] }, withErrorHandling(async (request, reply) => {
        const { orgId, projectId, thresholdId } = ThresholdDetailParamsSchema.parse(request.params);
        const body = UpdateThresholdBodySchema.parse(request.body);
        const threshold = await service.update(orgId, projectId, thresholdId, authenticatedUser(request).id, body, requestMeta(request));
        return reply.send({ success: true, data: threshold });
    }));
    fastify.delete("/:thresholdId", { preHandler: [authenticate] }, withErrorHandling(async (request, reply) => {
        const { orgId, projectId, thresholdId } = ThresholdDetailParamsSchema.parse(request.params);
        await service.delete(orgId, projectId, thresholdId, authenticatedUser(request).id, requestMeta(request));
        return reply.code(204).send();
    }));
    fastify.post("/:thresholdId/toggle", { preHandler: [authenticate] }, withErrorHandling(async (request, reply) => {
        const { orgId, projectId, thresholdId } = ThresholdDetailParamsSchema.parse(request.params);
        const body = ToggleThresholdBodySchema.parse(request.body);
        const threshold = await service.toggle(orgId, projectId, thresholdId, authenticatedUser(request).id, body, requestMeta(request));
        return reply.send({ success: true, data: threshold });
    }));
}
//# sourceMappingURL=threshold.routes.js.map