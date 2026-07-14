import { OrganizationRepository } from "./repository.js";
import { generateToken, hashToken } from "./shared/utils/index.js";
import { ScimTokenService } from "../scim/scim-token.service.js";
import { SsoRepository } from "./sso/sso.repository.js";
import { SsoService } from "./sso/sso.service.js";
import { AuditLogsRepository } from "./audit-logs/audit-logs.repository.js";
import { AuditLogsService } from "./audit-logs/audit-logs.service.js";
import { QuotasRepository } from "./quotas/quotas.repository.js";
import { QuotasService } from "./quotas/quotas.service.js";
import { MembersService } from "./members/members.service.js";
import { MembersRepository } from "./members/members.repository.js";
import { InvitationsService } from "./invitations/invitations.service.js";
import { InvitationsRepository } from "./invitations/invitations.repository.js";
import { SecurityEventsService } from "./security-events/security-events.service.js";
import { SecurityEventsRepository } from "./security-events/security-events.repository.js";
import { invalidateMembershipCache } from "../../shared/middleware/tenant.js";
import { apiKeyCache, evictAlertThresholdCache } from "../../config/lrucashe.js";
import { env } from "../../config/env.js";
import { emailService } from "../../shared/email/email.service.js";
import { orgInvitationTemplate } from "../../shared/email/templates.js";
import { enqueueOrgEmail } from "./shared/background/email-outbox.js";
import { hasMinRole, canManageRole, isMutableOrg, OrganizationError, ForbiddenError, NotFoundError, OrgStatusError, ConflictError, ValidationError, } from "./types.js";
import { CoreService } from "./core/core.service.js";
import { CoreRepository } from "./core/core.repository.js";
import { BillingProvisioningService } from "../billing/provisioning/service.js";
import { DomainsRepository } from './domains/domains.repository.js';
import { DomainsService } from './domains/domains.service.js';
function toMemberDto(r) {
    return { id: r.id, userId: r.user_id, email: r.email, fullName: r.full_name, role: r.role, status: r.status, joinedAt: r.joined_at, lastActiveAt: r.last_active_at, createdAt: r.created_at };
}
function toInviteDto(r) {
    return { id: r.id, email: r.email, role: r.role, status: r.status, expiresAt: r.expires_at, invitedAt: r.created_at, invitedBy: { id: r.invited_by, email: r.invited_by_email ?? null, name: r.invited_by_name ?? null } };
}
// ── Invitation helpers ──────────────────────────
const INVITE_EXPIRY_DAYS = 7;
const BILLING_MUTABLE_STATUSES = new Set(["trialing", "active"]);
const ROLE_LABELS = {
    owner: "Owner",
    admin: "Admin",
    developer: "Developer",
    billing: "Billing",
    security: "Security",
    member: "Member",
    viewer: "Viewer",
};
function roleLabel(role) {
    return ROLE_LABELS[role] ?? role;
}
/**
 * Build the frontend invite-accept URL. `accountExists` lets the frontend
 * decide which screen to show: sign-in (existing user) vs. create-account
 * (brand-new invitee). The base is FRONTEND_URL, falling back to APP_URL.
 */
function buildInviteUrl(token, accountExists) {
    const base = (env.FRONTEND_URL || env.APP_URL || "").replace(/\/+$/, "");
    const params = new URLSearchParams({
        token,
        accountExists: accountExists ? "true" : "false",
    });
    return `${base}/invite?${params.toString()}`;
}
export class OrganizationService {
    repo;
    log;
    emitEvent;
    sso;
    auditLogs;
    core;
    invitations;
    quotas;
    members;
    scimTokenService;
    securityEvents;
    domains;
    constructor(deps) {
        this.repo = deps.repository;
        this.log = deps.logger.child({ component: "OrganizationService" });
        this.scimTokenService = deps.scimTokenService;
        this.emitEvent = deps.emitEvent;
        this.securityEvents = new SecurityEventsService({
            repository: new SecurityEventsRepository(),
            requireMember: this.requireMember.bind(this),
        });
        this.core = new CoreService({
            repository: new CoreRepository(),
            log: this.log,
            requireMember: this.requireMember.bind(this),
            audit: this.audit.bind(this),
            billingProvisioning: new BillingProvisioningService(),
            deleteApiKeyCache: (hash) => { try {
                apiKeyCache.delete(hash);
            }
            catch { } }
        });
        this.members = new MembersService({
            repository: new MembersRepository(),
            requireMutableOrg: this.requireMutableOrg.bind(this),
            audit: this.audit.bind(this),
            enforceBillingLimit: (orgId, capability) => this.quotas.enforceBillingLimit(orgId, capability),
        });
        this.quotas = new QuotasService({
            repository: new QuotasRepository(),
            requireMutableOrg: this.requireMutableOrg.bind(this),
            requireMember: this.requireMember.bind(this),
            audit: this.audit.bind(this),
        });
        this.auditLogs = new AuditLogsService({
            repository: new AuditLogsRepository(),
            requireMember: this.requireMember.bind(this),
            log: this.log,
        });
        this.sso = new SsoService({
            repository: new SsoRepository(),
            requireMutableOrg: this.requireMutableOrg.bind(this),
            requireMember: this.requireMember.bind(this),
            enforceBillingLimit: this.quotas.enforceBillingLimit.bind(this.quotas),
            audit: this.audit.bind(this),
        });
        this.invitations = new InvitationsService({
            repository: new InvitationsRepository(),
            log: this.log,
            requireMutableOrg: this.requireMutableOrg.bind(this),
            requireMember: this.requireMember.bind(this),
            audit: this.audit.bind(this),
            enforceBillingLimit: this.quotas.enforceBillingLimit.bind(this.quotas),
        });
        this.domains = new DomainsService(new DomainsRepository(), this.requireMember.bind(this), this.audit.bind(this), this.log);
    }
    // ── Helpers ───────────────────────────────────
    async audit(meta, data) {
        await this.auditLogs.audit(meta, data);
    }
    async requireMember(orgId, userId, minRole = "viewer") {
        return this.members.requireMember(orgId, userId, minRole);
    }
    async requireMutableOrg(orgId) {
        return this.core.requireMutableOrg(orgId);
    }
    // ── Organization CRUD ─────────────────────────
    async createOrganization(meta, data) {
        return this.core.createOrganization(meta, data);
    }
    async switchOrganization(meta, orgId) {
        return this.core.switchOrganization(meta, orgId);
    }
    async getOrganization(orgId, userId) {
        return this.core.getOrganization(orgId, userId);
    }
    async getOrganizationBySlug(slug, userId) {
        return this.core.getOrganizationBySlug(slug, userId);
    }
    async updateOrganization(meta, orgId, data) {
        return this.core.updateOrganization(meta, orgId, data);
    }
    async deleteOrganization(meta, orgId) {
        return this.core.deleteOrganization(meta, orgId);
    }
    async archiveOrganization(meta, orgId) {
        return this.core.archiveOrganization(meta, orgId);
    }
    async restoreOrganization(meta, orgId) {
        return this.core.restoreOrganization(meta, orgId);
    }
    async transferOwnership(meta, orgId, newOwnerUserId) {
        return this.core.transferOwnership(meta, orgId, newOwnerUserId);
    }
    // ── Settings ──────────────────────────────────
    async getSettings(orgId, userId) {
        return this.core.getSettings(orgId, userId);
    }
    async updateSettings(meta, orgId, data) {
        return this.core.updateSettings(meta, orgId, data);
    }
    // ── Members ───────────────────────────────────
    async listMembers(orgId, userId, q, filters) {
        return this.members.listMembers(orgId, userId, q, filters);
    }
    async getMember(orgId, actorUserId, targetUserId) {
        return this.members.getMember(orgId, actorUserId, targetUserId);
    }
    async updateMemberRole(meta, orgId, targetUserId, newRole) {
        return this.members.updateMemberRole(meta, orgId, targetUserId, newRole);
    }
    async removeMember(meta, orgId, targetUserId) {
        return this.members.removeMember(meta, orgId, targetUserId);
    }
    async suspendMember(meta, orgId, targetUserId) {
        return this.members.suspendMember(meta, orgId, targetUserId);
    }
    async reactivateMember(meta, orgId, targetUserId) {
        return this.members.reactivateMember(meta, orgId, targetUserId);
    }
    // ── Invitations ───────────────────────────────
    async inviteMember(meta, orgId, email, role) {
        return this.invitations.inviteMember(meta, orgId, email, role);
    }
    async resendInvitation(meta, orgId, invitationId) {
        return this.invitations.resendInvitation(meta, orgId, invitationId);
    }
    async revokeInvitation(meta, orgId, invitationId) {
        return this.invitations.revokeInvitation(meta, orgId, invitationId);
    }
    async acceptInvitation(meta, token) {
        return this.invitations.acceptInvitation(meta, token);
    }
    async declineInvitation(meta, invitationId) {
        return this.invitations.declineInvitation(meta, invitationId);
    }
    async listInvitations(orgId, userId, q, status) {
        return this.invitations.listInvitations(orgId, userId, q, status);
    }
    // ── SSO ────────────────────────────────────────
    async createSsoProvider(meta, orgId, data) {
        return this.sso.createSsoProvider(meta, orgId, data);
    }
    async updateSsoProvider(meta, orgId, ssoId, data) {
        return this.sso.updateSsoProvider(meta, orgId, ssoId, data);
    }
    async deleteSsoProvider(meta, orgId, ssoId) {
        return this.sso.deleteSsoProvider(meta, orgId, ssoId);
    }
    // ── SCIM ──────────────────────────────────────
    async createScimToken(meta, orgId, data) {
        await this.requireMutableOrg(orgId);
        await this.requireMember(orgId, meta.actorUserId, "owner");
        // await this.enforceBillingLimit(orgId, "scim");
        const payload = {
            orgId,
            createdBy: meta.actorUserId,
            scopes: data?.scopes?.length ? data.scopes : ["users:read", "users:write", "users:delete", "groups:read", "groups:write", "groups:delete"],
            ...(data?.allowedIps !== undefined ? { allowedIps: data.allowedIps } : {}),
            ...(data?.expiresInDays !== undefined ? { expiresInDays: data.expiresInDays } : {}),
        };
        const created = await this.scimTokenService.createToken(payload);
        const tokens = await this.scimTokenService.listTokens(orgId);
        const token = tokens.find((item) => item.id === created.tokenId);
        if (!token)
            throw new NotFoundError("SCIM token");
        return { ...this.toScimTokenDto(token), rawToken: created.rawToken };
    }
    async revokeScimToken(meta, orgId, tokenId) {
        await this.requireMember(orgId, meta.actorUserId, "owner");
        const tokens = await this.scimTokenService.listTokens(orgId);
        if (!tokens.some((item) => item.id === tokenId))
            throw new NotFoundError("SCIM token");
        await this.scimTokenService.revokeToken(tokenId, orgId, meta.actorUserId);
    }
    async rotateScimToken(meta, orgId, tokenId) {
        await this.requireMutableOrg(orgId);
        await this.requireMember(orgId, meta.actorUserId, "owner");
        const tokens = await this.scimTokenService.listTokens(orgId);
        if (!tokens.some((item) => item.id === tokenId))
            throw new NotFoundError("SCIM token");
        const rotated = await this.scimTokenService.rotateToken(tokenId, orgId, meta.actorUserId);
        const updatedTokens = await this.scimTokenService.listTokens(orgId);
        const token = updatedTokens.find((item) => item.id === rotated.newTokenId);
        if (!token)
            throw new NotFoundError("SCIM token");
        return { ...this.toScimTokenDto(token), rawToken: rotated.rawToken };
    }
    // ── Security Events ───────────────────────────
    async listSecurityEvents(orgId, userId, q, filters) {
        return this.securityEvents.listSecurityEvents(orgId, userId, q, filters);
    }
    async listAuditLogs(orgId, userId, q, filters) {
        return this.auditLogs.listAuditLogs(orgId, userId, q, filters);
    }
    async createQuotaRequest(meta, orgId, data) {
        return this.quotas.createQuotaRequest(meta, orgId, data);
    }
    async approveQuotaRequest(meta, orgId, requestId, notes) {
        return this.quotas.approveQuotaRequest(meta, orgId, requestId, notes);
    }
    async rejectQuotaRequest(meta, orgId, requestId, notes) {
        return this.quotas.rejectQuotaRequest(meta, orgId, requestId, notes);
    }
    async listQuotaRequests(orgId, userId, q) {
        return this.quotas.listQuotaRequests(orgId, userId, q);
    }
    async getBillingSummary(orgId, userId) {
        const { entitlements, counts } = await this.quotas.requireBillingEntitlements(orgId);
        const normalizeLimit = (l) => (l >= 1e9 ? -1 : l);
        await this.requireMember(orgId, userId, "billing");
        return {
            orgId,
            subscriptionStatus: entitlements.subscription_status,
            planTier: entitlements.plan_tier,
            eventLimitMonthly: Number(entitlements.event_limit_monthly ?? 0),
            hardCap: entitlements.hard_cap,
            usage: {
                activeMembers: {
                    used: counts.activeMembers + counts.pendingInvitations,
                    limit: normalizeLimit(this.quotas.limitFrom(entitlements, ["max_team_members", "max_members"])),
                },
                ssoProviders: {
                    used: counts.ssoProviders,
                    limit: normalizeLimit(this.quotas.limitFrom(entitlements, ["max_sso_providers", "sso_providers_max"], 1)),
                    enabled: this.quotas.featureAllowed(entitlements, ["sso_saml", "sso_enabled", "saml_sso"], false),
                },
                scimTokens: {
                    used: counts.scimTokens,
                    limit: normalizeLimit(this.quotas.limitFrom(entitlements, ["max_scim_tokens", "scim_tokens_max"], 1)),
                    enabled: this.quotas.featureAllowed(entitlements, ["scim", "scim_enabled"], false),
                },
            },
        };
    }
    async getUsageLimits(orgId, userId) {
        const { entitlements, counts } = await this.quotas.requireBillingEntitlements(orgId);
        await this.requireMember(orgId, userId);
        const normalizeLimit = (limit) => Number.isFinite(limit) ? limit : null;
        return {
            subscriptionStatus: entitlements.subscription_status,
            planKey: entitlements.plan_key,
            limits: {
                members: {
                    used: counts.activeMembers,
                    pending: counts.pendingInvitations,
                    limit: normalizeLimit(this.quotas.limitFrom(entitlements, ["max_team_members", "max_members"])),
                },
                ssoProviders: {
                    used: counts.ssoProviders,
                    limit: normalizeLimit(this.quotas.limitFrom(entitlements, ["max_sso_providers", "sso_providers_max"], 1)),
                    enabled: this.quotas.featureAllowed(entitlements, ["sso_saml", "sso_enabled", "saml_sso"], false),
                },
                scimTokens: {
                    used: counts.scimTokens,
                    limit: normalizeLimit(this.quotas.limitFrom(entitlements, ["max_scim_tokens", "scim_tokens_max"], 1)),
                    enabled: this.quotas.featureAllowed(entitlements, ["scim", "scim_enabled"], false),
                },
                eventsMonthly: {
                    used: null,
                    limit: Number(entitlements.event_limit_monthly ?? 0),
                    hardCap: entitlements.hard_cap,
                },
            },
        };
    }
    // ── User Organizations ────────────────────────
    async listUserOrganizations(userId, q) {
        return this.core.listUserOrganizations(userId, q);
    }
    // ── Validate Invitation Token ─────────────────
    async validateInvitationToken(token) {
        return this.invitations.validateInvitationToken(token);
    }
    // ── Slug Availability ─────────────────────────
    async checkSlugAvailability(slug) {
        return this.core.checkSlugAvailability(slug);
    }
    // ── Export Audit Logs ─────────────────────────
    async exportAuditLogs(orgId, userId, filters) {
        return this.auditLogs.exportAuditLogs(orgId, userId, filters);
    }
    // ── Leave Organization ────────────────────────
    async leaveOrganization(meta, orgId) {
        return this.members.leaveOrganization(meta, orgId);
    }
    // ── List SSO Providers ──────────────────────────
    async listSsoProviders(orgId, userId) {
        return this.sso.listSsoProviders(orgId, userId);
    }
    // ── List SCIM Tokens ──────────────────────────
    async listScimTokens(orgId, userId) {
        await this.requireMember(orgId, userId, "owner");
        const rows = await this.scimTokenService.listTokens(orgId);
        return rows.map((token) => this.toScimTokenDto(token));
    }
    toScimTokenDto(token) {
        return {
            id: token.id,
            lastUsedAt: token.last_used_at,
            expiresAt: token.expires_at,
            revokedAt: token.revoked_at,
            createdAt: token.created_at,
            scopes: token.scopes ?? [],
            allowedIps: token.allowed_ips ?? [],
        };
    }
}
//# sourceMappingURL=organizationservice.js.map