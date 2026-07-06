import { authenticate } from "../../shared/middleware/auth.js";
import { CreateProjectAlertRouteBodySchema, UpdateProjectAlertRouteBodySchema, ToggleProjectAlertRouteBodySchema, ListProjectAlertRoutesQuerySchema, } from "./alert-routes.types.js";
import { ProjectParamsSchema } from "./types.js";
import { z } from "zod";
function requestMeta(request) {
    const userAgent = request.headers["user-agent"];
    const user = request.user;
    return {
        actorUserId: user.id,
        actorEmail: user.email ?? null,
        actorSessionId: user.sessionId ?? null,
        actorIp: request.ip ?? "0.0.0.0",
        actorUserAgent: typeof userAgent === "string" ? userAgent : null,
        requestId: request.id,
        httpMethod: request.method,
        endpoint: request.url,
    };
}
export async function projectAlertRoutes(fastify) {
    const service = fastify.projects.alertRoutesService;
    fastify.post("/", { preHandler: [authenticate] }, async (request, reply) => {
        const { orgId, projectId } = ProjectParamsSchema.parse(request.params);
        const body = CreateProjectAlertRouteBodySchema.parse(request.body);
        const route = await service.createRoute(orgId, projectId, request.user.id, body, requestMeta(request));
        return reply.code(201).send({ success: true, data: route });
    });
    fastify.get("/", { preHandler: [authenticate] }, async (request, reply) => {
        const { orgId, projectId } = ProjectParamsSchema.parse(request.params);
        const query = ListProjectAlertRoutesQuerySchema.parse(request.query ?? {});
        const result = await service.listRoutes(orgId, projectId, request.user.id, query);
        return reply.send({ success: true, data: result.routes, meta: { limit: result.limit, offset: result.offset } });
    });
    fastify.get("/:routeId", { preHandler: [authenticate] }, async (request, reply) => {
        const paramsSchema = ProjectParamsSchema.extend({ routeId: z.string().uuid() });
        const { orgId, projectId, routeId } = paramsSchema.parse(request.params);
        const route = await service.getRoute(routeId, orgId, projectId, request.user.id);
        return reply.send({ success: true, data: route });
    });
    fastify.patch("/:routeId", { preHandler: [authenticate] }, async (request, reply) => {
        const paramsSchema = ProjectParamsSchema.extend({ routeId: z.string().uuid() });
        const { orgId, projectId, routeId } = paramsSchema.parse(request.params);
        const body = UpdateProjectAlertRouteBodySchema.parse(request.body);
        const route = await service.updateRoute(routeId, orgId, projectId, request.user.id, body, requestMeta(request));
        return reply.send({ success: true, data: route });
    });
    fastify.delete("/:routeId", { preHandler: [authenticate] }, async (request, reply) => {
        const paramsSchema = ProjectParamsSchema.extend({ routeId: z.string().uuid() });
        const { orgId, projectId, routeId } = paramsSchema.parse(request.params);
        await service.deleteRoute(routeId, orgId, projectId, request.user.id, requestMeta(request));
        return reply.code(204).send();
    });
    fastify.post("/:routeId/toggle", { preHandler: [authenticate] }, async (request, reply) => {
        const paramsSchema = ProjectParamsSchema.extend({ routeId: z.string().uuid() });
        const { orgId, projectId, routeId } = paramsSchema.parse(request.params);
        const body = ToggleProjectAlertRouteBodySchema.parse(request.body);
        const route = await service.toggleRoute(routeId, orgId, projectId, request.user.id, body.is_active, requestMeta(request));
        return reply.send({ success: true, data: route });
    });
}
//# sourceMappingURL=alert-routes.controller.js.map