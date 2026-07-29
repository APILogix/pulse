import { z } from "zod";
import { authenticate } from "../../../../shared/middleware/auth.js";
import { rateLimit } from "../../../../shared/middleware/rate-limit.js";
import { ProjectParamsSchema } from "../../types.js";
import { withErrorHandling, authenticatedUser } from "../../shared/route-utils.js";
const DeliveryListQuerySchema = z.object({
    status: z.string().min(1).max(30).optional(),
    severity: z.string().min(1).max(30).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).default(0),
});
const DeadLetterListQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).default(0),
});
const DeadLetterParamsSchema = ProjectParamsSchema.extend({
    deliveryId: z.string().uuid(),
});
export async function projectDeliveryLogRoutes(fastify) {
    const service = fastify.projects.deliveryLogService;
    const deliveryRateLimit = rateLimit({ max: 120, window: 60 });
    // Alert delivery history
    fastify.get("/:projectId/alert-deliveries", { preHandler: [authenticate, deliveryRateLimit] }, withErrorHandling(async (request, reply) => {
        const { orgId, projectId } = ProjectParamsSchema.parse(request.params);
        const query = DeliveryListQuerySchema.parse(request.query ?? {});
        const result = await service.listDeliveries(orgId, projectId, authenticatedUser(request).id, query);
        return reply.send({
            success: true,
            data: result.data,
            meta: { total: result.total, limit: query.limit, offset: query.offset },
        });
    }));
    // Dead-letter queue listing
    fastify.get("/:projectId/dead-letters", { preHandler: [authenticate, deliveryRateLimit] }, withErrorHandling(async (request, reply) => {
        const { orgId, projectId } = ProjectParamsSchema.parse(request.params);
        const query = DeadLetterListQuerySchema.parse(request.query ?? {});
        const result = await service.listDeadLetters(orgId, projectId, authenticatedUser(request).id, query);
        return reply.send({
            success: true,
            data: result.data,
            meta: { total: result.total, limit: query.limit, offset: query.offset },
        });
    }));
    // Reprocess every dead-letter for the project.
    // Registered before the parameterized ":deliveryId" route so "reprocess-all"
    // is never captured as a deliveryId.
    fastify.post("/:projectId/dead-letters/reprocess-all", { preHandler: [authenticate, deliveryRateLimit] }, withErrorHandling(async (request, reply) => {
        const { orgId, projectId } = ProjectParamsSchema.parse(request.params);
        const reprocessed = await service.reprocessAll(orgId, projectId, authenticatedUser(request).id);
        return reply.send({ success: true, data: { reprocessed } });
    }));
    // Reprocess a single dead-letter delivery.
    fastify.post("/:projectId/dead-letters/:deliveryId/reprocess", { preHandler: [authenticate, deliveryRateLimit] }, withErrorHandling(async (request, reply) => {
        const { orgId, projectId, deliveryId } = DeadLetterParamsSchema.parse(request.params);
        const ok = await service.reprocessDeadLetter(orgId, projectId, authenticatedUser(request).id, deliveryId);
        if (!ok) {
            return reply
                .code(404)
                .send({ success: false, error: { code: "NOT_FOUND", message: "Dead-letter delivery not found" } });
        }
        return reply.send({ success: true, data: { reprocessed: true } });
    }));
    // Purge (discard) the entire dead-letter queue for the project.
    fastify.delete("/:projectId/dead-letters", { preHandler: [authenticate, deliveryRateLimit] }, withErrorHandling(async (request, reply) => {
        const { orgId, projectId } = ProjectParamsSchema.parse(request.params);
        const discarded = await service.purgeQueue(orgId, projectId, authenticatedUser(request).id);
        return reply.send({ success: true, data: { discarded } });
    }));
    // Discard a single dead-letter delivery.
    fastify.delete("/:projectId/dead-letters/:deliveryId", { preHandler: [authenticate, deliveryRateLimit] }, withErrorHandling(async (request, reply) => {
        const { orgId, projectId, deliveryId } = DeadLetterParamsSchema.parse(request.params);
        const ok = await service.discardDeadLetter(orgId, projectId, authenticatedUser(request).id, deliveryId);
        if (!ok) {
            return reply
                .code(404)
                .send({ success: false, error: { code: "NOT_FOUND", message: "Dead-letter delivery not found" } });
        }
        return reply.send({ success: true, data: { discarded: true } });
    }));
}
//# sourceMappingURL=delivery-log.routes.js.map