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

export async function projectEnvironmentRoutes(fastify: FastifyInstance): Promise<void> {
  const service = fastify.projects.service;
  const sdkConfigService = fastify.organization.sdkConfigService;

  // ── Project CRUD ──────────────────────────────────────────────────────────
  // ── Project Settings & Overview ─────────────────────────────────────────────
  // ── Environments ────────────────────────────────────────────────────────────

  fastify.get(
    "/:projectId/sdk-configs",
    { preHandler: [authenticate] },
    withErrorHandling(async (request, reply) => {
      const { orgId, projectId } = ProjectParamsSchema.parse(request.params);
      const userId = authenticatedUser(request).id;
      await service.getProject(orgId, projectId, userId);

      const query = ListSdkConfigsQuerySchema.parse(request.query ?? {});
      const filters: {
        projectId: string;
        environment?: string;
        configKey?: string;
        includeInactive?: boolean;
      } = { projectId };
      if (query.environment !== undefined) filters.environment = query.environment;
      if (query.configKey !== undefined) filters.configKey = query.configKey;
      if (query.includeInactive !== undefined) filters.includeInactive = query.includeInactive;
      const result = await sdkConfigService.listConfigs(
        orgId,
        userId,
        filters,
      );
      return reply.send({ success: true, data: result });
    }),
  );

  fastify.get(
    "/:projectId/sdk-configs/resolve",
    { preHandler: [authenticate] },
    withErrorHandling(async (request, reply) => {
      const { orgId, projectId } = ProjectParamsSchema.parse(request.params);
      const userId = authenticatedUser(request).id;
      await service.getProject(orgId, projectId, userId);

      const query = ResolveSdkConfigQuerySchema.parse(request.query ?? {});
      const scopedQuery: {
        projectId: string;
        environment: string;
        platform?: string;
      } = {
        projectId,
        environment: query.environment,
      };
      if (query.platform !== undefined) scopedQuery.platform = query.platform;
      const result = await sdkConfigService.resolveForSdk(
        orgId,
        userId,
        scopedQuery,
      );
      return reply.send({ success: true, data: result });
    }),
  );

  fastify.get(
    "/:projectId/sdk-configs/:configId",
    { preHandler: [authenticate] },
    withErrorHandling(async (request, reply) => {
      const { orgId, projectId, configId } = ProjectSdkConfigParamsSchema.parse(request.params);
      const userId = authenticatedUser(request).id;
      await service.getProject(orgId, projectId, userId);

      const config = await sdkConfigService.getConfig(orgId, userId, configId);
      if (config.projectId !== projectId) {
        throw new ProjectError(
          "SDK_CONFIG_NOT_FOUND",
          "SDK config not found for this project",
          404,
        );
      }
      return reply.send({ success: true, data: config });
    }),
  );

  fastify.patch(
    "/:projectId/sdk-configs/:configId",
    { preHandler: [authenticate] },
    withErrorHandling(async (request, reply) => {
      const { orgId, projectId, configId } = ProjectSdkConfigParamsSchema.parse(request.params);
      const userId = authenticatedUser(request).id;
      await service.getProject(orgId, projectId, userId);

      const body = UpdateSdkConfigSchema.parse(request.body);
      const update: {
        configValue?: Record<string, unknown>;
        environment?: string;
        schemaVersion?: string | null;
        targetSdkVersions?: string[] | null;
        targetPlatforms?: string[] | null;
        rolloutPercentage?: number;
        isActive?: boolean;
        changeSummary?: string;
      } = {};
      if (body.configValue !== undefined) update.configValue = body.configValue;
      if (body.environment !== undefined) update.environment = body.environment;
      if (body.schemaVersion !== undefined) update.schemaVersion = body.schemaVersion;
      if (body.targetSdkVersions !== undefined) update.targetSdkVersions = body.targetSdkVersions;
      if (body.targetPlatforms !== undefined) update.targetPlatforms = body.targetPlatforms;
      if (body.rolloutPercentage !== undefined) update.rolloutPercentage = body.rolloutPercentage;
      if (body.isActive !== undefined) update.isActive = body.isActive;
      if (body.changeSummary !== undefined) update.changeSummary = body.changeSummary;

      const config = await sdkConfigService.updateProjectConfig(
        organizationRequestMeta(request),
        orgId,
        projectId,
        configId,
        update,
      );
      return reply.send({ success: true, data: config });
    }),
  );

  fastify.get(
    "/:projectId/environments",
    { preHandler: [authenticate] },
    withErrorHandling(async (request, reply) => {
      const { orgId, projectId } = ProjectParamsSchema.parse(request.params);
      const envs = await service.listEnvironments(orgId, projectId, authenticatedUser(request).id);
      return reply.send({ success: true, data: envs });
    }),
  );

  fastify.post(
    "/:projectId/environments",
    { preHandler: [authenticate] },
    withErrorHandling(async (request, reply) => {
      const { orgId, projectId } = ProjectParamsSchema.parse(request.params);
      const body = CreateEnvironmentBodySchema.parse(request.body);
      const env = await service.createEnvironment(orgId, projectId, authenticatedUser(request).id, body, requestMeta(request));
      return reply.code(201).send({ success: true, data: env });
    }),
  );

  fastify.get(
    "/:projectId/environments/:environmentId",
    { preHandler: [authenticate] },
    withErrorHandling(async (request, reply) => {
      const { orgId, projectId, environmentId } = EnvironmentParamsSchema.parse(request.params);
      const env = await service.getEnvironment(orgId, projectId, environmentId, authenticatedUser(request).id);
      return reply.send({ success: true, data: env });
    }),
  );

  fastify.patch(
    "/:projectId/environments/:environmentId",
    { preHandler: [authenticate] },
    withErrorHandling(async (request, reply) => {
      const { orgId, projectId, environmentId } = EnvironmentParamsSchema.parse(request.params);
      const body = UpdateEnvironmentBodySchema.parse(request.body);
      const env = await service.updateEnvironment(orgId, projectId, environmentId, authenticatedUser(request).id, body, requestMeta(request));
      return reply.send({ success: true, data: env });
    }),
  );

  fastify.delete(
    "/:projectId/environments/:environmentId",
    { preHandler: [authenticate] },
    withErrorHandling(async (request, reply) => {
      const { orgId, projectId, environmentId } = EnvironmentParamsSchema.parse(request.params);
      await service.deleteEnvironment(orgId, projectId, environmentId, authenticatedUser(request).id, requestMeta(request));
      return reply.code(204).send();
    }),
  );

  // ── API keys ─────────────────────────────────────────────────────────────
  // Bulk operations are registered before the parameterized :apiKeyId routes so
  // "bulk-rotate"/"bulk-revoke" are never captured as an apiKeyId.
}
