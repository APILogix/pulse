import { authenticate } from "../../shared/middleware/auth.js";
import { OrganizationError } from "./types.js";
import { CreateSdkConfigSchema, UpdateSdkConfigSchema, RollbackSdkConfigSchema, ListSdkConfigsQuerySchema, ResolveSdkConfigQuerySchema, SdkConfigParamsSchema, SdkConfigVersionParamsSchema, } from "./sdk-config.types.js";
function asAuth(request) {
    return request;
}
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
    if (error instanceof OrganizationError) {
        return reply.code(error.statusCode).send({ success: false, error: { code: error.code, message: error.message } });
    }
    return reply.code(500).send({ success: false, error: { code: "INTERNAL_ERROR", message: "Unexpected SDK config error" } });
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
/** Strip undefined to satisfy exactOptionalPropertyTypes. */
function strip(obj) {
    if (typeof obj !== "object" || obj === null)
        return obj;
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
        if (v !== undefined)
            out[k] = v;
    }
    return out;
}
export function registerSdkConfigRoutes(fastify, svc) {
    const auth = { preHandler: [authenticate] };
    // List configs (latest rows) for the org, with optional filters.
    fastify.get("/:orgId/sdk-configs", auth, wrap(async (request, reply) => {
        const { orgId } = request.params;
        const q = ListSdkConfigsQuerySchema.parse(request.query ?? {});
        const result = await svc.listConfigs(orgId, asAuth(request).user.id, strip(q));
        return reply.send({ success: true, data: result });
    }));
    // Create a config (version 1).
    fastify.post("/:orgId/sdk-configs", auth, wrap(async (request, reply) => {
        const { orgId } = request.params;
        const body = CreateSdkConfigSchema.parse(request.body);
        const result = await svc.createConfig(buildMeta(request), orgId, strip(body));
        return reply.code(201).send({ success: true, data: result });
    }));
    // Resolve the active config set for an SDK (member-authenticated, cached).
    // Declared before /:configId so "resolve" is not captured as a configId.
    fastify.get("/:orgId/sdk-configs/resolve", auth, wrap(async (request, reply) => {
        const { orgId } = request.params;
        const q = ResolveSdkConfigQuerySchema.parse(request.query ?? {});
        const result = await svc.resolveForSdk(orgId, asAuth(request).user.id, strip(q));
        return reply.send({ success: true, data: result });
    }));
    // Get one config.
    fastify.get("/:orgId/sdk-configs/:configId", auth, wrap(async (request, reply) => {
        const { orgId, configId } = SdkConfigParamsSchema.parse(request.params);
        const result = await svc.getConfig(orgId, asAuth(request).user.id, configId);
        return reply.send({ success: true, data: result });
    }));
    // Update a config (mints a new version when the value changes).
    fastify.patch("/:orgId/sdk-configs/:configId", auth, wrap(async (request, reply) => {
        const { orgId, configId } = SdkConfigParamsSchema.parse(request.params);
        const body = UpdateSdkConfigSchema.parse(request.body);
        const result = await svc.updateConfig(buildMeta(request), orgId, configId, strip(body));
        return reply.send({ success: true, data: result });
    }));
    // Roll back to an earlier version (mints a new version with the old value).
    fastify.post("/:orgId/sdk-configs/:configId/rollback", auth, wrap(async (request, reply) => {
        const { orgId, configId } = SdkConfigParamsSchema.parse(request.params);
        const body = RollbackSdkConfigSchema.parse(request.body);
        const result = await svc.rollbackConfig(buildMeta(request), orgId, configId, body.toVersion, body.reason);
        return reply.send({ success: true, data: result });
    }));
    // List immutable version history.
    fastify.get("/:orgId/sdk-configs/:configId/versions", auth, wrap(async (request, reply) => {
        const { orgId, configId } = SdkConfigParamsSchema.parse(request.params);
        const result = await svc.listVersions(orgId, asAuth(request).user.id, configId);
        return reply.send({ success: true, data: result });
    }));
    // Get a specific version snapshot.
    fastify.get("/:orgId/sdk-configs/:configId/versions/:version", auth, wrap(async (request, reply) => {
        const { orgId, configId, version } = SdkConfigVersionParamsSchema.parse(request.params);
        const result = await svc.getVersion(orgId, asAuth(request).user.id, configId, version);
        return reply.send({ success: true, data: result });
    }));
    // Deployment/rollout tracking for a config.
    fastify.get("/:orgId/sdk-configs/:configId/deployments", auth, wrap(async (request, reply) => {
        const { orgId, configId } = SdkConfigParamsSchema.parse(request.params);
        const result = await svc.listDeployments(orgId, asAuth(request).user.id, configId);
        return reply.send({ success: true, data: result });
    }));
    // Acknowledge receipt of a deployed version (bumps reached_count).
    fastify.post("/:orgId/sdk-configs/:configId/versions/:version/ack", auth, wrap(async (request, reply) => {
        const { orgId, configId, version } = SdkConfigVersionParamsSchema.parse(request.params);
        await svc.acknowledgeDeployment(orgId, asAuth(request).user.id, configId, version);
        return reply.send({ success: true });
    }));
}
//# sourceMappingURL=sdk-config.routes.js.map