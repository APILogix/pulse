import { authenticate } from "../../../shared/middleware/auth.js";
import { rateLimit } from "../../../shared/middleware/rate-limit.js";
import { idempotency, cacheIdempotencyResponse } from "../../../shared/middleware/idempotency.js";
import { CreateProjectBodySchema, ListProjectsQuerySchema, OrgIdParamsSchema, ProjectByPublicIdParamsSchema, ProjectParamsSchema, UpdateProjectBodySchema, } from "../types.js";
import { handleProjectError, ProjectError } from "../shared/utils.js";
import { requestMeta, authenticatedUser, withErrorHandling } from "../shared/route-utils.js";
export async function projectCoreRoutes(fastify) {
    const service = fastify.projects.service;
    const readRateLimit = rateLimit({ max: 120, window: 60 });
    const writeRateLimit = rateLimit({ max: 30, window: 60 });
    const idempotencyKey = idempotency();
    fastify.addHook("onSend", async (request, reply, payload) => {
        await cacheIdempotencyResponse(request, reply, payload);
    });
    // ── Project CRUD ──────────────────────────────────────────────────────────
    fastify.get("/", { preHandler: [authenticate, readRateLimit] }, withErrorHandling(async (request, reply) => {
        const { orgId } = OrgIdParamsSchema.parse(request.params);
        const query = ListProjectsQuerySchema.parse(request.query ?? {});
        const result = await service.listProjects(orgId, authenticatedUser(request).id, query);
        return reply.send({
            success: true,
            data: result.projects,
            meta: { total: result.total, limit: result.limit, offset: result.offset },
        });
    }));
    fastify.post("/", { preHandler: [authenticate, writeRateLimit, idempotencyKey] }, withErrorHandling(async (request, reply) => {
        const { orgId } = OrgIdParamsSchema.parse(request.params);
        const body = CreateProjectBodySchema.parse(request.body);
        const result = await service.createProject(orgId, authenticatedUser(request).id, body, requestMeta(request));
        // The Production environment, its SDK configuration, and the initial API
        // key are all provisioned with the project. `fullKey` is shown exactly once.
        return reply.code(201).send({
            success: true,
            data: {
                id: result.project.id,
                projectId: result.project.id,
                project: result.project,
                environment: result.environment,
                apiKey: result.apiKey,
                fullKey: result.fullKey,
            },
        });
    }));
    // ── Resolve by public ID (for frontend routing) ───────────────────────────
    // IMPORTANT: This route must be registered BEFORE /:projectId to prevent
    // "by-public-id" from being captured as a projectId param.
    fastify.get("/by-public-id/:publicId", { preHandler: [authenticate, readRateLimit] }, withErrorHandling(async (request, reply) => {
        const { orgId, publicId } = ProjectByPublicIdParamsSchema.parse(request.params);
        const project = await service.getProjectByPublicId(orgId, publicId, authenticatedUser(request).id);
        return reply.send({ success: true, data: project });
    }));
    fastify.get("/:projectId", { preHandler: [authenticate, readRateLimit] }, withErrorHandling(async (request, reply) => {
        const { orgId, projectId } = ProjectParamsSchema.parse(request.params);
        const project = await service.getProject(orgId, projectId, authenticatedUser(request).id);
        return reply.send({ success: true, data: project });
    }));
    fastify.get("/:projectId/stats", { preHandler: [authenticate, readRateLimit] }, withErrorHandling(async (request, reply) => {
        const { orgId, projectId } = ProjectParamsSchema.parse(request.params);
        const project = await service.getProjectStats(orgId, projectId, authenticatedUser(request).id);
        return reply.send({ success: true, data: project });
    }));
    fastify.get("/:projectId/usage", { preHandler: [authenticate, readRateLimit] }, withErrorHandling(async (request, reply) => {
        const { orgId, projectId } = ProjectParamsSchema.parse(request.params);
        const usage = await service.getProjectUsage(orgId, projectId, authenticatedUser(request).id);
        return reply.send({ success: true, data: usage });
    }));
    fastify.patch("/:projectId", { preHandler: [authenticate, writeRateLimit, idempotencyKey] }, withErrorHandling(async (request, reply) => {
        const { orgId, projectId } = ProjectParamsSchema.parse(request.params);
        const body = UpdateProjectBodySchema.parse(request.body);
        const project = await service.updateProject(orgId, projectId, authenticatedUser(request).id, body, requestMeta(request));
        return reply.send({ success: true, data: project });
    }));
    fastify.delete("/:projectId", { preHandler: [authenticate, writeRateLimit, idempotencyKey] }, withErrorHandling(async (request, reply) => {
        const { orgId, projectId } = ProjectParamsSchema.parse(request.params);
        await service.deleteProject(orgId, projectId, authenticatedUser(request).id, requestMeta(request));
        return reply.code(204).send();
    }));
    for (const [path, method] of [
        ["archive", "archiveProject"],
        ["unarchive", "unarchiveProject"],
        ["pause", "pauseProject"],
        ["resume", "resumeProject"],
        ["restore", "restoreProject"],
    ]) {
        fastify.post(`/:projectId/${path}`, { preHandler: [authenticate, writeRateLimit, idempotencyKey] }, withErrorHandling(async (request, reply) => {
            const { orgId, projectId } = ProjectParamsSchema.parse(request.params);
            const project = await service[method](orgId, projectId, authenticatedUser(request).id, requestMeta(request));
            return reply.send({ success: true, data: project });
        }));
    }
    // ── Project Settings & Overview ─────────────────────────────────────────────
    fastify.get("/:projectId/overview", { preHandler: [authenticate, readRateLimit] }, withErrorHandling(async (request, reply) => {
        const { orgId, projectId } = ProjectParamsSchema.parse(request.params);
        const overview = await service.getProjectOverview(orgId, projectId, authenticatedUser(request).id);
        return reply.send({ success: true, data: overview });
    }));
    // ── Environments ────────────────────────────────────────────────────────────
    // ── API keys ─────────────────────────────────────────────────────────────
    // Bulk operations are registered before the parameterized :apiKeyId routes so
    // "bulk-rotate"/"bulk-revoke" are never captured as an apiKeyId.
}
//# sourceMappingURL=project.routes.js.map