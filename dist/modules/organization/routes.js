import { authenticate } from '../../shared/middleware/auth.js';
import { ACCESS_TOKEN_TTL_SECONDS } from '../auth/domain/constants.js';
import { generateAccessToken } from '../auth/infrastructure/crypto/jwt.js';
import { AcceptInvitationSchema, AuditLogQuerySchema, CreateInvitationSchema, CreateOrganizationSchema, CreateScimTokenSchema, CreateSsoProviderSchema, CursorPaginationSchema, IdParamsSchema, InvitationListQuerySchema, InvitationIdParamsSchema, InvitationParamsSchema, InvitationValidateQuerySchema, MemberParamsSchema, MembersListQuerySchema, OrgIdParamsSchema, OrganizationError, RemoveMemberSchema, ScimTokenParamsSchema, SecurityEventsQuerySchema, SlugParamsSchema, SsoProviderParamsSchema, SuspendMemberSchema, SwitchOrganizationSchema, TransferOwnershipSchema, UpdateMemberRoleSchema, UpdateOrganizationSchema, UpdateSettingsSchema, UpdateSsoProviderSchema, } from './types.js';
import { registerDomainRoutes } from './domains/domains.routes.js';
import { registerSdkConfigRoutes } from './sdk-config/sdk-config.routes.js';
function handleOrganizationError(error, reply) {
    console.log('[organization.handleError]', error);
    if (error instanceof OrganizationError) {
        return reply.code(error.statusCode).send({ success: false, error: { code: error.code, message: error.message } });
    }
    return reply.code(500).send({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Unexpected organization module error' } });
}
function withErrorHandling(handler) {
    return async (request, reply) => {
        try {
            return await handler(request, reply);
        }
        catch (error) {
            return handleOrganizationError(error, reply);
        }
    };
}
function asAuth(request) { return request; }
function buildMeta(request) {
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
function strip(obj) {
    if (typeof obj !== 'object' || obj === null)
        return obj;
    const result = {};
    for (const [k, v] of Object.entries(obj)) {
        if (v !== undefined)
            result[k] = v;
    }
    return result;
}
export async function organizationRoutes(fastify, _options) {
    const svc = fastify.organization.service;
    const auth = { preHandler: [authenticate] };
    // SDK Remote Config routes (/:orgId/sdk-configs ...).
    registerSdkConfigRoutes(fastify, fastify.organization.sdkConfigService);
    await registerDomainRoutes(fastify, svc.domains);
    // ═══════════════════════════════════════════════
    // ORGANIZATION CRUD
    // ═══════════════════════════════════════════════
    fastify.post('/', auth, withErrorHandling(async (request, reply) => {
        const body = CreateOrganizationSchema.parse(request.body);
        const result = await svc.createOrganization(buildMeta(request), strip(body));
        return reply.code(201).send({ success: true, data: result });
    }));
    fastify.post('/switch', auth, withErrorHandling(async (request, reply) => {
        const body = SwitchOrganizationSchema.parse(request.body);
        const user = asAuth(request).user;
        await svc.switchOrganization(buildMeta(request), body.orgId);
        const accessToken = generateAccessToken(user.id, user.sessionId, user.mfaVerified);
        return reply.send({
            data: {
                access_token: accessToken,
                expires_at: new Date(Date.now() + ACCESS_TOKEN_TTL_SECONDS * 1000),
                session_id: user.sessionId,
                token_type: 'Bearer',
                current_org_id: body.orgId,
            },
        });
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
        const result = await svc.listMembers(orgId, asAuth(request).user.id, pagination, strip({ status, role }));
        return reply.send({ success: true, ...result });
    }));
    // Caller's own membership in the org (role/status). Used by dashboards to
    // decide which actions to surface without leaking the full member list.
    fastify.get('/:orgId/members/me', auth, withErrorHandling(async (request, reply) => {
        const { orgId } = OrgIdParamsSchema.parse(request.params);
        const userId = asAuth(request).user.id;
        const result = await svc.getMember(orgId, userId, userId);
        return reply.send({ success: true, data: result });
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
            data: {
                invitation: {
                    id: result.id,
                    email: result.email,
                    role: result.role,
                    status: result.status,
                    expiresAt: result.expiresAt,
                    invitedAt: result.invitedAt,
                    invitedBy: result.invitedBy,
                },
                accountExists: result.accountExists,
                emailSent: result.emailSent,
            },
        });
    }));
    fastify.post('/:orgId/invitations/:invitationId/resend', auth, withErrorHandling(async (request, reply) => {
        const { orgId, invitationId } = InvitationIdParamsSchema.parse(request.params);
        const result = await svc.resendInvitation(buildMeta(request), orgId, invitationId);
        return reply.send({ success: true, data: { accountExists: result.accountExists } });
    }));
    fastify.delete('/:orgId/invitations/:invitationId', auth, withErrorHandling(async (request, reply) => {
        const { orgId, invitationId } = InvitationIdParamsSchema.parse(request.params);
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
        const body = CreateScimTokenSchema.parse(request.body ?? {});
        const input = {
            scopes: body.scopes,
            ...(body.allowedIps !== undefined ? { allowedIps: body.allowedIps } : {}),
            ...(body.expiresInDays !== undefined ? { expiresInDays: body.expiresInDays } : {}),
        };
        const result = await svc.createScimToken(buildMeta(request), orgId, input);
        return reply.code(201).send({ success: true, data: result });
    }));
    fastify.post('/:orgId/scim-tokens/:tokenId/rotate', auth, withErrorHandling(async (request, reply) => {
        const { orgId, tokenId } = ScimTokenParamsSchema.parse(request.params);
        const result = await svc.rotateScimToken(buildMeta(request), orgId, tokenId);
        return reply.send({ success: true, data: result });
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
        const result = await svc.listSecurityEvents(orgId, asAuth(request).user.id, pagination, strip({ severity, eventType }));
        return reply.send({ success: true, ...result });
    }));
    fastify.get('/:orgId/audit-logs', auth, withErrorHandling(async (request, reply) => {
        const { orgId } = OrgIdParamsSchema.parse(request.params);
        const query = AuditLogQuerySchema.parse(request.query ?? {});
        const { action, entityType, actorUserId, ...pagination } = query;
        const result = await svc.listAuditLogs(orgId, asAuth(request).user.id, pagination, strip({ action, entityType, actorUserId }));
        return reply.send({ success: true, ...result });
    }));
    fastify.get('/:orgId/audit-logs/export', auth, withErrorHandling(async (request, reply) => {
        const { orgId } = OrgIdParamsSchema.parse(request.params);
        const query = AuditLogQuerySchema.parse(request.query ?? {});
        const result = await svc.exportAuditLogs(orgId, asAuth(request).user.id, strip({ action: query.action, entityType: query.entityType, actorUserId: query.actorUserId }));
        return reply.send({ success: true, data: result });
    }));
    // ═══════════════════════════════════════════════
    // QUOTAS
    // ═══════════════════════════════════════════════
    // ═══════════════════════════════════════════════
    // UTILITY
    // ═══════════════════════════════════════════════
    fastify.get('/:orgId/billing-summary', auth, withErrorHandling(async (request, reply) => {
        const { orgId } = OrgIdParamsSchema.parse(request.params);
        const result = await svc.getBillingSummary(orgId, asAuth(request).user.id);
        return reply.send({ success: true, data: result });
    }));
    fastify.get('/:orgId/usage-limits', auth, withErrorHandling(async (request, reply) => {
        const { orgId } = OrgIdParamsSchema.parse(request.params);
        const result = await svc.getUsageLimits(orgId, asAuth(request).user.id);
        return reply.send({ success: true, data: result });
    }));
    fastify.get('/slug-available/:slug', withErrorHandling(async (request, reply) => {
        const { slug } = SlugParamsSchema.parse(request.params);
        const result = await svc.checkSlugAvailability(slug);
        return reply.send({ success: true, data: result });
    }));
    // Resolve an organization the caller belongs to by slug. Returns 404 for
    // non-members too (do not leak which slugs exist across tenants).
    fastify.get('/by-slug/:slug', auth, withErrorHandling(async (request, reply) => {
        const { slug } = SlugParamsSchema.parse(request.params);
        const result = await svc.getOrganizationBySlug(slug, asAuth(request).user.id);
        return reply.send({ success: true, data: result });
    }));
}
//# sourceMappingURL=routes.js.map