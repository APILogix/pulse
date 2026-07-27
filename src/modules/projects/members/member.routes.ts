/** Direct project-member management routes. */
import type { FastifyInstance } from "fastify";
import { authenticate } from "../../../shared/middleware/auth.js";
import {
  AddProjectMemberBodySchema,
  ListProjectMembersQuerySchema,
  ProjectMemberParamsSchema,
  ProjectParamsSchema,
  TransferOwnershipBodySchema,
  UpdateProjectMemberBodySchema,
} from "../types.js";
import { requestMeta, authenticatedUser, withErrorHandling } from "../shared/route-utils.js";

export async function projectMemberRoutes(fastify: FastifyInstance): Promise<void> {
  const service = fastify.projects.service.members;

  fastify.get(
    "/:projectId/members",
    { preHandler: [authenticate] },
    withErrorHandling(async (request, reply) => {
      const { orgId, projectId } = ProjectParamsSchema.parse(request.params);
      const query = ListProjectMembersQuerySchema.parse(request.query ?? {});
      const result = await service.listMembers(orgId, projectId, authenticatedUser(request).id, query);
      return reply.send({
        success: true,
        data: result.members,
        meta: { total: result.total, limit: result.limit, offset: result.offset },
      });
    }),
  );

  fastify.post(
    "/:projectId/members",
    { preHandler: [authenticate] },
    withErrorHandling(async (request, reply) => {
      const { orgId, projectId } = ProjectParamsSchema.parse(request.params);
      const body = AddProjectMemberBodySchema.parse(request.body);
      const member = await service.addMember(
        orgId, projectId, authenticatedUser(request).id, body, requestMeta(request),
      );
      return reply.code(201).send({ success: true, data: member });
    }),
  );

  fastify.patch(
    "/:projectId/members/:memberId",
    { preHandler: [authenticate] },
    withErrorHandling(async (request, reply) => {
      const { orgId, projectId, memberId } = ProjectMemberParamsSchema.parse(request.params);
      const body = UpdateProjectMemberBodySchema.parse(request.body);
      const member = await service.updateMemberRole(
        orgId, projectId, memberId, authenticatedUser(request).id, body, requestMeta(request),
      );
      return reply.send({ success: true, data: member });
    }),
  );
  fastify.delete(
    "/:projectId/members/:memberId",
    { preHandler: [authenticate] },
    withErrorHandling(async (request, reply) => {
      const { orgId, projectId, memberId } = ProjectMemberParamsSchema.parse(request.params);
      await service.removeMember(
        orgId, projectId, memberId, authenticatedUser(request).id, requestMeta(request),
      );
      return reply.code(204).send();
    }),
  );

  fastify.post(
    "/:projectId/transfer-ownership",
    { preHandler: [authenticate] },
    withErrorHandling(async (request, reply) => {
      const { orgId, projectId } = ProjectParamsSchema.parse(request.params);
      const body = TransferOwnershipBodySchema.parse(request.body);
      const result = await service.transferOwnership(
        orgId,
        projectId,
        authenticatedUser(request).id,
        body.newOwnerUserId,
        requestMeta(request),
      );
      return reply.send({ success: true, data: result });
    }),
  );
}
