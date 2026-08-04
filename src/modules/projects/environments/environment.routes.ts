/** Project environment and environment-owned SDK configuration routes. */
import type { FastifyInstance } from "fastify";
import { authenticate } from "../../../shared/middleware/auth.js";
import {
  ListSdkConfigsQuerySchema,
  ResolveSdkConfigQuerySchema,
  UpdateSdkConfigSchema,
} from "../../organization/sdk-config/sdk-config.types.js";
import {
  CreateEnvironmentBodySchema,
  EnvironmentParamsSchema,
  ListEnvironmentsQuerySchema,
  ProjectParamsSchema,
  ProjectSdkConfigParamsSchema,
  UpdateEnvironmentBodySchema,
} from "../types.js";
import { ProjectError } from "../shared/utils.js";
import {
  requestMeta,
  organizationRequestMeta,
  authenticatedUser,
  withErrorHandling,
} from "../shared/route-utils.js";

export async function projectEnvironmentRoutes(fastify: FastifyInstance): Promise<void> {
  const service = fastify.projects.service;
  const sdkConfigService = fastify.organization.sdkConfigService;

  fastify.get(
    "/:projectId/sdk-configs",
    { preHandler: [authenticate] },
    withErrorHandling(async (request, reply) => {
      const { orgId, projectId } = ProjectParamsSchema.parse(request.params);
      const userId = authenticatedUser(request).id;
      await service.getProject(orgId, projectId, userId);
      const query = ListSdkConfigsQuerySchema.parse(request.query ?? {});
      const filters: { projectId: string; environmentId?: string } = { projectId };
      if (query.environmentId) filters.environmentId = query.environmentId;
      const result = await sdkConfigService.listConfigs(orgId, userId, filters, {
        cursor: query.cursor,
        limit: query.limit,
        search: query.search,
        sortBy: query.sortBy,
        sortOrder: query.sortOrder,
      });
      return reply.send({ success: true, ...result });
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
      const environment = await service.getEnvironment(
        orgId, projectId, query.environmentId, userId,
      );
      if (!environment) throw new ProjectError("ENVIRONMENT_NOT_FOUND", "Environment not found", 404);
      const result = await sdkConfigService.resolveForSdk(orgId, userId, query);
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
        throw new ProjectError("SDK_CONFIG_NOT_FOUND", "SDK config not found for this project", 404);
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
        editableConfig: Record<string, unknown>;
        changeSummary?: string;
      } = { editableConfig: body.editableConfig };
      if (body.changeSummary !== undefined) update.changeSummary = body.changeSummary;
      const config = await sdkConfigService.updateProjectConfig(
        organizationRequestMeta(request), orgId, projectId, configId, update,
      );
      return reply.send({ success: true, data: config });
    }),
  );

  fastify.get(
    "/:projectId/environments",
    { preHandler: [authenticate] },
    withErrorHandling(async (request, reply) => {
      const { orgId, projectId } = ProjectParamsSchema.parse(request.params);
      const query = ListEnvironmentsQuerySchema.parse(request.query ?? {});
      const environments = await service.listEnvironments(
        orgId, projectId, authenticatedUser(request).id, query.includeDeleted,
      );
      return reply.send({ success: true, data: environments });
    }),
  );

  fastify.post(
    "/:projectId/environments",
    { preHandler: [authenticate] },
    withErrorHandling(async (request, reply) => {
      const { orgId, projectId } = ProjectParamsSchema.parse(request.params);
      const body = CreateEnvironmentBodySchema.parse(request.body);
      const environment = await service.createEnvironment(
        orgId, projectId, authenticatedUser(request).id, body, requestMeta(request),
      );
      return reply.code(201).send({ success: true, data: environment });
    }),
  );
  fastify.get(
    "/:projectId/environments/:environmentId",
    { preHandler: [authenticate] },
    withErrorHandling(async (request, reply) => {
      const { orgId, projectId, environmentId } = EnvironmentParamsSchema.parse(request.params);
      const environment = await service.getEnvironment(
        orgId, projectId, environmentId, authenticatedUser(request).id,
      );
      return reply.send({ success: true, data: environment });
    }),
  );

  fastify.patch(
    "/:projectId/environments/:environmentId",
    { preHandler: [authenticate] },
    withErrorHandling(async (request, reply) => {
      const { orgId, projectId, environmentId } = EnvironmentParamsSchema.parse(request.params);
      const body = UpdateEnvironmentBodySchema.parse(request.body);
      const environment = await service.updateEnvironment(
        orgId, projectId, environmentId, authenticatedUser(request).id, body, requestMeta(request),
      );
      return reply.send({ success: true, data: environment });
    }),
  );

  fastify.post(
    "/:projectId/environments/:environmentId/restore",
    { preHandler: [authenticate] },
    withErrorHandling(async (request, reply) => {
      const { orgId, projectId, environmentId } = EnvironmentParamsSchema.parse(request.params);
      const environment = await service.restoreEnvironment(
        orgId, projectId, environmentId, authenticatedUser(request).id, requestMeta(request),
      );
      return reply.send({ success: true, data: environment });
    }),
  );

  fastify.post(
    "/:projectId/environments/:environmentId/set-default",
    { preHandler: [authenticate] },
    withErrorHandling(async (request, reply) => {
      const { orgId, projectId, environmentId } = EnvironmentParamsSchema.parse(request.params);
      const environment = await service.setDefaultEnvironment(
        orgId, projectId, environmentId, authenticatedUser(request).id, requestMeta(request),
      );
      return reply.send({ success: true, data: environment });
    }),
  );

  fastify.post(
    "/:projectId/environments/:environmentId/deactivate",
    { preHandler: [authenticate] },
    withErrorHandling(async (request, reply) => {
      const { orgId, projectId, environmentId } = EnvironmentParamsSchema.parse(request.params);
      const environment = await service.deactivateEnvironment(
        orgId, projectId, environmentId, authenticatedUser(request).id, requestMeta(request),
      );
      return reply.send({ success: true, data: environment });
    }),
  );

  fastify.delete(
    "/:projectId/environments/:environmentId",
    { preHandler: [authenticate] },
    withErrorHandling(async (request, reply) => {
      const { orgId, projectId, environmentId } = EnvironmentParamsSchema.parse(request.params);
      await service.deleteEnvironment(
        orgId, projectId, environmentId, authenticatedUser(request).id, requestMeta(request),
      );
      return reply.code(204).send();
    }),
  );

  // Irreversible: permanently removes the (already soft-deleted) environment,
  // every API key scoped to it, their rotation history, and its SDK
  // configuration. Requires owner role and a prior soft-delete.
  fastify.delete(
    "/:projectId/environments/:environmentId/permanent",
    { preHandler: [authenticate] },
    withErrorHandling(async (request, reply) => {
      const { orgId, projectId, environmentId } = EnvironmentParamsSchema.parse(request.params);
      await service.permanentlyDeleteEnvironment(
        orgId, projectId, environmentId, authenticatedUser(request).id, requestMeta(request),
      );
      return reply.code(204).send();
    }),
  );
}
