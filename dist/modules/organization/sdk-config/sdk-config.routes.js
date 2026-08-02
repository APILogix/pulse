/** Organization management routes for environment SDK configuration. */
import { ZodError } from "zod";
import { authenticate } from "../../../shared/middleware/auth.js";
import { OrganizationError } from "../types.js";
import { SdkConfigError } from "../../projects/sdk-config/errors.js";
import { ListSdkConfigsQuerySchema, ResolveSdkConfigQuerySchema, RollbackSdkConfigSchema, SdkConfigParamsSchema, SdkConfigVersionParamsSchema, UpdateSdkConfigSchema, } from "./sdk-config.types.js";
const asAuth = (request) => request;
function buildMeta(request) {
    const user = asAuth(request).user;
    return {
        actorUserId: user.id,
        actorEmail: user.email,
        actorSessionId: user.sessionId,
        actorIp: request.ip ?? "",
        actorUserAgent: typeof request.headers["user-agent"] === "string" ? request.headers["user-agent"] : null,
        httpMethod: request.method,
        endpoint: request.url,
        requestId: request.id,
    };
}
function handleError(error, reply) {
    if (error instanceof SdkConfigError) {
        return reply.code(error.statusCode).send({
            success: false,
            error: { code: error.code, message: error.message, details: error.details },
        });
    }
    if (error instanceof ZodError) {
        return reply.code(422).send({
            success: false,
            error: {
                code: "VALIDATION_ERROR",
                message: "Invalid SDK configuration request",
                details: error.flatten(),
            },
        });
    }
    if (error instanceof OrganizationError) {
        return reply.code(error.statusCode).send({
            success: false,
            error: { code: error.code, message: error.message },
        });
    }
    return reply.code(500).send({
        success: false,
        error: { code: "INTERNAL_ERROR", message: "Unexpected SDK config error" },
    });
}
function wrap(handler) {
    return async (request, reply) => {
        try {
            return await handler(request, reply);
        }
        catch (error) {
            return handleError(error, reply);
        }
    };
}
function strip(value) {
    return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}
export function registerSdkConfigRoutes(fastify, service) {
    const auth = { preHandler: [authenticate] };
    fastify.get("/:orgId/sdk-configs", auth, wrap(async (request, reply) => {
        const { orgId } = request.params;
        const query = ListSdkConfigsQuerySchema.parse(request.query ?? {});
        const { cursor, limit, search, sortBy, sortOrder, ...filters } = query;
        const scopedFilters = {};
        if (filters.projectId !== undefined)
            scopedFilters.projectId = filters.projectId;
        if (filters.environmentId !== undefined)
            scopedFilters.environmentId = filters.environmentId;
        const result = await service.listConfigs(orgId, asAuth(request).user.id, scopedFilters, strip({ cursor, limit, search, sortBy, sortOrder }));
        return reply.send({ success: true, ...result });
    }));
    fastify.get("/:orgId/sdk-configs/resolve", auth, wrap(async (request, reply) => {
        const { orgId } = request.params;
        const query = ResolveSdkConfigQuerySchema.parse(request.query ?? {});
        const result = await service.resolveForSdk(orgId, asAuth(request).user.id, query);
        return reply.send({ success: true, data: result });
    }));
    fastify.get("/:orgId/sdk-configs/:configId", auth, wrap(async (request, reply) => {
        const { orgId, configId } = SdkConfigParamsSchema.parse(request.params);
        const result = await service.getConfig(orgId, asAuth(request).user.id, configId);
        return reply.send({ success: true, data: result });
    }));
    fastify.patch("/:orgId/sdk-configs/:configId", auth, wrap(async (request, reply) => {
        const { orgId, configId } = SdkConfigParamsSchema.parse(request.params);
        const body = UpdateSdkConfigSchema.parse(request.body);
        const update = {
            editableConfig: body.editableConfig,
        };
        if (body.changeSummary !== undefined)
            update.changeSummary = body.changeSummary;
        const result = await service.updateConfig(buildMeta(request), orgId, configId, update);
        return reply.send({ success: true, data: result });
    }));
    fastify.post("/:orgId/sdk-configs/:configId/rollback", auth, wrap(async (request, reply) => {
        const { orgId, configId } = SdkConfigParamsSchema.parse(request.params);
        const body = RollbackSdkConfigSchema.parse(request.body);
        const result = await service.rollbackConfig(buildMeta(request), orgId, configId, body.toRevision, body.reason);
        return reply.send({ success: true, data: result });
    }));
    fastify.get("/:orgId/sdk-configs/:configId/versions", auth, wrap(async (request, reply) => {
        const { orgId, configId } = SdkConfigParamsSchema.parse(request.params);
        const result = await service.listVersions(orgId, asAuth(request).user.id, configId);
        return reply.send({ success: true, data: result });
    }));
    fastify.get("/:orgId/sdk-configs/:configId/versions/:version", auth, wrap(async (request, reply) => {
        const { orgId, configId, version } = SdkConfigVersionParamsSchema.parse(request.params);
        const result = await service.getVersion(orgId, asAuth(request).user.id, configId, version);
        return reply.send({ success: true, data: result });
    }));
}
//# sourceMappingURL=sdk-config.routes.js.map