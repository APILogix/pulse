import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { authenticate } from '../../shared/middleware/auth.js';
import { OrganizationService } from './organizationservice.js';
import {
  AcceptInvitationSchema,
  AddMemberSchema,
  AuditQuerySchema,
  CreateInvitationSchema,
  CreateOrganizationSchema,
  IdParamsSchema,
  InvitationListQuerySchema,
  InvitationParamsSchema,
  InvitationValidateQuerySchema,
  MemberParamsSchema,
  OrgIdParamsSchema,
  OrganizationError,
  SlugParamsSchema,
  UpdateBillingSchema,
  UpdateOrganizationSchema,
  UpdateRoleSchema,
  UpdateSecuritySchema,
  UpgradePlanSchema
} from './types.js';

type AuthenticatedRequest = FastifyRequest & {
  user: {
    id: string;
    email: string;
    isAdmin: boolean;
    sessionId: string;
    mfaVerified: boolean;
  };
};

function handleOrganizationError(error: unknown, reply: FastifyReply) {
  if (error instanceof OrganizationError) {
    return reply.code(error.statusCode).send({
      success: false,
      error: {
        code: error.code,
        message: error.message
      }
    });
  }

  if (error instanceof ZodError) {
    return reply.code(422).send({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details: error.flatten()
      }
    });
  }

  return reply.code(500).send({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Unexpected organization module error'
    }
  });
}

function withErrorHandling(
  handler: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>
) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      return await handler(request, reply);
    } catch (error) {
      request.log.error({ err: error, path: request.url }, 'Organization route failed');
      return handleOrganizationError(error, reply);
    }
  };
}

function asAuthenticated(request: FastifyRequest): AuthenticatedRequest {
  return request as AuthenticatedRequest;
}

function requestMeta(request: FastifyRequest) {
  const userAgentHeader = request.headers['user-agent'];
  return {
    ipAddress: request.ip ?? null,
    userAgent: typeof userAgentHeader === 'string' ? userAgentHeader : null
  };
}

export const organizationRoutes: FastifyPluginAsync<{ service: OrganizationService }> = async (
  fastify,
  { service }
) => {
  fastify.addHook('onRequest', async (request) => {
    request.log.info({ method: request.method, url: request.url }, 'Organization request start');
  });

  fastify.post(
    '/',
    { preHandler: [authenticate] },
    withErrorHandling(async (request, reply) => {
      const authed = asAuthenticated(request);
      const body = CreateOrganizationSchema.parse(request.body);
      const result = await service.createOrganization(body, authed.user.id, requestMeta(request));
      return reply.code(201).send({ success: true, data: result });
    })
  );

  fastify.get(
    '/',
    { preHandler: [authenticate] },
    withErrorHandling(async (request, reply) => {
      const authed = asAuthenticated(request);
      const result = await service.listUserOrganizations(authed.user.id);
      return reply.send({ success: true, data: result });
    })
  );

  fastify.get(
    '/:id',
    { preHandler: [authenticate] },
    withErrorHandling(async (request, reply) => {
      const authed = asAuthenticated(request);
      const { id } = IdParamsSchema.parse(request.params);
      const result = await service.getOrganization(id, authed.user.id);
      return reply.send({ success: true, data: result });
    })
  );

  fastify.patch(
    '/:id',
    { preHandler: [authenticate] },
    withErrorHandling(async (request, reply) => {
      const authed = asAuthenticated(request);
      const { id } = IdParamsSchema.parse(request.params);
      const body = UpdateOrganizationSchema.parse(request.body);
      const result = await service.updateOrganization(id, body, authed.user.id, requestMeta(request));
      return reply.send({ success: true, data: result });
    })
  );

  fastify.delete(
    '/:id',
    { preHandler: [authenticate] },
    withErrorHandling(async (request, reply) => {
      const authed = asAuthenticated(request);
      const { id } = IdParamsSchema.parse(request.params);
      await service.deleteOrganization(id, authed.user.id, requestMeta(request));
      return reply.code(204).send();
    })
  );

  fastify.post(
    '/:id/restore',
    { preHandler: [authenticate] },
    withErrorHandling(async (request, reply) => {
      const authed = asAuthenticated(request);
      const { id } = IdParamsSchema.parse(request.params);
      const result = await service.restoreOrganization(id, authed.user.id, requestMeta(request));
      return reply.send({ success: true, data: result });
    })
  );

  fastify.get(
    '/:id/audit-log',
    { preHandler: [authenticate] },
    withErrorHandling(async (request, reply) => {
      const authed = asAuthenticated(request);
      const { id } = IdParamsSchema.parse(request.params);
      const query = AuditQuerySchema.parse(request.query ?? {});
      const result = await service.getAuditLogs(id, authed.user.id, query.limit, query.offset);
      return reply.send({ success: true, data: result });
    })
  );

  fastify.get(
    '/:orgId/billing',
    { preHandler: [authenticate] },
    withErrorHandling(async (request, reply) => {
      const authed = asAuthenticated(request);
      const { orgId } = OrgIdParamsSchema.parse(request.params);
      const org = await service.getOrganization(orgId, authed.user.id);

      return reply.send({
        success: true,
        data: {
          billingEmail: org.billingEmail,
          billingName: org.billingName,
          billingAddress: org.billingAddress,
          planId: org.planId,
          planStartedAt: org.planStartedAt,
          planExpiresAt: org.planExpiresAt
        }
      });
    })
  );

  fastify.put(
    '/:orgId/billing',
    { preHandler: [authenticate] },
    withErrorHandling(async (request, reply) => {
      const authed = asAuthenticated(request);
      const { orgId } = OrgIdParamsSchema.parse(request.params);
      const body = UpdateBillingSchema.parse(request.body);
      const result = await service.updateBilling(orgId, body, authed.user.id, requestMeta(request));
      return reply.send({ success: true, data: result });
    })
  );

  fastify.get(
    '/:orgId/plan',
    { preHandler: [authenticate] },
    withErrorHandling(async (request, reply) => {
      const authed = asAuthenticated(request);
      const { orgId } = OrgIdParamsSchema.parse(request.params);
      const org = await service.getOrganization(orgId, authed.user.id);
      return reply.send({
        success: true,
        data: {
          planId: org.planId,
          status: org.status,
          trialEndsAt: org.trialEndsAt,
          planExpiresAt: org.planExpiresAt
        }
      });
    })
  );

  fastify.post(
    '/:orgId/plan/upgrade',
    { preHandler: [authenticate] },
    withErrorHandling(async (request, reply) => {
      const authed = asAuthenticated(request);
      const { orgId } = OrgIdParamsSchema.parse(request.params);
      const body = UpgradePlanSchema.parse(request.body);
      const result = await service.upgradePlan(orgId, body, authed.user.id, requestMeta(request));
      return reply.send({ success: true, data: result });
    })
  );

  fastify.get(
    '/:orgId/security-settings',
    { preHandler: [authenticate] },
    withErrorHandling(async (request, reply) => {
      const authed = asAuthenticated(request);
      const { orgId } = OrgIdParamsSchema.parse(request.params);
      const org = await service.getOrganization(orgId, authed.user.id, 'admin');
      return reply.send({
        success: true,
        data: {
          enforceSso: org.enforceSso,
          enforceMfa: org.enforceMfa,
          allowedEmailDomains: org.allowedEmailDomains,
          ipAllowlist: org.ipAllowlist,
          sessionTimeoutMinutes: org.sessionTimeoutMinutes
        }
      });
    })
  );

  fastify.put(
    '/:orgId/security-settings',
    { preHandler: [authenticate] },
    withErrorHandling(async (request, reply) => {
      const authed = asAuthenticated(request);
      const { orgId } = OrgIdParamsSchema.parse(request.params);
      const body = UpdateSecuritySchema.parse(request.body);
      const result = await service.updateSecuritySettings(orgId, body, authed.user.id, requestMeta(request));
      return reply.send({ success: true, data: result });
    })
  );

  fastify.get(
    '/:orgId/members',
    { preHandler: [authenticate] },
    withErrorHandling(async (request, reply) => {
      const authed = asAuthenticated(request);
      const { orgId } = OrgIdParamsSchema.parse(request.params);
      const result = await service.listMembers(orgId, authed.user.id);
      return reply.send({ success: true, data: result });
    })
  );

  fastify.get(
    '/:orgId/members/:userId',
    { preHandler: [authenticate] },
    withErrorHandling(async (request, reply) => {
      const authed = asAuthenticated(request);
      const { orgId, userId } = MemberParamsSchema.parse(request.params);
      const result = await service.getMember(orgId, userId, authed.user.id);
      return reply.send({ success: true, data: result });
    })
  );

  fastify.post(
    '/:orgId/members',
    { preHandler: [authenticate] },
    withErrorHandling(async (request, reply) => {
      const authed = asAuthenticated(request);
      const { orgId } = OrgIdParamsSchema.parse(request.params);
      const body = AddMemberSchema.parse(request.body);
      const result = await service.addMember(orgId, body, authed.user.id, requestMeta(request));
      return reply.code(201).send({ success: true, data: result });
    })
  );

  fastify.delete(
    '/:orgId/members/:userId',
    { preHandler: [authenticate] },
    withErrorHandling(async (request, reply) => {
      const authed = asAuthenticated(request);
      const { orgId, userId } = MemberParamsSchema.parse(request.params);
      await service.removeMember(orgId, userId, authed.user.id, undefined, requestMeta(request));
      return reply.code(204).send();
    })
  );

  fastify.patch(
    '/:orgId/members/:userId/role',
    { preHandler: [authenticate] },
    withErrorHandling(async (request, reply) => {
      const authed = asAuthenticated(request);
      const { orgId, userId } = MemberParamsSchema.parse(request.params);
      const body = UpdateRoleSchema.parse(request.body);
      await service.updateMemberRole(orgId, userId, body.role, authed.user.id, requestMeta(request));
      return reply.send({ success: true });
    })
  );

  fastify.post(
    '/:orgId/members/:userId/transfer-ownership',
    { preHandler: [authenticate] },
    withErrorHandling(async (request, reply) => {
      const authed = asAuthenticated(request);
      const { orgId, userId } = MemberParamsSchema.parse(request.params);
      await service.transferOwnership(orgId, userId, authed.user.id, requestMeta(request));
      return reply.send({ success: true });
    })
  );

  fastify.post(
    '/:orgId/leave',
    { preHandler: [authenticate] },
    withErrorHandling(async (request, reply) => {
      const authed = asAuthenticated(request);
      const { orgId } = OrgIdParamsSchema.parse(request.params);
      await service.leaveOrganization(orgId, authed.user.id, requestMeta(request));
      return reply.code(204).send();
    })
  );

  fastify.get(
    '/:orgId/invitations',
    { preHandler: [authenticate] },
    withErrorHandling(async (request, reply) => {
      const authed = asAuthenticated(request);
      const { orgId } = OrgIdParamsSchema.parse(request.params);
      const query = InvitationListQuerySchema.parse(request.query ?? {});
      const result = await service.listInvitations(orgId, authed.user.id, query.status);
      return reply.send({ success: true, data: result });
    })
  );

  fastify.post(
    '/:orgId/invitations',
    { preHandler: [authenticate] },
    withErrorHandling(async (request, reply) => {
      const authed = asAuthenticated(request);
      const { orgId } = OrgIdParamsSchema.parse(request.params);
      const body = CreateInvitationSchema.parse(request.body);
      const result = await service.inviteMember(orgId, body, authed.user.id, requestMeta(request));

      return reply.code(201).send({
        success: true,
        data: {
          invitation: result.invitation,
          token: result.token,
          inviteUrl: `${process.env.FRONTEND_URL ?? ''}/invite?token=${result.token}`
        }
      });
    })
  );

  fastify.post(
    '/invitations/accept',
    { preHandler: [authenticate] },
    withErrorHandling(async (request, reply) => {
      const authed = asAuthenticated(request);
      const body = AcceptInvitationSchema.parse(request.body);
      const result = await service.acceptInvitation(body.token, authed.user.id, authed.user.email, requestMeta(request));
      return reply.send({ success: true, data: result });
    })
  );

  fastify.get(
    '/invitations/validate',
    withErrorHandling(async (request, reply) => {
      const query = InvitationValidateQuerySchema.parse(request.query ?? {});
      const result = await service.validateInvitationToken(query.token);
      return reply.send({ success: true, data: result });
    })
  );

  fastify.post(
    '/invitations/:id/decline',
    { preHandler: [authenticate] },
    withErrorHandling(async (request, reply) => {
      const authed = asAuthenticated(request);
      const { id } = InvitationParamsSchema.parse(request.params);
      await service.declineInvitation(id, authed.user.id, requestMeta(request));
      return reply.send({ success: true });
    })
  );

  fastify.post(
    '/invitations/:id/resend',
    { preHandler: [authenticate] },
    withErrorHandling(async (request, reply) => {
      const authed = asAuthenticated(request);
      const { id } = InvitationParamsSchema.parse(request.params);
      await service.resendInvitation(id, authed.user.id, requestMeta(request));
      return reply.send({ success: true });
    })
  );

  fastify.delete(
    '/invitations/:id',
    { preHandler: [authenticate] },
    withErrorHandling(async (request, reply) => {
      const authed = asAuthenticated(request);
      const { id } = InvitationParamsSchema.parse(request.params);
      await service.revokeInvitation(id, authed.user.id, requestMeta(request));
      return reply.code(204).send();
    })
  );

  fastify.get(
    '/slug-available/:slug',
    withErrorHandling(async (request, reply) => {
      const { slug } = SlugParamsSchema.parse(request.params);
      const result = await service.checkSlugAvailability(slug);
      return reply.send({ success: true, data: result });
    })
  );
};
