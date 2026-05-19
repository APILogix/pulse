import { OrganizationRepository } from "./repository.js";
import { generateToken, hashToken } from "./utils.js";
import { hasMinRole, canManageRole, isMutableOrg, OrganizationError, ForbiddenError, NotFoundError, OrgStatusError, ConflictError, ValidationError, } from "./types.js";
// ── DTO Mappers ─────────────────────────────────
function toOrgDto(r) {
    return { id: r.id, name: r.name, slug: r.slug, description: r.description, logoUrl: r.logo_url, websiteUrl: r.website_url, industry: r.industry, companySize: r.company_size, country: r.country, timezone: r.timezone, billingEmail: r.billing_email, supportEmail: r.support_email, ownerUserId: r.owner_user_id, status: r.status, createdAt: r.created_at, updatedAt: r.updated_at };
}
function toSettingsDto(r) {
    return { enforceSso: r.enforce_sso, enforceMfa: r.enforce_mfa, sessionTimeoutMinutes: r.session_timeout_minutes, dataRegion: r.data_region, dataRetentionDays: r.data_retention_days, auditLogRetentionDays: r.audit_log_retention_days, allowPublicProjects: r.allow_public_projects };
}
function toMemberDto(r) {
    return { id: r.id, userId: r.user_id, email: r.email, fullName: r.full_name, role: r.role, status: r.status, joinedAt: r.joined_at, lastActiveAt: r.last_active_at, createdAt: r.created_at };
}
function toInviteDto(r) {
    return { id: r.id, email: r.email, role: r.role, status: r.status, expiresAt: r.expires_at, invitedAt: r.created_at, invitedBy: { id: r.invited_by, email: r.invited_by_email ?? null, name: r.invited_by_name ?? null } };
}
export class OrganizationService {
    repo;
    log;
    emitEvent;
    constructor(deps) {
        this.repo = deps.repository;
        this.log = deps.logger;
        this.emitEvent = deps.emitEvent;
    }
    // ── Helpers ───────────────────────────────────
    async audit(meta, data) {
        try {
            await this.repo.createAuditLog({ ...data, actorUserId: meta.actorUserId, actorEmail: meta.actorEmail, actorIp: meta.actorIp, actorUserAgent: meta.actorUserAgent, actorSessionId: meta.actorSessionId, requestId: meta.requestId, httpMethod: meta.httpMethod, endpoint: meta.endpoint });
        }
        catch (e) {
            this.log.error({ err: e }, "Audit log write failed");
        }
    }
    async requireMember(orgId, userId, minRole = "viewer") {
        const member = await this.repo.findActiveMember(orgId, userId);
        if (!member)
            throw new ForbiddenError("Not a member of this organization");
        if (!hasMinRole(member.role, minRole))
            throw new ForbiddenError(`Requires ${minRole} role or higher`);
        return member;
    }
    async requireMutableOrg(orgId) {
        const org = await this.repo.findOrgById(orgId);
        if (!org)
            throw new NotFoundError("Organization");
        if (!isMutableOrg(org.status))
            throw new OrgStatusError(org.status);
        return org;
    }
    // ── Organization CRUD ─────────────────────────
    async createOrganization(meta, data) {
        const org = await this.repo.createOrg(data.name, meta.actorUserId, data);
        await this.audit(meta, { orgId: org.id, action: "org.created", entityType: "organization", entityId: org.id, entityName: org.name, newValues: { name: org.name, slug: org.slug } });
        return toOrgDto(org);
    }
    async getOrganization(orgId, userId) {
        await this.requireMember(orgId, userId);
        const org = await this.repo.findOrgById(orgId);
        if (!org)
            throw new NotFoundError("Organization");
        return toOrgDto(org);
    }
    async getOrganizationBySlug(slug, userId) {
        const org = await this.repo.findOrgBySlug(slug);
        if (!org)
            throw new NotFoundError("Organization");
        await this.requireMember(org.id, userId);
        return toOrgDto(org);
    }
    async updateOrganization(meta, orgId, data) {
        const oldOrg = await this.requireMutableOrg(orgId);
        await this.requireMember(orgId, meta.actorUserId, "admin");
        const updated = await this.repo.updateOrg(orgId, data);
        const changed = Object.keys(data).filter(k => data[k] !== undefined);
        await this.audit(meta, { orgId, action: "org.updated", entityType: "organization", entityId: orgId, entityName: updated.name, oldValues: { name: oldOrg.name }, newValues: { name: updated.name }, changedFields: changed });
        return toOrgDto(updated);
    }
    async deleteOrganization(meta, orgId) {
        await this.requireMutableOrg(orgId);
        const m = await this.requireMember(orgId, meta.actorUserId, "owner");
        await this.repo.softDeleteOrg(orgId);
        await this.audit(meta, { orgId, action: "org.deleted", entityType: "organization", entityId: orgId, isSensitive: true });
    }
    async archiveOrganization(meta, orgId) {
        await this.requireMember(orgId, meta.actorUserId, "owner");
        await this.repo.archiveOrg(orgId);
        await this.audit(meta, { orgId, action: "org.archived", entityType: "organization", entityId: orgId });
    }
    async restoreOrganization(meta, orgId) {
        await this.requireMember(orgId, meta.actorUserId, "owner");
        const org = await this.repo.restoreOrg(orgId);
        await this.audit(meta, { orgId, action: "org.restored", entityType: "organization", entityId: orgId });
        return toOrgDto(org);
    }
    async transferOwnership(meta, orgId, newOwnerUserId) {
        await this.requireMutableOrg(orgId);
        await this.requireMember(orgId, meta.actorUserId, "owner");
        const target = await this.repo.findActiveMember(orgId, newOwnerUserId);
        if (!target)
            throw new NotFoundError("Target member");
        await this.repo.transferOwnership(orgId, meta.actorUserId, newOwnerUserId);
        await this.audit(meta, { orgId, action: "org.ownership_transferred", entityType: "organization", entityId: orgId, newValues: { newOwner: newOwnerUserId }, isSensitive: true });
    }
    // ── Settings ──────────────────────────────────
    async getSettings(orgId, userId) {
        await this.requireMember(orgId, userId, "admin");
        const s = await this.repo.getSettings(orgId);
        if (!s)
            throw new NotFoundError("Settings");
        return toSettingsDto(s);
    }
    async updateSettings(meta, orgId, data) {
        await this.requireMutableOrg(orgId);
        await this.requireMember(orgId, meta.actorUserId, "admin");
        const old = await this.repo.getSettings(orgId);
        const s = await this.repo.updateSettings(orgId, data);
        await this.audit(meta, { orgId, action: "org.settings_updated", entityType: "settings", entityId: orgId, oldValues: old, newValues: s, changedFields: Object.keys(data), isSensitive: true });
        return toSettingsDto(s);
    }
    // ── Members ───────────────────────────────────
    async listMembers(orgId, userId, q, filters) {
        await this.requireMember(orgId, userId);
        const result = await this.repo.listMembers(orgId, q, filters);
        return { data: result.data.map(toMemberDto), meta: result.meta };
    }
    async getMember(orgId, actorUserId, targetUserId) {
        await this.requireMember(orgId, actorUserId);
        const m = await this.repo.findMember(orgId, targetUserId);
        if (!m)
            throw new NotFoundError("Member");
        return toMemberDto(m);
    }
    async updateMemberRole(meta, orgId, targetUserId, newRole) {
        await this.requireMutableOrg(orgId);
        const actor = await this.requireMember(orgId, meta.actorUserId, "admin");
        if (meta.actorUserId === targetUserId)
            throw new ForbiddenError("Cannot change own role");
        const target = await this.repo.findActiveMember(orgId, targetUserId);
        if (!target)
            throw new NotFoundError("Member");
        if (!canManageRole(actor.role, target.role))
            throw new ForbiddenError("Cannot manage a user with equal or higher role");
        if (newRole === "owner")
            throw new ValidationError("Use transfer ownership endpoint");
        const oldRole = target.role;
        await this.repo.updateMemberRole(orgId, targetUserId, newRole);
        await this.audit(meta, { orgId, action: "member.role_updated", entityType: "member", entityId: targetUserId, oldValues: { role: oldRole }, newValues: { role: newRole } });
    }
    async removeMember(meta, orgId, targetUserId) {
        await this.requireMutableOrg(orgId);
        const actor = await this.requireMember(orgId, meta.actorUserId, "admin");
        if (meta.actorUserId === targetUserId)
            throw new ForbiddenError("Cannot remove yourself");
        const target = await this.repo.findActiveMember(orgId, targetUserId);
        if (!target)
            throw new NotFoundError("Member");
        if (!canManageRole(actor.role, target.role))
            throw new ForbiddenError("Cannot remove a user with equal or higher role");
        if (target.role === "owner") {
            const c = await this.repo.countOwners(orgId);
            if (c <= 1)
                throw new ForbiddenError("Cannot remove the last owner");
        }
        await this.repo.removeMember(orgId, targetUserId, meta.actorUserId);
        await this.audit(meta, { orgId, action: "member.removed", entityType: "member", entityId: targetUserId, isSensitive: true });
    }
    async suspendMember(meta, orgId, targetUserId) {
        await this.requireMutableOrg(orgId);
        const actor = await this.requireMember(orgId, meta.actorUserId, "admin");
        const target = await this.repo.findActiveMember(orgId, targetUserId);
        if (!target)
            throw new NotFoundError("Member");
        if (!canManageRole(actor.role, target.role))
            throw new ForbiddenError("Cannot suspend this user");
        await this.repo.suspendMember(orgId, targetUserId, meta.actorUserId);
        await this.audit(meta, { orgId, action: "member.suspended", entityType: "member", entityId: targetUserId });
    }
    async reactivateMember(meta, orgId, targetUserId) {
        await this.requireMutableOrg(orgId);
        await this.requireMember(orgId, meta.actorUserId, "admin");
        await this.repo.reactivateMember(orgId, targetUserId);
        await this.audit(meta, { orgId, action: "member.reactivated", entityType: "member", entityId: targetUserId });
    }
    // ── Invitations ───────────────────────────────
    async inviteMember(meta, orgId, email, role) {
        await this.requireMutableOrg(orgId);
        await this.requireMember(orgId, meta.actorUserId, "admin");
        const token = generateToken();
        const tokenHash = hashToken(token);
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        const inv = await this.repo.createInvitation(orgId, meta.actorUserId, email, role, tokenHash, expiresAt);
        await this.audit(meta, { orgId, action: "member.invited", entityType: "invitation", entityId: inv.id, newValues: { email, role } });
        return { ...toInviteDto(inv), token };
    }
    async resendInvitation(meta, orgId, invitationId) {
        await this.requireMember(orgId, meta.actorUserId, "admin");
        const inv = await this.repo.findInvitationById(invitationId);
        if (!inv || inv.org_id !== orgId)
            throw new NotFoundError("Invitation");
        if (inv.status !== "pending")
            throw new ValidationError("Invitation is not pending");
        await this.repo.incrementResentCount(invitationId);
        await this.audit(meta, { orgId, action: "invitation.resent", entityType: "invitation", entityId: invitationId });
    }
    async revokeInvitation(meta, orgId, invitationId) {
        await this.requireMember(orgId, meta.actorUserId, "admin");
        const inv = await this.repo.findInvitationById(invitationId);
        if (!inv || inv.org_id !== orgId)
            throw new NotFoundError("Invitation");
        await this.repo.revokeInvitation(invitationId, meta.actorUserId);
        await this.audit(meta, { orgId, action: "invitation.revoked", entityType: "invitation", entityId: invitationId });
    }
    async acceptInvitation(meta, token) {
        const tokenHash = hashToken(token);
        const inv = await this.repo.findInvitationByTokenHash(tokenHash);
        if (!inv)
            throw new NotFoundError("Invitation");
        await this.repo.acceptInvitation(tokenHash, meta.actorUserId);
        await this.repo.addMember(inv.org_id, meta.actorUserId, inv.role, inv.invited_by, "invite");
        await this.audit(meta, { orgId: inv.org_id, action: "invitation.accepted", entityType: "invitation", entityId: inv.id });
    }
    async declineInvitation(meta, invitationId) {
        const inv = await this.repo.findInvitationById(invitationId);
        if (!inv)
            throw new NotFoundError("Invitation");
        await this.repo.declineInvitation(invitationId);
        await this.audit(meta, { orgId: inv.org_id, action: "invitation.declined", entityType: "invitation", entityId: invitationId });
    }
    async listInvitations(orgId, userId, q, status) {
        await this.requireMember(orgId, userId, "admin");
        const result = await this.repo.listInvitations(orgId, q, status);
        return { data: result.data.map(toInviteDto), meta: result.meta };
    }
    // ── Environments ──────────────────────────────
    async createEnvironment(meta, orgId, data) {
        await this.requireMutableOrg(orgId);
        await this.requireMember(orgId, meta.actorUserId, "admin");
        const env = await this.repo.createEnvironment(orgId, data.name, data.description ?? null, data.isProduction ?? false, meta.actorUserId);
        await this.audit(meta, { orgId, action: "environment.created", entityType: "environment", entityId: env.id, entityName: env.name });
        return { id: env.id, name: env.name, slug: env.slug, description: env.description, isProduction: env.is_production, createdAt: env.created_at };
    }
    async updateEnvironment(meta, orgId, envId, data) {
        await this.requireMutableOrg(orgId);
        await this.requireMember(orgId, meta.actorUserId, "admin");
        const env = await this.repo.updateEnvironment(orgId, envId, data);
        await this.audit(meta, { orgId, action: "environment.updated", entityType: "environment", entityId: envId });
        return { id: env.id, name: env.name, slug: env.slug, description: env.description, isProduction: env.is_production, createdAt: env.created_at };
    }
    async listEnvironments(orgId, userId) {
        await this.requireMember(orgId, userId);
        const rows = await this.repo.listEnvironments(orgId);
        return rows.map(e => ({ id: e.id, name: e.name, slug: e.slug, description: e.description, isProduction: e.is_production, createdAt: e.created_at }));
    }
    // ── API Keys ──────────────────────────────────
    async createApiKey(meta, orgId, data) {
        await this.requireMutableOrg(orgId);
        await this.requireMember(orgId, meta.actorUserId, "admin");
        const rawKey = generateToken();
        const prefix = rawKey.substring(0, 8);
        const hashed = hashToken(rawKey);
        const expiresAt = data.expiresInDays ? new Date(Date.now() + data.expiresInDays * 86400000) : null;
        const key = await this.repo.createApiKey(orgId, data.name, prefix, hashed, data.role ?? "member", data.environmentId ?? null, expiresAt, meta.actorUserId);
        await this.audit(meta, { orgId, action: "api_key.created", entityType: "api_key", entityId: key.id, entityName: data.name, isSensitive: true });
        return { ...{ id: key.id, name: key.name, keyPrefix: key.key_prefix, role: key.role, environmentId: key.environment_id, lastUsedAt: key.last_used_at, expiresAt: key.expires_at, revokedAt: key.revoked_at, createdAt: key.created_at }, rawKey };
    }
    async revokeApiKey(meta, orgId, keyId) {
        await this.requireMember(orgId, meta.actorUserId, "admin");
        await this.repo.revokeApiKey(orgId, keyId);
        await this.audit(meta, { orgId, action: "api_key.revoked", entityType: "api_key", entityId: keyId, isSensitive: true });
    }
    async listApiKeys(orgId, userId, q) {
        await this.requireMember(orgId, userId, "admin");
        const result = await this.repo.listApiKeys(orgId, q);
        return { data: result.data.map(k => ({ id: k.id, name: k.name, keyPrefix: k.key_prefix, role: k.role, environmentId: k.environment_id, lastUsedAt: k.last_used_at, expiresAt: k.expires_at, revokedAt: k.revoked_at, createdAt: k.created_at })), meta: result.meta };
    }
    // ── SSO ────────────────────────────────────────
    async createSsoProvider(meta, orgId, data) {
        await this.requireMutableOrg(orgId);
        await this.requireMember(orgId, meta.actorUserId, "owner");
        const sso = await this.repo.createSsoProvider(orgId, data);
        await this.audit(meta, { orgId, action: "sso.created", entityType: "sso_provider", entityId: sso.id, isSensitive: true });
        return { id: sso.id, providerName: sso.provider_name, providerType: sso.provider_type, entityId: sso.entity_id, ssoUrl: sso.sso_url, domain: sso.domain, isActive: sso.is_active, createdAt: sso.created_at };
    }
    async updateSsoProvider(meta, orgId, ssoId, data) {
        await this.requireMember(orgId, meta.actorUserId, "owner");
        const sso = await this.repo.updateSsoProvider(orgId, ssoId, data);
        await this.audit(meta, { orgId, action: "sso.updated", entityType: "sso_provider", entityId: ssoId });
        return { id: sso.id, providerName: sso.provider_name, providerType: sso.provider_type, entityId: sso.entity_id, ssoUrl: sso.sso_url, domain: sso.domain, isActive: sso.is_active, createdAt: sso.created_at };
    }
    async deleteSsoProvider(meta, orgId, ssoId) {
        await this.requireMember(orgId, meta.actorUserId, "owner");
        await this.repo.deleteSsoProvider(orgId, ssoId);
        await this.audit(meta, { orgId, action: "sso.deleted", entityType: "sso_provider", entityId: ssoId, isSensitive: true });
    }
    // ── SCIM ──────────────────────────────────────
    async createScimToken(meta, orgId) {
        await this.requireMutableOrg(orgId);
        await this.requireMember(orgId, meta.actorUserId, "owner");
        const rawToken = generateToken();
        const hashed = hashToken(rawToken);
        const expiresAt = new Date(Date.now() + 365 * 86400000);
        const t = await this.repo.createScimToken(orgId, hashed, expiresAt, meta.actorUserId);
        await this.audit(meta, { orgId, action: "scim_token.created", entityType: "scim_token", entityId: t.id, isSensitive: true });
        return { ...{ id: t.id, lastUsedAt: t.last_used_at, expiresAt: t.expires_at, revokedAt: t.revoked_at, createdAt: t.created_at }, rawToken };
    }
    async revokeScimToken(meta, orgId, tokenId) {
        await this.requireMember(orgId, meta.actorUserId, "owner");
        await this.repo.revokeScimToken(orgId, tokenId);
        await this.audit(meta, { orgId, action: "scim_token.revoked", entityType: "scim_token", entityId: tokenId, isSensitive: true });
    }
    // ── Security & Audit ──────────────────────────
    async listSecurityEvents(orgId, userId, q, filters) {
        await this.requireMember(orgId, userId, "security");
        const result = await this.repo.listSecurityEvents(orgId, q, filters);
        return { data: result.data.map(e => ({ id: e.id, userId: e.user_id, eventType: e.event_type, severity: e.severity, ipAddress: e.ip_address, metadata: e.metadata, createdAt: e.created_at })), meta: result.meta };
    }
    async listAuditLogs(orgId, userId, q, filters) {
        await this.requireMember(orgId, userId, "admin");
        const result = await this.repo.listAuditLogs(orgId, q, filters);
        return { data: result.data.map(a => ({ id: a.id, actorUserId: a.actor_user_id, actorEmail: a.actor_email, action: a.action, entityType: a.entity_type, entityId: a.entity_id, entityName: a.entity_name, status: a.status, createdAt: a.created_at })), meta: result.meta };
    }
    // ── Quotas ────────────────────────────────────
    async createQuotaRequest(meta, orgId, data) {
        await this.requireMutableOrg(orgId);
        await this.requireMember(orgId, meta.actorUserId, "admin");
        const qr = await this.repo.createQuotaRequest(orgId, data.quotaType, data.currentLimit, data.requestedLimit, data.reason);
        await this.audit(meta, { orgId, action: "quota.requested", entityType: "quota_request", entityId: qr.id });
        return { id: qr.id, quotaType: qr.quota_type, currentLimit: qr.current_limit, requestedLimit: qr.requested_limit, reason: qr.reason, status: qr.status, reviewedAt: qr.reviewed_at, notes: qr.notes, createdAt: qr.created_at };
    }
    async approveQuotaRequest(meta, orgId, requestId, notes) {
        await this.requireMember(orgId, meta.actorUserId, "owner");
        const qr = await this.repo.reviewQuotaRequest(orgId, requestId, "approved", meta.actorUserId, notes);
        await this.audit(meta, { orgId, action: "quota.approved", entityType: "quota_request", entityId: requestId });
        return { id: qr.id, quotaType: qr.quota_type, currentLimit: qr.current_limit, requestedLimit: qr.requested_limit, reason: qr.reason, status: qr.status, reviewedAt: qr.reviewed_at, notes: qr.notes, createdAt: qr.created_at };
    }
    async rejectQuotaRequest(meta, orgId, requestId, notes) {
        await this.requireMember(orgId, meta.actorUserId, "owner");
        const qr = await this.repo.reviewQuotaRequest(orgId, requestId, "rejected", meta.actorUserId, notes);
        await this.audit(meta, { orgId, action: "quota.rejected", entityType: "quota_request", entityId: requestId });
        return { id: qr.id, quotaType: qr.quota_type, currentLimit: qr.current_limit, requestedLimit: qr.requested_limit, reason: qr.reason, status: qr.status, reviewedAt: qr.reviewed_at, notes: qr.notes, createdAt: qr.created_at };
    }
    async listQuotaRequests(orgId, userId, q) {
        await this.requireMember(orgId, userId, "admin");
        const result = await this.repo.listQuotaRequests(orgId, q);
        return { data: result.data.map(qr => ({ id: qr.id, quotaType: qr.quota_type, currentLimit: qr.current_limit, requestedLimit: qr.requested_limit, reason: qr.reason, status: qr.status, reviewedAt: qr.reviewed_at, notes: qr.notes, createdAt: qr.created_at })), meta: result.meta };
    }
    // ── User Organizations ────────────────────────
    async listUserOrganizations(userId, q) {
        const result = await this.repo.listUserOrganizations(userId, q);
        return {
            data: result.data.map(r => ({ id: r.id, name: r.name, slug: r.slug, logoUrl: r.logo_url, role: r.role, status: r.status, createdAt: r.created_at })),
            meta: result.meta
        };
    }
    // ── Validate Invitation Token ─────────────────
    async validateInvitationToken(token) {
        const tokenHash = hashToken(token);
        const inv = await this.repo.findInvitationByTokenHash(tokenHash);
        if (!inv)
            throw new NotFoundError("Invitation");
        const org = await this.repo.findOrgById(inv.org_id);
        return {
            valid: true,
            email: inv.email,
            role: inv.role,
            orgName: org?.name ?? null,
            orgSlug: org?.slug ?? null,
            expiresAt: inv.expires_at,
        };
    }
    // ── Slug Availability ─────────────────────────
    async checkSlugAvailability(slug) {
        const available = await this.repo.isSlugAvailable(slug);
        return { slug, available };
    }
    // ── Rotate API Key ────────────────────────────
    async rotateApiKey(meta, orgId, keyId) {
        await this.requireMutableOrg(orgId);
        await this.requireMember(orgId, meta.actorUserId, "admin");
        const rawKey = generateToken();
        const prefix = rawKey.substring(0, 8);
        const hashed = hashToken(rawKey);
        const key = await this.repo.rotateApiKey(orgId, keyId, `rotated-key`, prefix, hashed, "member", null, null, meta.actorUserId);
        await this.audit(meta, { orgId, action: "api_key.rotated", entityType: "api_key", entityId: key.id, newValues: { oldKeyId: keyId }, isSensitive: true });
        return { ...{ id: key.id, name: key.name, keyPrefix: key.key_prefix, role: key.role, environmentId: key.environment_id, lastUsedAt: key.last_used_at, expiresAt: key.expires_at, revokedAt: key.revoked_at, createdAt: key.created_at }, rawKey };
    }
    // ── Export Audit Logs ─────────────────────────
    async exportAuditLogs(orgId, userId, filters) {
        await this.requireMember(orgId, userId, "admin");
        const rows = await this.repo.exportAuditLogs(orgId, filters);
        return rows.map(a => ({ id: a.id, actorUserId: a.actor_user_id, actorEmail: a.actor_email, action: a.action, entityType: a.entity_type, entityId: a.entity_id, entityName: a.entity_name, oldValues: a.old_values, newValues: a.new_values, changedFields: a.changed_fields, status: a.status, createdAt: a.created_at }));
    }
    // ── Leave Organization ────────────────────────
    async leaveOrganization(meta, orgId) {
        await this.requireMutableOrg(orgId);
        const member = await this.repo.findActiveMember(orgId, meta.actorUserId);
        if (!member)
            throw new NotFoundError("Member");
        if (member.role === "owner") {
            const ownerCount = await this.repo.countOwners(orgId);
            if (ownerCount <= 1)
                throw new ForbiddenError("Cannot leave as the last owner. Transfer ownership first.");
        }
        await this.repo.removeMember(orgId, meta.actorUserId, meta.actorUserId, "self-leave");
        await this.audit(meta, { orgId, action: "member.left", entityType: "member", entityId: meta.actorUserId });
    }
    // ── List SSO Providers ────────────────────────
    async listSsoProviders(orgId, userId) {
        await this.requireMember(orgId, userId, "admin");
        const rows = await this.repo.listSsoProviders(orgId);
        return rows.map(sso => ({ id: sso.id, providerName: sso.provider_name, providerType: sso.provider_type, entityId: sso.entity_id, ssoUrl: sso.sso_url, domain: sso.domain, isActive: sso.is_active, createdAt: sso.created_at }));
    }
    // ── List SCIM Tokens ──────────────────────────
    async listScimTokens(orgId, userId) {
        await this.requireMember(orgId, userId, "owner");
        const rows = await this.repo.listScimTokens(orgId);
        return rows.map(t => ({ id: t.id, lastUsedAt: t.last_used_at, expiresAt: t.expires_at, revokedAt: t.revoked_at, createdAt: t.created_at }));
    }
}
//# sourceMappingURL=organizationservice.js.map