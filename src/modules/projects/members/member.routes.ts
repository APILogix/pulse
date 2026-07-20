/**
 * Project member, invitation, and custom role route registration.
 *
 * Flow:
 * 1. Authenticate every endpoint.
 * 2. Parse params/query/body with module schemas before calling the service.
 * 3. Pass an audit-friendly RequestMeta into mutating calls so org audit logs
 *    capture actor, ip, user agent, request id, method, and endpoint.
 * 4. Normalize service errors through handleProjectError.
 *
 * Prefix: /organizations/:orgId/projects
 */
import type { FastifyInstance } from "fastify";
import { normalizeObjectKeys } from "../shared/schema-utils.js";
import { authenticate } from "../../../shared/middleware/auth.js";
import { z } from "zod";
import {
  AcceptProjectInvitationBodySchema,
  AddProjectMemberBodySchema,
  CreateProjectRoleBodySchema,
  InviteProjectMemberBodySchema,
  ListProjectInvitationsQuerySchema,
  ListProjectMembersQuerySchema,
  ProjectInvitationParamsSchema,
  ProjectMemberParamsSchema,
  ProjectParamsSchema,
  ProjectRoleParamsSchema,
  TransferOwnershipBodySchema,
  UpdateProjectMemberBodySchema,
  UpdateProjectRoleBodySchema,
} from "../types.js";
import { handleProjectError } from "../shared/utils.js";
import { requestMeta, authenticatedUser, withErrorHandling } from "../shared/route-utils.js";

export async function projectMemberRoutes(fastify: FastifyInstance): Promise<void> {
  const service = fastify.projects.service.members;

  // ── Project members ─────────────────────────────────────────────────────────

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
        orgId,
        projectId,
        authenticatedUser(request).id,
        body,
        requestMeta(request),
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
        orgId,
        projectId,
        memberId,
        authenticatedUser(request).id,
        body,
        requestMeta(request),
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
        orgId,
        projectId,
        memberId,
        authenticatedUser(request).id,
        requestMeta(request),
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

  // ── Invitations ───────────────────────────────────────────────────────────

  fastify.get(
    "/:projectId/invitations",
    { preHandler: [authenticate] },
    withErrorHandling(async (request, reply) => {
      const { orgId, projectId } = ProjectParamsSchema.parse(request.params);
      const query = ListProjectInvitationsQuerySchema.parse(request.query ?? {});
      const result = await service.listInvitations(orgId, projectId, authenticatedUser(request).id, query);
      return reply.send({
        success: true,
        data: result.invitations,
        meta: { total: result.total, limit: result.limit, offset: result.offset },
      });
    }),
  );

  fastify.post(
    "/:projectId/invitations",
    { preHandler: [authenticate] },
    withErrorHandling(async (request, reply) => {
      const { orgId, projectId } = ProjectParamsSchema.parse(request.params);
      const body = InviteProjectMemberBodySchema.parse(request.body);
      const { invitation, token } = await service.inviteMember(
        orgId,
        projectId,
        authenticatedUser(request).id,
        body,
        requestMeta(request),
      );
      return reply.code(201).send({
        success: true,
        data: { invitation, token },
        warning: "Share this token securely; it is shown only once.",
      });
    }),
  );

  fastify.post(
    "/:projectId/invitations/accept",
    { preHandler: [authenticate] },
    withErrorHandling(async (request, reply) => {
      const { orgId } = ProjectParamsSchema.parse(request.params);
      const body = AcceptProjectInvitationBodySchema.parse(request.body);
      const member = await service.acceptInvitation(
        orgId,
        authenticatedUser(request).id,
        body.token,
        requestMeta(request),
      );
      return reply.code(201).send({ success: true, data: member });
    }),
  );

  fastify.post(
    "/:projectId/invitations/:invitationId/decline",
    { preHandler: [authenticate] },
    withErrorHandling(async (request, reply) => {
      const { orgId, invitationId } = ProjectInvitationParamsSchema.parse(request.params);
      const invitation = await service.declineInvitation(
        orgId,
        authenticatedUser(request).id,
        invitationId,
        requestMeta(request),
      );
      return reply.send({ success: true, data: invitation });
    }),
  );

  fastify.delete(
    "/:projectId/invitations/:invitationId",
    { preHandler: [authenticate] },
    withErrorHandling(async (request, reply) => {
      const { orgId, projectId, invitationId } = ProjectInvitationParamsSchema.parse(request.params);
      const invitation = await service.cancelInvitation(
        orgId,
        projectId,
        invitationId,
        authenticatedUser(request).id,
        requestMeta(request),
      );
      return reply.send({ success: true, data: invitation });
    }),
  );

  // ── Custom roles ───────────────────────────────────────────────────────────

  fastify.get(
    "/:projectId/roles",
    { preHandler: [authenticate] },
    withErrorHandling(async (request, reply) => {
      const { orgId, projectId } = ProjectParamsSchema.parse(request.params);
      const roles = await service.listRoles(orgId, projectId, authenticatedUser(request).id);
      return reply.send({ success: true, data: roles });
    }),
  );

  fastify.post(
    "/:projectId/roles",
    { preHandler: [authenticate] },
    withErrorHandling(async (request, reply) => {
      const { orgId, projectId } = ProjectParamsSchema.parse(request.params);
      const body = CreateProjectRoleBodySchema.parse(request.body);
      const role = await service.createRole(
        orgId,
        projectId,
        authenticatedUser(request).id,
        body,
        requestMeta(request),
      );
      return reply.code(201).send({ success: true, data: role });
    }),
  );

  fastify.patch(
    "/:projectId/roles/:roleId",
    { preHandler: [authenticate] },
    withErrorHandling(async (request, reply) => {
      const { orgId, projectId, roleId } = ProjectRoleParamsSchema.parse(request.params);
      const body = UpdateProjectRoleBodySchema.parse(request.body);
      const role = await service.updateRole(
        orgId,
        projectId,
        roleId,
        authenticatedUser(request).id,
        body,
        requestMeta(request),
      );
      return reply.send({ success: true, data: role });
    }),
  );

  fastify.delete(
    "/:projectId/roles/:roleId",
    { preHandler: [authenticate] },
    withErrorHandling(async (request, reply) => {
      const { orgId, projectId, roleId } = ProjectRoleParamsSchema.parse(request.params);
      await service.deleteRole(
        orgId,
        projectId,
        roleId,
        authenticatedUser(request).id,
        requestMeta(request),
      );
      return reply.code(204).send();
    }),
  );
}

