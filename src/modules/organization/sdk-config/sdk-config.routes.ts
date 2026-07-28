/** Organization management routes for environment SDK configuration. */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { authenticate } from "../../../shared/middleware/auth.js";
import { OrganizationError, type RequestMeta } from "../types.js";
import type { SdkConfigService } from "./sdk-config.service.js";
import {
  ListSdkConfigsQuerySchema,
  ResolveSdkConfigQuerySchema,
  RollbackSdkConfigSchema,
  SdkConfigParamsSchema,
  SdkConfigVersionParamsSchema,
  UpdateSdkConfigSchema,
} from "./sdk-config.types.js";

type AuthedRequest = FastifyRequest & {
  user: { id: string; email: string; sessionId: string };
};
const asAuth = (request: FastifyRequest) => request as AuthedRequest;

function buildMeta(request: FastifyRequest): RequestMeta {
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

function handleError(error: unknown, reply: FastifyReply) {
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

function wrap(handler: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      return await handler(request, reply);
    } catch (error) {
      return handleError(error, reply);
    }
  };
}

function strip<T>(value: T): T {
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(([, entry]) => entry !== undefined),
  ) as T;
}
export function registerSdkConfigRoutes(fastify: FastifyInstance, service: SdkConfigService): void {
  const auth = { preHandler: [authenticate] };

  fastify.get("/:orgId/sdk-configs", auth, wrap(async (request, reply) => {
    const { orgId } = request.params as { orgId: string };
    const query = ListSdkConfigsQuerySchema.parse(request.query ?? {});
    const { cursor, limit, search, sortBy, sortOrder, ...filters } = query;
    const scopedFilters: { projectId?: string; environmentId?: string } = {};
    if (filters.projectId !== undefined) scopedFilters.projectId = filters.projectId;
    if (filters.environmentId !== undefined) scopedFilters.environmentId = filters.environmentId;
    const result = await service.listConfigs(
      orgId,
      asAuth(request).user.id,
      scopedFilters,
      strip({ cursor, limit, search, sortBy, sortOrder }),
    );
    return reply.send({ success: true, ...result });
  }));

  fastify.get("/:orgId/sdk-configs/resolve", auth, wrap(async (request, reply) => {
    const { orgId } = request.params as { orgId: string };
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
    const update: {
      configValue: Record<string, unknown>;
      schemaVersion?: string | null;
      changeSummary?: string;
    } = { configValue: body.configValue };
    if (body.schemaVersion !== undefined) update.schemaVersion = body.schemaVersion;
    if (body.changeSummary !== undefined) update.changeSummary = body.changeSummary;
    const result = await service.updateConfig(buildMeta(request), orgId, configId, update);
    return reply.send({ success: true, data: result });
  }));

  fastify.post("/:orgId/sdk-configs/:configId/rollback", auth, wrap(async (request, reply) => {
    const { orgId, configId } = SdkConfigParamsSchema.parse(request.params);
    const body = RollbackSdkConfigSchema.parse(request.body);
    const result = await service.rollbackConfig(
      buildMeta(request), orgId, configId, body.toRevision, body.reason,
    );
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
