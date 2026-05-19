/**
 * Organization route registration.
 *
 * All routes use:
 * - Zod validation on params/query/body
 * - RequestMeta for audit trail
 * - Standardized success/error responses
 * - withErrorHandling for consistent error mapping
 */
import type { FastifyInstance, FastifyPluginOptions, FastifyReply, FastifyRequest } from 'fastify';
import { env } from '../../config/env.js';
import { authenticate } from '../../shared/middleware/auth.js';
import {
  AcceptInvitationSchema,
  ApiKeyParamsSchema,
  AuditLogQuerySchema,
  CreateApiKeySchema,
  CreateEnvironmentSchema,
  CreateInvitationSchema,
  CreateOrganizationSchema,
  CreateQuotaRequestSchema,
  CreateSsoProviderSchema,
  CursorPaginationSchema,
  EnvironmentParamsSchema,
  IdParamsSchema,
  InvitationListQuerySchema,
  InvitationParamsSchema,
  InvitationValidateQuerySchema,
  MemberParamsSchema,
  MembersListQuerySchema,
  OrgIdParamsSchema,
  OrganizationError,
  QuotaRequestParamsSchema,
  RemoveMemberSchema,
  ReviewQuotaRequestSchema,
  ScimTokenParamsSchema,
  SecurityEventsQuerySchema,
  SlugParamsSchema,
  SsoProviderParamsSchema,
  SuspendMemberSchema,
  TransferOwnershipSchema,
  UpdateEnvironmentSchema,
  UpdateMemberRoleSchema,
  UpdateOrganizationSchema,
  UpdateSettingsSchema,
  UpdateSsoProviderSchema,
  type RequestMeta,
} from './types.js';

type AuthenticatedRequest = FastifyRequest & {
  user: { id: string; email: string; isAdmin: boolean; sessionId: string; mfaVerified: boolean };
};

function handleOrganizationError(error: unknown, reply: FastifyReply) {
  if (error instanceof OrganizationError) {
    return reply.code(error.statusCode).send({ success: false, error: { code: error.code, message: error.message } });
  }
  return reply.code(500).send({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Unexpected organization module error' } });
}

function withErrorHandling(handler: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    try { return await handler(request, reply); }
    catch (error) { return handleOrganizationError(error, reply); }
  };
}

function asAuth(request: FastifyRequest): AuthenticatedRequest { return request as AuthenticatedRequest; }

function buildMeta(request: FastifyRequest): RequestMeta {
  const user = asAuth(request).user;
  return {
    actorUserId: user.id,
    actorEmail: user.email,
    actorSessionId: user.sessionId,
    actorIp: request.ip ?? '',
    actorUserAgent: typeof request.headers['user-agent'] === 'string' ? request.headers['user-agent'] : null,
    httpMethod: request.method,
    endpoint: request.url,
    requestId: request.id,
  };
}

/** Strip undefined values from Zod output to satisfy exactOptionalPropertyTypes */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function strip<T>(obj: T): T {
  if (typeof obj !== 'object' || obj === null) return obj;
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) { if (v !== undefined) result[k] = v; }
  return result as T;
}

export async function organizationRoutes(fastify: FastifyInstance, _options: FastifyPluginOptions): Promise<void> {
  const svc = fastify.organization.service;
  const auth = { preHandler: [authenticate] };

  // ═══════════════════════════════════════════════
  // ORGANIZATION CRUD
  // ═══════════════════════════════════════════════

  fastify.post('/', auth, withErrorHandling(async (request, reply) => {
    const body = CreateOrganizationSchema.parse(request.body);
    const result = await svc.createOrganization(buildMeta(request), strip(body) as any);
    return reply.code(201).send({ success: true, data: result });
  }));

  fastify.get('/', auth, withErrorHandling(async (request, reply) => {
    const query = CursorPaginationSchema.parse(request.query ?? {});
    const result = await svc.listUserOrganizations(asAuth(request).user.id, query);
    return reply.send({ success: true, ...result });
  }));

  fastify.get('/:id', auth, withErrorHandling(async (request, reply) => {
    const { id } = IdParamsSchema.parse(request.params);
    const result = await svc.getOrganization(id, asAuth(request).user.id);
    return reply.send({ success: true, data: result });
  }));

  fastify.patch('/:id', auth, withErrorHandling(async (request, reply) => {
    const { id } = IdParamsSchema.parse(request.params);
    const body = UpdateOrganizationSchema.parse(request.body);
    const result = await svc.updateOrganization(buildMeta(request), id, body);
    return reply.send({ success: true, data: result });
  }));

  fastify.delete('/:id', auth, withErrorHandling(async (request, reply) => {
    const { id } = IdParamsSchema.parse(request.params);
    await svc.deleteOrganization(buildMeta(request), id);
    return reply.code(204).send();
  }));

  fastify.post('/:id/archive', auth, withErrorHandling(async (request, reply) => {
    const { id } = IdParamsSchema.parse(request.params);
    await svc.archiveOrganization(buildMeta(request), id);
    return reply.send({ success: true });
  }));

  fastify.post('/:id/restore', auth, withErrorHandling(async (request, reply) => {
    const { id } = IdParamsSchema.parse(request.params);
    const result = await svc.restoreOrganization(buildMeta(request), id);
    return reply.send({ success: true, data: result });
  }));

  fastify.post('/:id/transfer-ownership', auth, withErrorHandling(async (request, reply) => {
    const { id } = IdParamsSchema.parse(request.params);
    const body = TransferOwnershipSchema.parse(request.body);
    await svc.transferOwnership(buildMeta(request), id, body.newOwnerUserId);
    return reply.send({ success: true });
  }));

  // ═══════════════════════════════════════════════
  // SETTINGS
  // ═══════════════════════════════════════════════

  fastify.get('/:orgId/settings', auth, withErrorHandling(async (request, reply) => {
    const { orgId } = OrgIdParamsSchema.parse(request.params);
    const result = await svc.getSettings(orgId, asAuth(request).user.id);
    return reply.send({ success: true, data: result });
  }));

  fastify.patch('/:orgId/settings', auth, withErrorHandling(async (request, reply) => {
    const { orgId } = OrgIdParamsSchema.parse(request.params);
    const body = UpdateSettingsSchema.parse(request.body);
    const result = await svc.updateSettings(buildMeta(request), orgId, body);
    return reply.send({ success: true, data: result });
  }));

  // ═══════════════════════════════════════════════
  // MEMBERS
  // ═══════════════════════════════════════════════

  fastify.get('/:orgId/members', auth, withErrorHandling(async (request, reply) => {
    const { orgId } = OrgIdParamsSchema.parse(request.params);
    const query = MembersListQuerySchema.parse(request.query ?? {});
    const { status, role, ...pagination } = query;
    const result = await svc.listMembers(orgId, asAuth(request).user.id, pagination, strip({ status, role }) as any);
    return reply.send({ success: true, ...result });
  }));

  fastify.get('/:orgId/members/:userId', auth, withErrorHandling(async (request, reply) => {
    const { orgId, userId } = MemberParamsSchema.parse(request.params);
    const result = await svc.getMember(orgId, asAuth(request).user.id, userId);
    return reply.send({ success: true, data: result });
  }));

  fastify.patch('/:orgId/members/:userId/role', auth, withErrorHandling(async (request, reply) => {
    const { orgId, userId } = MemberParamsSchema.parse(request.params);
    const body = UpdateMemberRoleSchema.parse(request.body);
    await svc.updateMemberRole(buildMeta(request), orgId, userId, body.role);
    return reply.send({ success: true });
  }));

  fastify.delete('/:orgId/members/:userId', auth, withErrorHandling(async (request, reply) => {
    const { orgId, userId } = MemberParamsSchema.parse(request.params);
    const body = RemoveMemberSchema.parse(request.body ?? {});
    await svc.removeMember(buildMeta(request), orgId, userId);
    return reply.code(204).send();
  }));

  fastify.post('/:orgId/members/:userId/suspend', auth, withErrorHandling(async (request, reply) => {
    const { orgId, userId } = MemberParamsSchema.parse(request.params);
    await svc.suspendMember(buildMeta(request), orgId, userId);
    return reply.send({ success: true });
  }));

  fastify.post('/:orgId/members/:userId/reactivate', auth, withErrorHandling(async (request, reply) => {
    const { orgId, userId } = MemberParamsSchema.parse(request.params);
    await svc.reactivateMember(buildMeta(request), orgId, userId);
    return reply.send({ success: true });
  }));

  fastify.post('/:orgId/leave', auth, withErrorHandling(async (request, reply) => {
    const { orgId } = OrgIdParamsSchema.parse(request.params);
    await svc.leaveOrganization(buildMeta(request), orgId);
    return reply.code(204).send();
  }));

  // ═══════════════════════════════════════════════
  // INVITATIONS
  // ═══════════════════════════════════════════════

  fastify.get('/:orgId/invitations', auth, withErrorHandling(async (request, reply) => {
    const { orgId } = OrgIdParamsSchema.parse(request.params);
    const query = InvitationListQuerySchema.parse(request.query ?? {});
    const { status, ...pagination } = query;
    const result = await svc.listInvitations(orgId, asAuth(request).user.id, pagination, status);
    return reply.send({ success: true, ...result });
  }));

  fastify.post('/:orgId/invitations', auth, withErrorHandling(async (request, reply) => {
    const { orgId } = OrgIdParamsSchema.parse(request.params);
    const body = CreateInvitationSchema.parse(request.body);
    const result = await svc.inviteMember(buildMeta(request), orgId, body.email, body.role);
    return reply.code(201).send({
      success: true,
      data: { invitation: result, token: result.token, inviteUrl: `${env.FRONTEND_URL ?? ''}/invite?token=${result.token}` }
    });
  }));

  fastify.post('/:orgId/invitations/:invitationId/resend', auth, withErrorHandling(async (request, reply) => {
    const { orgId, invitationId } = (request.params as { orgId: string; invitationId: string });
    await svc.resendInvitation(buildMeta(request), orgId, invitationId);
    return reply.send({ success: true });
  }));

  fastify.delete('/:orgId/invitations/:invitationId', auth, withErrorHandling(async (request, reply) => {
    const { orgId, invitationId } = (request.params as { orgId: string; invitationId: string });
    await svc.revokeInvitation(buildMeta(request), orgId, invitationId);
    return reply.code(204).send();
  }));

  fastify.post('/invitations/accept', auth, withErrorHandling(async (request, reply) => {
    const body = AcceptInvitationSchema.parse(request.body);
    await svc.acceptInvitation(buildMeta(request), body.token);
    return reply.send({ success: true });
  }));

  fastify.post('/invitations/:id/decline', auth, withErrorHandling(async (request, reply) => {
    const { id } = InvitationParamsSchema.parse(request.params);
    await svc.declineInvitation(buildMeta(request), id);
    return reply.send({ success: true });
  }));

  fastify.get('/invitations/validate', withErrorHandling(async (request, reply) => {
    const query = InvitationValidateQuerySchema.parse(request.query ?? {});
    const result = await svc.validateInvitationToken(query.token);
    return reply.send({ success: true, data: result });
  }));

  // ═══════════════════════════════════════════════
  // ENVIRONMENTS
  // ═══════════════════════════════════════════════

  fastify.get('/:orgId/environments', auth, withErrorHandling(async (request, reply) => {
    const { orgId } = OrgIdParamsSchema.parse(request.params);
    const result = await svc.listEnvironments(orgId, asAuth(request).user.id);
    return reply.send({ success: true, data: result });
  }));

  fastify.post('/:orgId/environments', auth, withErrorHandling(async (request, reply) => {
    const { orgId } = OrgIdParamsSchema.parse(request.params);
    const body = CreateEnvironmentSchema.parse(request.body);
    const result = await svc.createEnvironment(buildMeta(request), orgId, strip(body) as any);
    return reply.code(201).send({ success: true, data: result });
  }));

  fastify.patch('/:orgId/environments/:envId', auth, withErrorHandling(async (request, reply) => {
    const { orgId, envId } = EnvironmentParamsSchema.parse(request.params);
    const body = UpdateEnvironmentSchema.parse(request.body);
    const result = await svc.updateEnvironment(buildMeta(request), orgId, envId, body);
    return reply.send({ success: true, data: result });
  }));

  // ═══════════════════════════════════════════════
  // API KEYS
  // ═══════════════════════════════════════════════

  fastify.get('/:orgId/api-keys', auth, withErrorHandling(async (request, reply) => {
    const { orgId } = OrgIdParamsSchema.parse(request.params);
    const query = CursorPaginationSchema.parse(request.query ?? {});
    const result = await svc.listApiKeys(orgId, asAuth(request).user.id, query);
    return reply.send({ success: true, ...result });
  }));

  fastify.post('/:orgId/api-keys', auth, withErrorHandling(async (request, reply) => {
    const { orgId } = OrgIdParamsSchema.parse(request.params);
    const body = CreateApiKeySchema.parse(request.body);
    const result = await svc.createApiKey(buildMeta(request), orgId, strip(body) as any);
    return reply.code(201).send({ success: true, data: result });
  }));

  fastify.delete('/:orgId/api-keys/:keyId', auth, withErrorHandling(async (request, reply) => {
    const { orgId, keyId } = ApiKeyParamsSchema.parse(request.params);
    await svc.revokeApiKey(buildMeta(request), orgId, keyId);
    return reply.code(204).send();
  }));

  fastify.post('/:orgId/api-keys/:keyId/rotate', auth, withErrorHandling(async (request, reply) => {
    const { orgId, keyId } = ApiKeyParamsSchema.parse(request.params);
    const result = await svc.rotateApiKey(buildMeta(request), orgId, keyId);
    return reply.send({ success: true, data: result });
  }));

  // ═══════════════════════════════════════════════
  // SSO PROVIDERS
  // ═══════════════════════════════════════════════

  fastify.get('/:orgId/sso', auth, withErrorHandling(async (request, reply) => {
    const { orgId } = OrgIdParamsSchema.parse(request.params);
    const result = await svc.listSsoProviders(orgId, asAuth(request).user.id);
    return reply.send({ success: true, data: result });
  }));

  fastify.post('/:orgId/sso', auth, withErrorHandling(async (request, reply) => {
    const { orgId } = OrgIdParamsSchema.parse(request.params);
    const body = CreateSsoProviderSchema.parse(request.body);
    const result = await svc.createSsoProvider(buildMeta(request), orgId, body);
    return reply.code(201).send({ success: true, data: result });
  }));

  fastify.patch('/:orgId/sso/:ssoId', auth, withErrorHandling(async (request, reply) => {
    const { orgId, ssoId } = SsoProviderParamsSchema.parse(request.params);
    const body = UpdateSsoProviderSchema.parse(request.body);
    const result = await svc.updateSsoProvider(buildMeta(request), orgId, ssoId, body);
    return reply.send({ success: true, data: result });
  }));

  fastify.delete('/:orgId/sso/:ssoId', auth, withErrorHandling(async (request, reply) => {
    const { orgId, ssoId } = SsoProviderParamsSchema.parse(request.params);
    await svc.deleteSsoProvider(buildMeta(request), orgId, ssoId);
    return reply.code(204).send();
  }));

  // ═══════════════════════════════════════════════
  // SCIM TOKENS
  // ═══════════════════════════════════════════════

  fastify.get('/:orgId/scim-tokens', auth, withErrorHandling(async (request, reply) => {
    const { orgId } = OrgIdParamsSchema.parse(request.params);
    const result = await svc.listScimTokens(orgId, asAuth(request).user.id);
    return reply.send({ success: true, data: result });
  }));

  fastify.post('/:orgId/scim-tokens', auth, withErrorHandling(async (request, reply) => {
    const { orgId } = OrgIdParamsSchema.parse(request.params);
    const result = await svc.createScimToken(buildMeta(request), orgId);
    return reply.code(201).send({ success: true, data: result });
  }));

  fastify.delete('/:orgId/scim-tokens/:tokenId', auth, withErrorHandling(async (request, reply) => {
    const { orgId, tokenId } = ScimTokenParamsSchema.parse(request.params);
    await svc.revokeScimToken(buildMeta(request), orgId, tokenId);
    return reply.code(204).send();
  }));

  // ═══════════════════════════════════════════════
  // SECURITY & AUDIT
  // ═══════════════════════════════════════════════

  fastify.get('/:orgId/security-events', auth, withErrorHandling(async (request, reply) => {
    const { orgId } = OrgIdParamsSchema.parse(request.params);
    const query = SecurityEventsQuerySchema.parse(request.query ?? {});
    const { severity, eventType, ...pagination } = query;
    const result = await svc.listSecurityEvents(orgId, asAuth(request).user.id, pagination, strip({ severity, eventType }) as any);
    return reply.send({ success: true, ...result });
  }));

  fastify.get('/:orgId/audit-logs', auth, withErrorHandling(async (request, reply) => {
    const { orgId } = OrgIdParamsSchema.parse(request.params);
    const query = AuditLogQuerySchema.parse(request.query ?? {});
    const { action, entityType, actorUserId, ...pagination } = query;
    const result = await svc.listAuditLogs(orgId, asAuth(request).user.id, pagination, strip({ action, entityType, actorUserId }) as any);
    return reply.send({ success: true, ...result });
  }));

  fastify.get('/:orgId/audit-logs/export', auth, withErrorHandling(async (request, reply) => {
    const { orgId } = OrgIdParamsSchema.parse(request.params);
    const query = AuditLogQuerySchema.parse(request.query ?? {});
    const result = await svc.exportAuditLogs(orgId, asAuth(request).user.id, strip({ action: query.action, entityType: query.entityType, actorUserId: query.actorUserId }) as any);
    return reply.send({ success: true, data: result });
  }));

  // ═══════════════════════════════════════════════
  // QUOTAS
  // ═══════════════════════════════════════════════

  fastify.get('/:orgId/quota-requests', auth, withErrorHandling(async (request, reply) => {
    const { orgId } = OrgIdParamsSchema.parse(request.params);
    const query = CursorPaginationSchema.parse(request.query ?? {});
    const result = await svc.listQuotaRequests(orgId, asAuth(request).user.id, query);
    return reply.send({ success: true, ...result });
  }));

  fastify.post('/:orgId/quota-requests', auth, withErrorHandling(async (request, reply) => {
    const { orgId } = OrgIdParamsSchema.parse(request.params);
    const body = CreateQuotaRequestSchema.parse(request.body);
    const result = await svc.createQuotaRequest(buildMeta(request), orgId, body);
    return reply.code(201).send({ success: true, data: result });
  }));

  fastify.post('/:orgId/quota-requests/:requestId/approve', auth, withErrorHandling(async (request, reply) => {
    const { orgId, requestId } = QuotaRequestParamsSchema.parse(request.params);
    const body = ReviewQuotaRequestSchema.parse(request.body ?? {});
    const result = await svc.approveQuotaRequest(buildMeta(request), orgId, requestId, body.notes);
    return reply.send({ success: true, data: result });
  }));

  fastify.post('/:orgId/quota-requests/:requestId/reject', auth, withErrorHandling(async (request, reply) => {
    const { orgId, requestId } = QuotaRequestParamsSchema.parse(request.params);
    const body = ReviewQuotaRequestSchema.parse(request.body ?? {});
    const result = await svc.rejectQuotaRequest(buildMeta(request), orgId, requestId, body.notes);
    return reply.send({ success: true, data: result });
  }));

  // ═══════════════════════════════════════════════
  // UTILITY
  // ═══════════════════════════════════════════════

  fastify.get('/slug-available/:slug', withErrorHandling(async (request, reply) => {
    const { slug } = SlugParamsSchema.parse(request.params);
    const result = await svc.checkSlugAvailability(slug);
    return reply.send({ success: true, data: result });
  }));
}
