import type { FastifyInstance, FastifyPluginOptions } from "fastify";
import { authenticate } from "../../../../shared/middleware/auth.js";
import { authenticatedUser, requestMeta, withErrorHandling } from "../../shared/route-utils.js";
import type { ProjectAlertChannelService } from "./channel.service.js";
import {
  CreateProjectAlertChannelBodySchema,
  DeleteMemberAlertChannelPreferenceQuerySchema,
  ListProjectAlertChannelsQuerySchema,
  ProjectAlertChannelBaseParamsSchema,
  ProjectAlertChannelParamsSchema,
  ToggleProjectAlertChannelBodySchema,
  UpsertMemberAlertChannelPreferenceBodySchema,
  UpdateProjectAlertChannelBodySchema,
} from "./channel.types.js";

export interface ProjectAlertChannelRouteOptions extends FastifyPluginOptions {
  service?: ProjectAlertChannelService;
}

function resolveService(
  fastify: FastifyInstance,
  options: ProjectAlertChannelRouteOptions,
): ProjectAlertChannelService {
  if (options.service) return options.service;
  const projects = fastify.projects as typeof fastify.projects & {
    alertChannelsService?: ProjectAlertChannelService;
  };
  if (!projects.alertChannelsService) {
    throw new Error("Project alert-channel service is not registered");
  }
  return projects.alertChannelsService;
}

/**
 * Register with prefix:
 * /organizations/:orgId/projects/:projectId/alert-channels
 */
export async function projectAlertChannelRoutes(
  fastify: FastifyInstance,
  options: ProjectAlertChannelRouteOptions,
): Promise<void> {
  const service = resolveService(fastify, options);

  // Static preference routes must precede /:channelId routes.
  fastify.get(
    "/preferences",
    { preHandler: [authenticate] },
    withErrorHandling(async (request, reply) => {
      const { orgId, projectId } = ProjectAlertChannelBaseParamsSchema.parse(request.params);
      const preferences = await service.listMyPreferences(
        orgId,
        projectId,
        authenticatedUser(request).id,
      );
      return reply.send({ success: true, data: preferences });
    }),
  );


  fastify.put(
    "/preferences/:channelId",
    { preHandler: [authenticate] },
    withErrorHandling(async (request, reply) => {
      const { orgId, projectId, channelId } = ProjectAlertChannelParamsSchema.parse(request.params);
      const body = UpsertMemberAlertChannelPreferenceBodySchema.parse(request.body);
      const preference = await service.upsertMyPreference(
        orgId,
        projectId,
        channelId,
        authenticatedUser(request).id,
        body,
        requestMeta(request),
      );
      return reply.send({ success: true, data: preference });
    }),
  );

  fastify.delete(
    "/preferences/:channelId",
    { preHandler: [authenticate] },
    withErrorHandling(async (request, reply) => {
      const { orgId, projectId, channelId } = ProjectAlertChannelParamsSchema.parse(request.params);
      const query = DeleteMemberAlertChannelPreferenceQuerySchema.parse(request.query ?? {});
      await service.deleteMyPreference(
        orgId,
        projectId,
        channelId,
        authenticatedUser(request).id,
        query,
        requestMeta(request),
      );
      return reply.code(204).send();
    }),
  );

  fastify.get(
    "/",
    { preHandler: [authenticate] },
    withErrorHandling(async (request, reply) => {
      const { orgId, projectId } = ProjectAlertChannelBaseParamsSchema.parse(request.params);
      const query = ListProjectAlertChannelsQuerySchema.parse(request.query ?? {});
      const result = await service.list(orgId, projectId, authenticatedUser(request).id, query);
      return reply.send({
        success: true,
        data: result.channels,
        meta: { total: result.total, limit: result.limit, offset: result.offset },
      });
    }),
  );

  fastify.post(
    "/",
    { preHandler: [authenticate] },
    withErrorHandling(async (request, reply) => {
      const { orgId, projectId } = ProjectAlertChannelBaseParamsSchema.parse(request.params);
      const body = CreateProjectAlertChannelBodySchema.parse(request.body);
      const channel = await service.create(
        orgId,
        projectId,
        authenticatedUser(request).id,
        body,
        requestMeta(request),
      );
      return reply.code(201).send({ success: true, data: channel });
    }),
  );


  fastify.get(
    "/:channelId",
    { preHandler: [authenticate] },
    withErrorHandling(async (request, reply) => {
      const { orgId, projectId, channelId } = ProjectAlertChannelParamsSchema.parse(request.params);
      const channel = await service.get(orgId, projectId, channelId, authenticatedUser(request).id);
      return reply.send({ success: true, data: channel });
    }),
  );

  fastify.patch(
    "/:channelId",
    { preHandler: [authenticate] },
    withErrorHandling(async (request, reply) => {
      const { orgId, projectId, channelId } = ProjectAlertChannelParamsSchema.parse(request.params);
      const body = UpdateProjectAlertChannelBodySchema.parse(request.body);
      const channel = await service.update(
        orgId,
        projectId,
        channelId,
        authenticatedUser(request).id,
        body,
        requestMeta(request),
      );
      return reply.send({ success: true, data: channel });
    }),
  );

  fastify.post(
    "/:channelId/toggle",
    { preHandler: [authenticate] },
    withErrorHandling(async (request, reply) => {
      const { orgId, projectId, channelId } = ProjectAlertChannelParamsSchema.parse(request.params);
      const body = ToggleProjectAlertChannelBodySchema.parse(request.body);
      const channel = await service.toggle(
        orgId,
        projectId,
        channelId,
        authenticatedUser(request).id,
        body,
        requestMeta(request),
      );
      return reply.send({ success: true, data: channel });
    }),
  );

  fastify.delete(
    "/:channelId",
    { preHandler: [authenticate] },
    withErrorHandling(async (request, reply) => {
      const { orgId, projectId, channelId } = ProjectAlertChannelParamsSchema.parse(request.params);
      await service.delete(
        orgId,
        projectId,
        channelId,
        authenticatedUser(request).id,
        requestMeta(request),
      );
      return reply.code(204).send();
    }),
  );
}