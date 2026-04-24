/**
 * Project route registration.
 *
 * Flow:
 * 1. Authenticate the caller for every project and API-key management endpoint.
 * 2. Parse params, query, and body with module schemas before calling service
 *    methods.
 * 3. Pass request metadata into mutating service calls so audit logging can
 *    record request id, IP address, and user agent.
 * 4. Normalize service errors through handleProjectError.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { authenticate } from "../../shared/middleware/auth.js";
import {
  ApiKeyParamsSchema,
  CreateApiKeyBodySchema,
  CreateProjectBodySchema,
  ListApiKeysQuerySchema,
  ListProjectsQuerySchema,
  OrgIdParamsSchema,
  ProjectParamsSchema,
  RotateApiKeyBodySchema,
  UpdateApiKeyBodySchema,
  UpdateProjectBodySchema,
} from "./types.js";
import { handleProjectError } from "./utils.js";

function requestMeta(request: FastifyRequest) {
  // Keep audit metadata extraction in one place so mutating routes record a
  // consistent request footprint.
  const userAgent = request.headers["user-agent"];

  return {
    requestId: request.id,
    ipAddress: request.ip ?? "0.0.0.0",
    userAgent: typeof userAgent === "string" ? userAgent : null,
  };
}


function withErrorHandling(
  handler: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>,
) {
  // Wrap every handler with the same logging and domain-error translation path.
  return async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      return await handler(request, reply);
    } catch (error) {
      request.log.error({ err: error, path: request.url }, "Projects route failed");
      return handleProjectError(error, reply);
    }
  };
}

export async function projectsRoutes(fastify: FastifyInstance): Promise<void> {
  // The module decorator owns service construction; routes only orchestrate HTTP
  // concerns and response shapes.
  const service = fastify.projects.service;

  fastify.get(
    "/",
    { preHandler: [authenticate] },
    withErrorHandling(async (request, reply) => {
      const { orgId } = OrgIdParamsSchema.parse(request.params);
      const query = ListProjectsQuerySchema.parse(request.query ?? {});
      const result = await service.listProjects(orgId, request.user.id, query);

      return reply.send({
        success: true,
        data: result.projects,
        meta: {
          total: result.total,
          limit: result.limit,
          offset: result.offset,
        },
      });
    }),
  );

  fastify.post(
    "/",
    { preHandler: [authenticate] },
    withErrorHandling(async (request, reply) => {
      const { orgId } = OrgIdParamsSchema.parse(request.params);
      console.log("request.body", request.body,request.params);
      const body = CreateProjectBodySchema.parse(request.body);
      const project = await service.createProject(
        orgId,
        request.user.id,
        body,
        requestMeta(request),
      );

      return reply.code(201).send({ success: true, data: project });
    }),
  );

  fastify.get(
    "/:projectId",
    { preHandler: [authenticate] },
    withErrorHandling(async (request, reply) => {
      const { orgId, projectId } = ProjectParamsSchema.parse(request.params);
      const project = await service.getProject(orgId, projectId, request.user.id);
      return reply.send({ success: true, data: project });
    }),
  );

  fastify.patch(
    "/:projectId",
    { preHandler: [authenticate] },
    withErrorHandling(async (request, reply) => {
      const { orgId, projectId } = ProjectParamsSchema.parse(request.params);
      const body = UpdateProjectBodySchema.parse(request.body);
      const project = await service.updateProject(
        orgId,
        projectId,
        request.user.id,
        body,
        requestMeta(request),
      );

      return reply.send({ success: true, data: project });
    }),
  );

  fastify.delete(
    "/:projectId",
    { preHandler: [authenticate] },
    withErrorHandling(async (request, reply) => {
      const { orgId, projectId } = ProjectParamsSchema.parse(request.params);
      await service.deleteProject(
        orgId,
        projectId,
        request.user.id,
        requestMeta(request),
      );

      return reply.code(204).send();
    }),
  );

  fastify.post(
    "/:projectId/archive",
    { preHandler: [authenticate] },
    withErrorHandling(async (request, reply) => {
      const { orgId, projectId } = ProjectParamsSchema.parse(request.params);
      const project = await service.archiveProject(
        orgId,
        projectId,
        request.user.id,
        requestMeta(request),
      );

      return reply.send({ success: true, data: project });
    }),
  );

  fastify.post(
    "/:projectId/unarchive",
    { preHandler: [authenticate] },
    withErrorHandling(async (request, reply) => {
      const { orgId, projectId } = ProjectParamsSchema.parse(request.params);
      const project = await service.unarchiveProject(
        orgId,
        projectId,
        request.user.id,
        requestMeta(request),
      );

      return reply.send({ success: true, data: project });
    }),
  );

  fastify.post(
    "/:projectId/pause",
    { preHandler: [authenticate] },
    withErrorHandling(async (request, reply) => {
      const { orgId, projectId } = ProjectParamsSchema.parse(request.params);
      const project = await service.pauseProject(
        orgId,
        projectId,
        request.user.id,
        requestMeta(request),
      );

      return reply.send({ success: true, data: project });
    }),
  );

  fastify.post(
    "/:projectId/resume",
    { preHandler: [authenticate] },
    withErrorHandling(async (request, reply) => {
      const { orgId, projectId } = ProjectParamsSchema.parse(request.params);
      const project = await service.resumeProject(
        orgId,
        projectId,
        request.user.id,
        requestMeta(request),
      );

      return reply.send({ success: true, data: project });
    }),
  );

  fastify.get(
    "/:projectId/stats",
    { preHandler: [authenticate] },
    withErrorHandling(async (request, reply) => {
      const { orgId, projectId } = ProjectParamsSchema.parse(request.params);
      const project = await service.getProjectStats(
        orgId,
        projectId,
        request.user.id,
      );

      return reply.send({ success: true, data: project });
    }),
  );

  fastify.get(
    "/:projectId/api-keys",
    { preHandler: [authenticate] },
    withErrorHandling(async (request, reply) => {
      const { orgId, projectId } = ProjectParamsSchema.parse(request.params);
      const query = ListApiKeysQuerySchema.parse(request.query ?? {});
      const result = await service.listApiKeys(
        orgId,
        projectId,
        request.user.id,
        query,
      );

      return reply.send({
        success: true,
        data: result.keys,
        meta: {
          total: result.total,
          limit: result.limit,
          offset: result.offset,
        },
      });
    }),
  );

  fastify.post(
    "/:projectId/api-keys",
    { preHandler: [authenticate] },
    withErrorHandling(async (request, reply) => {
      const { orgId, projectId } = ProjectParamsSchema.parse(request.params);
      console.log("apikey", request.body,request.params);
      const body = CreateApiKeyBodySchema.parse(request.body);
      // API keys return the full secret exactly once. Later reads expose only
      // metadata and prefix, so clients must store this response securely.
      const result = await service.createApiKey(
        orgId,
        projectId,
        request.user.id,
        body,
        requestMeta(request),
      );

      // store key in redis 
      
// store key in lpu cashe 

      return reply.code(201).send({
        success: true,
        data: result,
        warning: "Store this key securely. It will only be shown once.",
      });
    }),
  );

  fastify.get(
    "/:projectId/api-keys/:apiKeyId",
    { preHandler: [authenticate] },
    withErrorHandling(async (request, reply) => {
      const { orgId, projectId, apiKeyId } = ApiKeyParamsSchema.parse(
        request.params,
      );
      const apiKey = await service.getApiKey(
        orgId,
        projectId,
        apiKeyId,
        request.user.id,
      );

      return reply.send({ success: true, data: apiKey });
    }),
  );

  fastify.patch(
    "/:projectId/api-keys/:apiKeyId",
    { preHandler: [authenticate] },
    withErrorHandling(async (request, reply) => {
      const { orgId, projectId, apiKeyId } = ApiKeyParamsSchema.parse(
        request.params,
      );
      const body = UpdateApiKeyBodySchema.parse(request.body);
      const apiKey = await service.updateApiKey(
        orgId,
        projectId,
        apiKeyId,
        request.user.id,
        body,
        requestMeta(request),
      );

      return reply.send({ success: true, data: apiKey });
    }),
  );

  fastify.delete(
    "/:projectId/api-keys/:apiKeyId",
    { preHandler: [authenticate] },
    withErrorHandling(async (request, reply) => {
      const { orgId, projectId, apiKeyId } = ApiKeyParamsSchema.parse(
        request.params,
      );
      await service.deleteApiKey(
        orgId,
        projectId,
        apiKeyId,
        request.user.id,
        requestMeta(request),
      );

      return reply.code(204).send();
    }),
  );

  fastify.post(
    "/:projectId/api-keys/:apiKeyId/rotate",
    { preHandler: [authenticate] },
    withErrorHandling(async (request, reply) => {
      const { orgId, projectId, apiKeyId } = ApiKeyParamsSchema.parse(
        request.params,
      );
      const body = RotateApiKeyBodySchema.parse(request.body ?? {});
      const result = await service.rotateApiKey(
        orgId,
        projectId,
        apiKeyId,
        request.user.id,
        body,
        requestMeta(request),
      );

      return reply.send({
        success: true,
        data: result,
        warning: "Store this rotated key securely. It will only be shown once.",
      });
    }),
  );

  fastify.post(
    "/:projectId/api-keys/:apiKeyId/enable",
    { preHandler: [authenticate] },
    withErrorHandling(async (request, reply) => {
      const { orgId, projectId, apiKeyId } = ApiKeyParamsSchema.parse(
        request.params,
      );
      const apiKey = await service.enableApiKey(
        orgId,
        projectId,
        apiKeyId,
        request.user.id,
        requestMeta(request),
      );

      return reply.send({ success: true, data: apiKey });
    }),
  );

  fastify.post(
    "/:projectId/api-keys/:apiKeyId/disable",
    { preHandler: [authenticate] },
    withErrorHandling(async (request, reply) => {
      const { orgId, projectId, apiKeyId } = ApiKeyParamsSchema.parse(
        request.params,
      );
      const apiKey = await service.disableApiKey(
        orgId,
        projectId,
        apiKeyId,
        request.user.id,
        requestMeta(request),
      );

      return reply.send({ success: true, data: apiKey });
    }),
  );

  fastify.get(
    "/:projectId/api-keys/:apiKeyId/usage",
    { preHandler: [authenticate] },
    withErrorHandling(async (request, reply) => {
      const { orgId, projectId, apiKeyId } = ApiKeyParamsSchema.parse(
        request.params,
      );
      const usage = await service.getApiKeyUsage(
        orgId,
        projectId,
        apiKeyId,
        request.user.id,
      );

      return reply.send({ success: true, data: usage });
    }),
  );
}
