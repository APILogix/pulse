/**
 * Project route registration (management API only — NO ingestion routes).
 *
 * Flow:
 * 1. Authenticate every project/API-key/environment management endpoint.
 * 2. Parse params/query/body with module schemas before calling the service.
 * 3. Pass an audit-friendly RequestMeta into mutating calls so org audit logs
 *    capture actor, ip, user agent, request id, method, and endpoint.
 * 4. Normalize service errors through handleProjectError.
 *
 * Prefix: /organizations/:orgId/projects
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { authenticate } from "../../../shared/middleware/auth.js";
import {
  ListSdkConfigsQuerySchema,
  ResolveSdkConfigQuerySchema,
  UpdateSdkConfigSchema,
} from "../../organization/sdk-config.types.js";
import type { RequestMeta as OrganizationRequestMeta } from "../../organization/types.js";
import type { RequestMeta } from "../service.js";
import {
  ApiKeyParamsSchema,
  BulkRevokeBodySchema,
  BulkRotateBodySchema,
  CreateApiKeyBodySchema,
  CreateEnvironmentBodySchema,
  CreateProjectBodySchema,
  EnvironmentParamsSchema,
  ListApiKeysQuerySchema,
  ListProjectActivityQuerySchema,
  ListProjectsQuerySchema,
  OrgIdParamsSchema,
  ProjectParamsSchema,
  ProjectSdkConfigParamsSchema,
  RevokeApiKeyBodySchema,
  RotateApiKeyBodySchema,
  UpdateApiKeyBodySchema,
  UpdateEnvironmentBodySchema,
  UpdateProjectBodySchema,
  UpdateProjectSettingsBodySchema,
} from "../types.js";
import { handleProjectError, ProjectError } from "../shared/utils.js";
import { requestMeta, organizationRequestMeta, authenticatedUser, withErrorHandling } from "../shared/route-utils.js";

export async function projectCoreRoutes(fastify: FastifyInstance): Promise<void> {
  const service = fastify.projects.service;
  const sdkConfigService = fastify.organization.sdkConfigService;

  // ── Project CRUD ──────────────────────────────────────────────────────────

  fastify.get(
    "/",
    { preHandler: [authenticate] },
    withErrorHandling(async (request, reply) => {
      const { orgId } = OrgIdParamsSchema.parse(request.params);
      const query = ListProjectsQuerySchema.parse(request.query ?? {});
      const result = await service.listProjects(orgId, authenticatedUser(request).id, query);
      return reply.send({
        success: true,
        data: result.projects,
        meta: { total: result.total, limit: result.limit, offset: result.offset },
      });
    }),
  );

  fastify.post(
    "/",
    { preHandler: [authenticate] },
    withErrorHandling(async (request, reply) => {
      const { orgId } = OrgIdParamsSchema.parse(request.params);
      const body = CreateProjectBodySchema.parse(request.body);
      const project = await service.createProject(orgId, authenticatedUser(request).id, body, requestMeta(request));
      return reply.code(201).send({ success: true, data: project });
    }),
  );

  fastify.get(
    "/:projectId",
    { preHandler: [authenticate] },
    withErrorHandling(async (request, reply) => {
      const { orgId, projectId } = ProjectParamsSchema.parse(request.params);
      const project = await service.getProject(orgId, projectId, authenticatedUser(request).id);
      return reply.send({ success: true, data: project });
    }),
  );

  fastify.get(
    "/:projectId/stats",
    { preHandler: [authenticate] },
    withErrorHandling(async (request, reply) => {
      const { orgId, projectId } = ProjectParamsSchema.parse(request.params);
      const project = await service.getProjectStats(orgId, projectId, authenticatedUser(request).id);
      return reply.send({ success: true, data: project });
    }),
  );

  fastify.get(
    "/:projectId/usage",
    { preHandler: [authenticate] },
    withErrorHandling(async (request, reply) => {
      const { orgId, projectId } = ProjectParamsSchema.parse(request.params);
      const usage = await service.getProjectUsage(orgId, projectId, authenticatedUser(request).id);
      return reply.send({ success: true, data: usage });
    }),
  );
  fastify.patch(
    "/:projectId",
    { preHandler: [authenticate] },
    withErrorHandling(async (request, reply) => {
      const { orgId, projectId } = ProjectParamsSchema.parse(request.params);
      const body = UpdateProjectBodySchema.parse(request.body);
      const project = await service.updateProject(orgId, projectId, authenticatedUser(request).id, body, requestMeta(request));
      return reply.send({ success: true, data: project });
    }),
  );

  fastify.delete(
    "/:projectId",
    { preHandler: [authenticate] },
    withErrorHandling(async (request, reply) => {
      const { orgId, projectId } = ProjectParamsSchema.parse(request.params);
      await service.deleteProject(orgId, projectId, authenticatedUser(request).id, requestMeta(request));
      return reply.code(204).send();
    }),
  );

  for (const [path, method] of [
    ["archive", "archiveProject"],
    ["unarchive", "unarchiveProject"],
    ["pause", "pauseProject"],
    ["resume", "resumeProject"],
    ["restore", "restoreProject"],
  ] as const) {
    fastify.post(
      `/:projectId/${path}`,
      { preHandler: [authenticate] },
      withErrorHandling(async (request, reply) => {
        const { orgId, projectId } = ProjectParamsSchema.parse(request.params);
        const project = await service[method](orgId, projectId, authenticatedUser(request).id, requestMeta(request));
        return reply.send({ success: true, data: project });
      }),
    );
  }



  // ── Project Settings & Overview ─────────────────────────────────────────────
  fastify.get(
    "/:projectId/overview",
    { preHandler: [authenticate] },
    withErrorHandling(async (request, reply) => {
      const { orgId, projectId } = ProjectParamsSchema.parse(request.params);
      const overview = await service.getProjectOverview(orgId, projectId, authenticatedUser(request).id);
      return reply.send({ success: true, data: overview });
    }),
  );

  // ── Environments ────────────────────────────────────────────────────────────
  // ── API keys ─────────────────────────────────────────────────────────────
  // Bulk operations are registered before the parameterized :apiKeyId routes so
  // "bulk-rotate"/"bulk-revoke" are never captured as an apiKeyId.
}
