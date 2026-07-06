import type { FastifyBaseLogger } from "fastify";
import { OrganizationRepository } from "./repository.js";
import type { BillingEntitlementsRow, OrganizationUsageCounts } from "./repository.js";
import { generateToken, hashToken } from "./utils.js";
import { ScimTokenService } from "../scim/scim-token.service.js";
import { invalidateMembershipCache } from "../../shared/middleware/tenant.js";
import { apiKeyCache, evictAlertThresholdCache } from "../../config/lrucashe.js";
import { env } from "../../config/env.js";
import { emailService } from "../../shared/email/email.service.js";
import { orgInvitationTemplate } from "../../shared/email/templates.js";
import { enqueueOrgEmail } from "./email-outbox.js";
import {
  hasMinRole, canManageRole, isMutableOrg,
  OrganizationError, ForbiddenError, NotFoundError, OrgStatusError, ConflictError, ValidationError,
  type OrgRole, type RequestMeta, type CreateAuditLogRecord,
  type OrganizationDto, type OrgSettingsDto, type MemberDto, type InvitationDto,
  type EnvironmentDto, type ApiKeyDto, type SsoProviderDto, type ScimTokenDto,
  type SecurityEventDto, type AuditLogDto, type QuotaRequestDto, type UserOrganizationDto,
  type OrganizationRow, type OrgSettingsRow, type OrgMemberRow, type OrgInvitationRow,
  type OrganizationServiceDependencies,
  type CursorPaginationQuery, type CursorPaginatedResponse,
  type AlertThresholdRow, type AlertThresholdDto,
} from "./types.js";

// ── DTO Mappers ─────────────────────────────────
function toOrgDto(r: OrganizationRow): OrganizationDto {
  return { id: r.id, name: r.name, slug: r.slug, description: r.description, logoUrl: r.logo_url, websiteUrl: r.website_url, industry: r.industry, companySize: r.company_size, country: r.country, timezone: r.timezone, billingEmail: r.billing_email, supportEmail: r.support_email, ownerUserId: r.owner_user_id, status: r.status, createdAt: r.created_at, updatedAt: r.updated_at };
}
function toSettingsDto(r: OrgSettingsRow): OrgSettingsDto {
  return { enforceSso: r.enforce_sso, enforceMfa: r.enforce_mfa, sessionTimeoutMinutes: r.session_timeout_minutes, dataRegion: r.data_region, dataRetentionDays: r.data_retention_days, auditLogRetentionDays: r.audit_log_retention_days, allowPublicProjects: r.allow_public_projects };
}
function toMemberDto(r: OrgMemberRow): MemberDto {
  return { id: r.id, userId: r.user_id, email: r.email, fullName: r.full_name, role: r.role, status: r.status, joinedAt: r.joined_at, lastActiveAt: r.last_active_at, createdAt: r.created_at };
}
function toInviteDto(r: OrgInvitationRow): InvitationDto {
  return { id: r.id, email: r.email, role: r.role, status: r.status, expiresAt: r.expires_at, invitedAt: r.created_at, invitedBy: { id: r.invited_by, email: r.invited_by_email ?? null, name: r.invited_by_name ?? null } };
}

// ── Invitation helpers ──────────────────────────
const INVITE_EXPIRY_DAYS = 7;
const BILLING_MUTABLE_STATUSES = new Set(["trialing", "active"]);

const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  developer: "Developer",
  billing: "Billing",
  security: "Security",
  member: "Member",
  viewer: "Viewer",
};

function roleLabel(role: string): string {
  return ROLE_LABELS[role] ?? role;
}

/**
 * Build the frontend invite-accept URL. `accountExists` lets the frontend
 * decide which screen to show: sign-in (existing user) vs. create-account
 * (brand-new invitee). The base is FRONTEND_URL, falling back to APP_URL.
 */
function buildInviteUrl(token: string, accountExists: boolean): string {
  const base = (env.FRONTEND_URL || env.APP_URL || "").replace(/\/+$/, "");
  const params = new URLSearchParams({
    token,
    accountExists: accountExists ? "true" : "false",
  });
  return `${base}/invite?${params.toString()}`;
}

export class OrganizationService {
  private repo: OrganizationRepository;
  private log: FastifyBaseLogger;
  private emitEvent: (event: string, payload: Record<string, unknown>) => Promise<void>;
  private scimTokenService: ScimTokenService;

  constructor(deps: OrganizationServiceDependencies) {
    this.repo = deps.repository;
    this.log = deps.logger;
    this.emitEvent = deps.emitEvent;
    this.scimTokenService = deps.scimTokenService;
  }

  // ── Helpers ───────────────────────────────────
  private async audit(meta: RequestMeta, data: Omit<CreateAuditLogRecord, "orgId" | "actorUserId" | "actorEmail" | "actorIp" | "actorUserAgent" | "actorSessionId" | "requestId" | "httpMethod" | "endpoint"> & { orgId: string }) {
    try {
      await this.repo.createAuditLog({ ...data, actorUserId: meta.actorUserId, actorEmail: meta.actorEmail, actorIp: meta.actorIp, actorUserAgent: meta.actorUserAgent, actorSessionId: meta.actorSessionId, requestId: meta.requestId, httpMethod: meta.httpMethod, endpoint: meta.endpoint });
    } catch (e) { this.log.error({ err: e }, "Audit log write failed"); }
  }

  /** Send the organization-invitation email. Throws on SMTP failure so callers
   *  can decide whether the failure is fatal (resend) or best-effort (invite). */
  private async sendInvitationEmail(opts: {
    toEmail: string;
    toName?: string | undefined;
    orgName: string;
    inviterName?: string | undefined;
    role: OrgRole;
    inviteUrl: string;
    accountExists: boolean;
  }): Promise<void> {
    await emailService.send({
      to: opts.toEmail,
      ...orgInvitationTemplate({
        appName: env.APP_NAME,
        userName: opts.toName,
        orgName: opts.orgName,
        inviterName: opts.inviterName,
        roleLabel: roleLabel(opts.role),
        actionUrl: opts.inviteUrl,
        expiresInDays: INVITE_EXPIRY_DAYS,
        accountExists: opts.accountExists,
      }),
    });
  }

  private async requireMember(orgId: string, userId: string, minRole: OrgRole = "viewer") {
    const member = await this.repo.findActiveMember(orgId, userId);
    if (!member) throw new ForbiddenError("Not a member of this organization");
    if (!hasMinRole(member.role, minRole)) throw new ForbiddenError(`Requires ${minRole} role or higher`);
    return member;
  }

  private async requireMutableOrg(orgId: string) {
    const org = await this.repo.findOrgById(orgId);
    if (!org) throw new NotFoundError("Organization");
    if (!isMutableOrg(org.status)) throw new OrgStatusError(org.status);
    return org;
  }

  private limitFrom(entitlements: BillingEntitlementsRow, keys: string[], fallback = Number.POSITIVE_INFINITY): number {
    const config = entitlements.feature_config ?? {};
    for (const key of keys) {
      const raw = config[key];
      if (typeof raw === "number") return raw;
      if (typeof raw === "string" && raw.trim() !== "" && Number.isFinite(Number(raw))) return Number(raw);
    }
    return fallback;
  }

  private featureAllowed(entitlements: BillingEntitlementsRow, keys: string[], fallback = true): boolean {
    const config = entitlements.feature_config ?? {};
    for (const key of keys) {
      const raw = config[key];
      if (typeof raw === "boolean") return raw;
      if (typeof raw === "string") return raw.toLowerCase() === "true";
    }
    return fallback;
  }

  private assertWithinLimit(name: string, used: number, limit: number): void {
    if (limit >= 0 && Number.isFinite(limit) && used >= limit) {
      throw new ForbiddenError(`${name} limit exceeded for current billing plan`);
    }
  }

  private async requireBillingEntitlements(orgId: string): Promise<{ entitlements: BillingEntitlementsRow; counts: OrganizationUsageCounts }> {
    const entitlements = await this.repo.getBillingEntitlements(orgId);
    if (!entitlements) throw new ForbiddenError("Organization has no active billing subscription");
    if (!BILLING_MUTABLE_STATUSES.has(entitlements.subscription_status)) {
      throw new ForbiddenError(`Billing subscription is ${entitlements.subscription_status}. This action is not permitted.`);
    }
    const counts = await this.repo.getOrganizationUsageCounts(orgId);
    return { entitlements, counts };
  }

  private async enforceBillingLimit(
    orgId: string,
    capability: "member" | "environment" | "apiKey" | "sso" | "scim",
  ): Promise<{ entitlements: BillingEntitlementsRow; counts: OrganizationUsageCounts; maxMembers?: number }> {
    const { entitlements, counts } = await this.requireBillingEntitlements(orgId);
    if (capability === "member") {
      const maxMembers = this.limitFrom(entitlements, ["max_team_members", "max_members"]);
      this.assertWithinLimit("Member", counts.activeMembers + counts.pendingInvitations, maxMembers);
      return { entitlements, counts, maxMembers };
    }
    if (capability === "environment") {
      this.assertWithinLimit("Environment", counts.environments, this.limitFrom(entitlements, ["max_environments", "environments_max"]));
    }
    if (capability === "apiKey") {
      this.assertWithinLimit("API key", counts.apiKeys, this.limitFrom(entitlements, ["max_api_keys", "api_keys_max"]));
    }
    if (capability === "sso") {
      if (!this.featureAllowed(entitlements, ["sso_saml", "sso_enabled", "saml_sso"], false)) {
        throw new ForbiddenError("SSO is not enabled for current billing plan");
      }
      this.assertWithinLimit("SSO provider", counts.ssoProviders, this.limitFrom(entitlements, ["max_sso_providers", "sso_providers_max"], 1));
    }
    if (capability === "scim") {
      if (!this.featureAllowed(entitlements, ["scim", "scim_enabled"], false)) {
        throw new ForbiddenError("SCIM is not enabled for current billing plan");
      }
      this.assertWithinLimit("SCIM token", counts.scimTokens, this.limitFrom(entitlements, ["max_scim_tokens", "scim_tokens_max"], 1));
    }
    return { entitlements, counts };
  }

  // ── Organization CRUD ─────────────────────────
  async createOrganization(meta: RequestMeta, data: { name: string; description?: string; industry?: string; companySize?: string; country?: string; timezone?: string; billingEmail?: string }) {
    const provisioned = await this.repo.createOrg(data.name, meta.actorUserId, data);
    const org = provisioned.organization;

    await this.audit(meta, {
      orgId: org.id,
      action: "org.created",
      entityType: "organization",
      entityId: org.id,
      entityName: org.name,
      newValues: {
        name: org.name,
        slug: org.slug,
        billing: {
          planId: provisioned.planId,
          subscriptionId: provisioned.subscriptionId,
          provider: "system",
          status: "active"
        }
      }
    });
    return toOrgDto(org);
  }

  async switchOrganization(meta: RequestMeta, orgId: string) {
    await this.requireMember(orgId, meta.actorUserId);
    const org = await this.repo.findOrgById(orgId);
    if (!org) throw new NotFoundError("Organization");

    await this.repo.setUserCurrentOrg(meta.actorUserId, orgId);
    await this.audit(meta, {
      orgId,
      action: "org.switched",
      entityType: "organization",
      entityId: orgId,
      entityName: org.name,
      newValues: { currentOrgId: orgId },
    });
    return toOrgDto(org);
  }

  async getOrganization(orgId: string, userId: string) {
    await this.requireMember(orgId, userId);
    const org = await this.repo.findOrgById(orgId);
    if (!org) throw new NotFoundError("Organization");
    return toOrgDto(org);
  }

  async getOrganizationBySlug(slug: string, userId: string) {
    const org = await this.repo.findOrgBySlug(slug);
    if (!org) throw new NotFoundError("Organization");
    await this.requireMember(org.id, userId);
    return toOrgDto(org);
  }

  async updateOrganization(meta: RequestMeta, orgId: string, data: Record<string, unknown>) {
    const oldOrg = await this.requireMutableOrg(orgId);
    await this.requireMember(orgId, meta.actorUserId, "admin");
    const updated = await this.repo.updateOrg(orgId, data);
    const changed = Object.keys(data).filter(k => data[k] !== undefined);
    await this.audit(meta, { orgId, action: "org.updated", entityType: "organization", entityId: orgId, entityName: updated.name, oldValues: { name: oldOrg.name }, newValues: { name: updated.name }, changedFields: changed });
    return toOrgDto(updated);
  }

  async deleteOrganization(meta: RequestMeta, orgId: string) {
    await this.requireMutableOrg(orgId);
    await this.requireMember(orgId, meta.actorUserId, "owner");
    // Capture key hashes before the cascade so we can purge the ingestion cache.
    const keyHashes = await this.repo.listOrgApiKeyHashes(orgId);
    await this.repo.softDeleteOrg(orgId);
    // Evict every project API key of this org from the in-process ingestion
    // cache so a deleted org stops ingesting immediately (not after TTL).
    for (const hash of keyHashes) {
      try { apiKeyCache.delete(hash); } catch { /* best-effort */ }
    }
    await this.audit(meta, { orgId, action: "org.deleted", entityType: "organization", entityId: orgId, isSensitive: true });
  }

  async archiveOrganization(meta: RequestMeta, orgId: string) {
    await this.requireMember(orgId, meta.actorUserId, "owner");
    await this.repo.archiveOrg(orgId);
    await this.audit(meta, { orgId, action: "org.archived", entityType: "organization", entityId: orgId });
  }

  async restoreOrganization(meta: RequestMeta, orgId: string) {
    await this.requireMember(orgId, meta.actorUserId, "owner");
    const org = await this.repo.restoreOrg(orgId);
    await this.audit(meta, { orgId, action: "org.restored", entityType: "organization", entityId: orgId });
    return toOrgDto(org);
  }

  async transferOwnership(meta: RequestMeta, orgId: string, newOwnerUserId: string) {
    await this.requireMutableOrg(orgId);
    await this.requireMember(orgId, meta.actorUserId, "owner");
    const target = await this.repo.findActiveMember(orgId, newOwnerUserId);
    if (!target) throw new NotFoundError("Target member");
    await this.repo.transferOwnership(orgId, meta.actorUserId, newOwnerUserId);
    await this.audit(meta, { orgId, action: "org.ownership_transferred", entityType: "organization", entityId: orgId, newValues: { newOwner: newOwnerUserId }, isSensitive: true });
  }

  // ── Settings ──────────────────────────────────
  async getSettings(orgId: string, userId: string) {
    await this.requireMember(orgId, userId, "admin");
    const s = await this.repo.getSettings(orgId);
    if (!s) throw new NotFoundError("Settings");
    return toSettingsDto(s);
  }

  async updateSettings(meta: RequestMeta, orgId: string, data: Record<string, unknown>) {
    await this.requireMutableOrg(orgId);
    await this.requireMember(orgId, meta.actorUserId, "admin");
    const old = await this.repo.getSettings(orgId);
    const s = await this.repo.updateSettings(orgId, data);
    await this.audit(meta, { orgId, action: "org.settings_updated", entityType: "settings", entityId: orgId, oldValues: old as any, newValues: s as any, changedFields: Object.keys(data), isSensitive: true });
    return toSettingsDto(s);
  }

  // ── Members ───────────────────────────────────
  async listMembers(orgId: string, userId: string, q: CursorPaginationQuery, filters?: { status?: string; role?: string }) {
    await this.requireMember(orgId, userId);
    const result = await this.repo.listMembers(orgId, q, filters);
    return { data: result.data.map(toMemberDto), meta: result.meta };
  }

  async getMember(orgId: string, actorUserId: string, targetUserId: string) {
    await this.requireMember(orgId, actorUserId);
    const m = await this.repo.findMember(orgId, targetUserId);
    if (!m) throw new NotFoundError("Member");
    return toMemberDto(m);
  }

  async updateMemberRole(meta: RequestMeta, orgId: string, targetUserId: string, newRole: OrgRole) {
    await this.requireMutableOrg(orgId);
    const actor = await this.requireMember(orgId, meta.actorUserId, "admin");
    if (meta.actorUserId === targetUserId) throw new ForbiddenError("Cannot change own role");
    const target = await this.repo.findActiveMember(orgId, targetUserId);
    if (!target) throw new NotFoundError("Member");
    if (!canManageRole(actor.role, target.role)) throw new ForbiddenError("Cannot manage a user with equal or higher role");
    if (newRole === "owner") throw new ValidationError("Use transfer ownership endpoint");
    const oldRole = target.role;
    await this.repo.updateMemberRole(orgId, targetUserId, newRole);
    await this.audit(meta, { orgId, action: "member.role_updated", entityType: "member", entityId: targetUserId, oldValues: { role: oldRole }, newValues: { role: newRole } });
  }

  async removeMember(meta: RequestMeta, orgId: string, targetUserId: string) {
    await this.requireMutableOrg(orgId);
    const actor = await this.requireMember(orgId, meta.actorUserId, "admin");
    if (meta.actorUserId === targetUserId) throw new ForbiddenError("Cannot remove yourself");
    const target = await this.repo.findActiveMember(orgId, targetUserId);
    if (!target) throw new NotFoundError("Member");
    if (!canManageRole(actor.role, target.role)) throw new ForbiddenError("Cannot remove a user with equal or higher role");
    if (target.role === "owner") { const c = await this.repo.countOwners(orgId); if (c <= 1) throw new ForbiddenError("Cannot remove the last owner"); }
    await this.repo.removeMember(orgId, targetUserId, meta.actorUserId);
    invalidateMembershipCache(orgId, targetUserId);
    await this.audit(meta, { orgId, action: "member.removed", entityType: "member", entityId: targetUserId, isSensitive: true });
  }

  async suspendMember(meta: RequestMeta, orgId: string, targetUserId: string) {
    await this.requireMutableOrg(orgId);
    const actor = await this.requireMember(orgId, meta.actorUserId, "admin");
    const target = await this.repo.findActiveMember(orgId, targetUserId);
    if (!target) throw new NotFoundError("Member");
    if (!canManageRole(actor.role, target.role)) throw new ForbiddenError("Cannot suspend this user");
    await this.repo.suspendMember(orgId, targetUserId, meta.actorUserId);
    invalidateMembershipCache(orgId, targetUserId);
    await this.audit(meta, { orgId, action: "member.suspended", entityType: "member", entityId: targetUserId });
  }

  async reactivateMember(meta: RequestMeta, orgId: string, targetUserId: string) {
    await this.requireMutableOrg(orgId);
    await this.requireMember(orgId, meta.actorUserId, "admin");
    await this.repo.reactivateMember(orgId, targetUserId);
    invalidateMembershipCache(orgId, targetUserId);
    await this.audit(meta, { orgId, action: "member.reactivated", entityType: "member", entityId: targetUserId });
  }

  // ── Invitations ───────────────────────────────
  async inviteMember(meta: RequestMeta, orgId: string, email: string, role: OrgRole) {
    const org = await this.requireMutableOrg(orgId);
    await this.requireMember(orgId, meta.actorUserId, "admin");
    await this.enforceBillingLimit(orgId, "member");

    const token = generateToken();
    const tokenHash = hashToken(token);
    const expiresAt = new Date(Date.now() + INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
    const inv = await this.repo.createInvitation(orgId, meta.actorUserId, email, role, tokenHash, expiresAt);

    // Does the invitee already have an account? Drives both the email copy and
    // the accountExists flag in the invite URL so the frontend can route them
    // to sign-in vs. create-account.
    const existingUser = await this.repo.findUserByEmail(email);
    const accountExists = !!existingUser;
    const inviteUrl = buildInviteUrl(token, accountExists);

    // Send the invitation email. Email delivery is best-effort: a transient
    // SMTP failure must NOT roll back the invitation (it can be resent), but we
    // surface the failure in logs and the audit metadata.
    let emailSent = true;
    try {
      await this.sendInvitationEmail({
        toEmail: email,
        toName: existingUser?.full_name,
        orgName: org.name,
        inviterName: meta.actorEmail,
        role,
        inviteUrl,
        accountExists,
      });
    } catch (err) {
      emailSent = false;
      this.log.error({ err, orgId, email }, "Invitation email failed to send");
    }

    await this.audit(meta, {
      orgId,
      action: "member.invited",
      entityType: "invitation",
      entityId: inv.id,
      newValues: { email, role, accountExists, emailSent },
    });

    return { ...toInviteDto(inv), token, inviteUrl, accountExists, emailSent };
  }

  async resendInvitation(meta: RequestMeta, orgId: string, invitationId: string) {
    const org = await this.requireMutableOrg(orgId);
    await this.requireMember(orgId, meta.actorUserId, "admin");
    const inv = await this.repo.findInvitationById(invitationId);
    if (!inv || inv.org_id !== orgId) throw new NotFoundError("Invitation");
    if (inv.status !== "pending") throw new ValidationError("Invitation is not pending");
    if (inv.expires_at && new Date(inv.expires_at).getTime() <= Date.now()) {
      throw new ValidationError("Invitation has expired. Create a new one.");
    }

    // We never store the plaintext token, so resending issues a fresh token
    // (and rotates the stored hash) so the emailed link is always valid.
    const token = generateToken();
    const tokenHash = hashToken(token);
    await this.repo.rotateInvitationToken(invitationId, tokenHash);
    await this.repo.incrementResentCount(invitationId);

    const existingUser = await this.repo.findUserByEmail(inv.email);
    const accountExists = !!existingUser;
    const inviteUrl = buildInviteUrl(token, accountExists);

    await this.sendInvitationEmail({
      toEmail: inv.email,
      toName: existingUser?.full_name,
      orgName: org.name,
      inviterName: meta.actorEmail,
      role: inv.role,
      inviteUrl,
      accountExists,
    });

    await this.audit(meta, { orgId, action: "invitation.resent", entityType: "invitation", entityId: invitationId });
    return { inviteUrl, accountExists };
  }

  async revokeInvitation(meta: RequestMeta, orgId: string, invitationId: string) {
    await this.requireMember(orgId, meta.actorUserId, "admin");
    const inv = await this.repo.findInvitationById(invitationId);
    if (!inv || inv.org_id !== orgId) throw new NotFoundError("Invitation");
    await this.repo.revokeInvitation(invitationId, meta.actorUserId);
    await this.audit(meta, { orgId, action: "invitation.revoked", entityType: "invitation", entityId: invitationId });
  }

  async acceptInvitation(meta: RequestMeta, token: string) {
    const tokenHash = hashToken(token);
    const inv = await this.repo.findInvitationByTokenHash(tokenHash);
    if (!inv) throw new NotFoundError("Invitation");

    // Bind the invitation to the invited identity. Without this check ANY
    // authenticated user who obtains the token could redeem it and join the
    // org at the invited role (invite theft / privilege escalation).
    const invitedEmail = inv.email.trim().toLowerCase();
    const actorEmail = (meta.actorEmail ?? "").trim().toLowerCase();
    if (!actorEmail || actorEmail !== invitedEmail) {
      throw new ForbiddenError(
        "This invitation was issued to a different email address",
      );
    }
    if (inv.expires_at && new Date(inv.expires_at).getTime() <= Date.now()) {
      throw new ValidationError("Invitation has expired");
    }

    const { maxMembers } = await this.enforceBillingLimit(inv.org_id, "member");
    await this.repo.acceptInvitationAndAddMember(tokenHash, meta.actorUserId, maxMembers ?? null);
    invalidateMembershipCache(inv.org_id, meta.actorUserId);
    await this.audit(meta, { orgId: inv.org_id, action: "invitation.accepted", entityType: "invitation", entityId: inv.id });
  }

  async declineInvitation(meta: RequestMeta, invitationId: string) {
    const inv = await this.repo.findInvitationById(invitationId);
    if (!inv) throw new NotFoundError("Invitation");
    const invitedEmail = inv.email.trim().toLowerCase();
    const actorEmail = (meta.actorEmail ?? "").trim().toLowerCase();
    if (!actorEmail || actorEmail !== invitedEmail) {
      throw new ForbiddenError("This invitation was issued to a different email address");
    }
    await this.repo.declineInvitation(invitationId, meta.actorUserId);
    await this.audit(meta, { orgId: inv.org_id, action: "invitation.declined", entityType: "invitation", entityId: invitationId });
  }

  async listInvitations(orgId: string, userId: string, q: CursorPaginationQuery, status?: string) {
    await this.requireMember(orgId, userId, "admin");
    const result = await this.repo.listInvitations(orgId, q, status);
    return { data: result.data.map(toInviteDto), meta: result.meta };
  }

  // ── Environments ──────────────────────────────
  async createEnvironment(meta: RequestMeta, orgId: string, data: { name: string; description?: string; isProduction?: boolean }) {
    await this.requireMutableOrg(orgId);
    await this.requireMember(orgId, meta.actorUserId, "admin");
    await this.enforceBillingLimit(orgId, "environment");
    const env = await this.repo.createEnvironment(orgId, data.name, data.description ?? null, data.isProduction ?? false, meta.actorUserId);
    await this.audit(meta, { orgId, action: "environment.created", entityType: "environment", entityId: env.id, entityName: env.name });
    return { id: env.id, name: env.name, slug: env.slug, description: env.description, isProduction: env.is_production, createdAt: env.created_at } as EnvironmentDto;
  }

  async updateEnvironment(meta: RequestMeta, orgId: string, envId: string, data: Record<string, unknown>) {
    await this.requireMutableOrg(orgId);
    await this.requireMember(orgId, meta.actorUserId, "admin");
    const env = await this.repo.updateEnvironment(orgId, envId, data);
    await this.audit(meta, { orgId, action: "environment.updated", entityType: "environment", entityId: envId });
    return { id: env.id, name: env.name, slug: env.slug, description: env.description, isProduction: env.is_production, createdAt: env.created_at } as EnvironmentDto;
  }

  async listEnvironments(orgId: string, userId: string) {
    await this.requireMember(orgId, userId);
    const rows = await this.repo.listEnvironments(orgId);
    return rows.map(e => ({ id: e.id, name: e.name, slug: e.slug, description: e.description, isProduction: e.is_production, createdAt: e.created_at }) as EnvironmentDto);
  }

  // ── API Keys ──────────────────────────────────
  async createApiKey(meta: RequestMeta, orgId: string, data: { name: string; role?: OrgRole; environmentId?: string; expiresInDays?: number }) {
    await this.requireMutableOrg(orgId);
    await this.requireMember(orgId, meta.actorUserId, "admin");
    await this.enforceBillingLimit(orgId, "apiKey");
    const rawKey = generateToken();
    const prefix = rawKey.substring(0, 8);
    const hashed = hashToken(rawKey);
    const expiresAt = data.expiresInDays ? new Date(Date.now() + data.expiresInDays * 86400000) : null;
    const key = await this.repo.createApiKey(orgId, data.name, prefix, hashed, data.role ?? "member", data.environmentId ?? null, expiresAt, meta.actorUserId);
    await this.audit(meta, { orgId, action: "api_key.created", entityType: "api_key", entityId: key.id, entityName: data.name, isSensitive: true });
    return { ...({ id: key.id, name: key.name, keyPrefix: key.key_prefix, role: key.role, environmentId: key.environment_id, lastUsedAt: key.last_used_at, expiresAt: key.expires_at, revokedAt: key.revoked_at, createdAt: key.created_at } as ApiKeyDto), rawKey };
  }

  async revokeApiKey(meta: RequestMeta, orgId: string, keyId: string) {
    await this.requireMember(orgId, meta.actorUserId, "admin");
    await this.repo.revokeApiKey(orgId, keyId);
    await this.audit(meta, { orgId, action: "api_key.revoked", entityType: "api_key", entityId: keyId, isSensitive: true });
  }

  async listApiKeys(orgId: string, userId: string, q: CursorPaginationQuery) {
    await this.requireMember(orgId, userId, "admin");
    const result = await this.repo.listApiKeys(orgId, q);
    return { data: result.data.map(k => ({ id: k.id, name: k.name, keyPrefix: k.key_prefix, role: k.role, environmentId: k.environment_id, lastUsedAt: k.last_used_at, expiresAt: k.expires_at, revokedAt: k.revoked_at, createdAt: k.created_at }) as ApiKeyDto), meta: result.meta };
  }

  // ── SSO ────────────────────────────────────────
  async createSsoProvider(meta: RequestMeta, orgId: string, data: Record<string, unknown>) {
    await this.requireMutableOrg(orgId);
    await this.requireMember(orgId, meta.actorUserId, "owner");
    await this.enforceBillingLimit(orgId, "sso");
    const sso = await this.repo.createSsoProvider(orgId, data);
    await this.audit(meta, { orgId, action: "sso.created", entityType: "sso_provider", entityId: sso.id, isSensitive: true });
    return { id: sso.id, providerName: sso.provider_name, providerType: sso.provider_type, entityId: sso.entity_id, ssoUrl: sso.sso_url, domain: sso.domain, isActive: sso.is_active, createdAt: sso.created_at } as SsoProviderDto;
  }

  async updateSsoProvider(meta: RequestMeta, orgId: string, ssoId: string, data: Record<string, unknown>) {
    await this.requireMember(orgId, meta.actorUserId, "owner");
    const sso = await this.repo.updateSsoProvider(orgId, ssoId, data);
    await this.audit(meta, { orgId, action: "sso.updated", entityType: "sso_provider", entityId: ssoId });
    return { id: sso.id, providerName: sso.provider_name, providerType: sso.provider_type, entityId: sso.entity_id, ssoUrl: sso.sso_url, domain: sso.domain, isActive: sso.is_active, createdAt: sso.created_at } as SsoProviderDto;
  }

  async deleteSsoProvider(meta: RequestMeta, orgId: string, ssoId: string) {
    await this.requireMember(orgId, meta.actorUserId, "owner");
    await this.repo.deleteSsoProvider(orgId, ssoId);
    await this.audit(meta, { orgId, action: "sso.deleted", entityType: "sso_provider", entityId: ssoId, isSensitive: true });
  }

  // ── SCIM ──────────────────────────────────────
  async createScimToken(meta: RequestMeta, orgId: string, data?: { scopes?: string[]; allowedIps?: string[]; expiresInDays?: number | undefined }) {
    await this.requireMutableOrg(orgId);
    await this.requireMember(orgId, meta.actorUserId, "owner");
    // await this.enforceBillingLimit(orgId, "scim");
    const payload: {
      orgId: string;
      createdBy: string;
      scopes: string[];
      allowedIps?: string[];
      expiresInDays?: number;
    } = {
      orgId,
      createdBy: meta.actorUserId,
      scopes: data?.scopes?.length ? data.scopes : ["users:read", "users:write", "users:delete", "groups:read", "groups:write", "groups:delete"],
      ...(data?.allowedIps !== undefined ? { allowedIps: data.allowedIps } : {}),
      ...(data?.expiresInDays !== undefined ? { expiresInDays: data.expiresInDays } : {}),
    };
    const created = await this.scimTokenService.createToken(payload);
    const tokens = await this.scimTokenService.listTokens(orgId);
    const token = tokens.find((item) => item.id === created.tokenId);
    if (!token) throw new NotFoundError("SCIM token");
    return { ...this.toScimTokenDto(token), rawToken: created.rawToken };
  }

  async revokeScimToken(meta: RequestMeta, orgId: string, tokenId: string) {
    await this.requireMember(orgId, meta.actorUserId, "owner");
    const tokens = await this.scimTokenService.listTokens(orgId);
    if (!tokens.some((item) => item.id === tokenId)) throw new NotFoundError("SCIM token");
    await this.scimTokenService.revokeToken(tokenId, meta.actorUserId);
  }

  async rotateScimToken(meta: RequestMeta, orgId: string, tokenId: string) {
    await this.requireMutableOrg(orgId);
    await this.requireMember(orgId, meta.actorUserId, "owner");
    const tokens = await this.scimTokenService.listTokens(orgId);
    if (!tokens.some((item) => item.id === tokenId)) throw new NotFoundError("SCIM token");
    const rotated = await this.scimTokenService.rotateToken(tokenId, meta.actorUserId);
    const updatedTokens = await this.scimTokenService.listTokens(orgId);
    const token = updatedTokens.find((item) => item.id === rotated.newTokenId);
    if (!token) throw new NotFoundError("SCIM token");
    return { ...this.toScimTokenDto(token), rawToken: rotated.rawToken };
  }

  // ── Security & Audit ──────────────────────────
  async listSecurityEvents(orgId: string, userId: string, q: CursorPaginationQuery, filters?: { severity?: string; eventType?: string }) {
    await this.requireMember(orgId, userId, "security");
    const result = await this.repo.listSecurityEvents(orgId, q, filters);
    return { data: result.data.map(e => ({ id: e.id, userId: e.user_id, eventType: e.event_type, severity: e.severity, ipAddress: e.ip_address, metadata: e.metadata, createdAt: e.created_at }) as SecurityEventDto), meta: result.meta };
  }

  async listAuditLogs(orgId: string, userId: string, q: CursorPaginationQuery, filters?: { action?: string; entityType?: string; actorUserId?: string }) {
    await this.requireMember(orgId, userId, "admin");
    const result = await this.repo.listAuditLogs(orgId, q, filters);
    return { data: result.data.map(a => ({ id: a.id, actorUserId: a.actor_user_id, actorEmail: a.actor_email, action: a.action, entityType: a.entity_type, entityId: a.entity_id, entityName: a.entity_name, status: a.status, createdAt: a.created_at }) as AuditLogDto), meta: result.meta };
  }

  // ── Quotas ────────────────────────────────────
  async createQuotaRequest(meta: RequestMeta, orgId: string, data: { quotaType: string; currentLimit: number; requestedLimit: number; reason: string }) {
    await this.requireMutableOrg(orgId);
    await this.requireMember(orgId, meta.actorUserId, "admin");
    const qr = await this.repo.createQuotaRequest(orgId, data.quotaType, data.currentLimit, data.requestedLimit, data.reason);
    await this.audit(meta, { orgId, action: "quota.requested", entityType: "quota_request", entityId: qr.id });
    return { id: qr.id, quotaType: qr.quota_type, currentLimit: qr.current_limit, requestedLimit: qr.requested_limit, reason: qr.reason, status: qr.status, reviewedAt: qr.reviewed_at, notes: qr.notes, createdAt: qr.created_at } as QuotaRequestDto;
  }

  async approveQuotaRequest(meta: RequestMeta, orgId: string, requestId: string, notes?: string) {
    await this.requireMember(orgId, meta.actorUserId, "owner");
    const qr = await this.repo.reviewQuotaRequest(orgId, requestId, "approved", meta.actorUserId, notes);
    await this.audit(meta, { orgId, action: "quota.approved", entityType: "quota_request", entityId: requestId });
    return { id: qr.id, quotaType: qr.quota_type, currentLimit: qr.current_limit, requestedLimit: qr.requested_limit, reason: qr.reason, status: qr.status, reviewedAt: qr.reviewed_at, notes: qr.notes, createdAt: qr.created_at } as QuotaRequestDto;
  }

  async rejectQuotaRequest(meta: RequestMeta, orgId: string, requestId: string, notes?: string) {
    await this.requireMember(orgId, meta.actorUserId, "owner");
    const qr = await this.repo.reviewQuotaRequest(orgId, requestId, "rejected", meta.actorUserId, notes);
    await this.audit(meta, { orgId, action: "quota.rejected", entityType: "quota_request", entityId: requestId });
    return { id: qr.id, quotaType: qr.quota_type, currentLimit: qr.current_limit, requestedLimit: qr.requested_limit, reason: qr.reason, status: qr.status, reviewedAt: qr.reviewed_at, notes: qr.notes, createdAt: qr.created_at } as QuotaRequestDto;
  }

  async listQuotaRequests(orgId: string, userId: string, q: CursorPaginationQuery) {
    await this.requireMember(orgId, userId, "admin");
    const result = await this.repo.listQuotaRequests(orgId, q);
    return { data: result.data.map(qr => ({ id: qr.id, quotaType: qr.quota_type, currentLimit: qr.current_limit, requestedLimit: qr.requested_limit, reason: qr.reason, status: qr.status, reviewedAt: qr.reviewed_at, notes: qr.notes, createdAt: qr.created_at }) as QuotaRequestDto), meta: result.meta };
  }

  async getBillingSummary(orgId: string, userId: string) {
    const { entitlements, counts } = await this.requireBillingEntitlements(orgId);
    await this.requireMember(orgId, userId, "billing");
    return {
      subscription: {
        id: entitlements.subscription_id,
        status: entitlements.subscription_status,
      },
      plan: {
        id: entitlements.plan_id,
        key: entitlements.plan_key,
        tier: entitlements.plan_tier,
        eventLimitMonthly: Number(entitlements.event_limit_monthly ?? 0),
        hardCap: entitlements.hard_cap,
        features: entitlements.feature_config,
      },
      usage: counts,
    };
  }

  async getUsageLimits(orgId: string, userId: string) {
    const { entitlements, counts } = await this.requireBillingEntitlements(orgId);
    await this.requireMember(orgId, userId);
    const normalizeLimit = (limit: number) => Number.isFinite(limit) ? limit : null;
    return {
      subscriptionStatus: entitlements.subscription_status,
      planKey: entitlements.plan_key,
      limits: {
        members: {
          used: counts.activeMembers,
          pending: counts.pendingInvitations,
          limit: normalizeLimit(this.limitFrom(entitlements, ["max_team_members", "max_members"])),
        },
        environments: {
          used: counts.environments,
          limit: normalizeLimit(this.limitFrom(entitlements, ["max_environments", "environments_max"])),
        },
        apiKeys: {
          used: counts.apiKeys,
          limit: normalizeLimit(this.limitFrom(entitlements, ["max_api_keys", "api_keys_max"])),
        },
        ssoProviders: {
          used: counts.ssoProviders,
          limit: normalizeLimit(this.limitFrom(entitlements, ["max_sso_providers", "sso_providers_max"], 1)),
          enabled: this.featureAllowed(entitlements, ["sso_saml", "sso_enabled", "saml_sso"], false),
        },
        scimTokens: {
          used: counts.scimTokens,
          limit: normalizeLimit(this.limitFrom(entitlements, ["max_scim_tokens", "scim_tokens_max"], 1)),
          enabled: this.featureAllowed(entitlements, ["scim", "scim_enabled"], false),
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
  async listUserOrganizations(userId: string, q: CursorPaginationQuery) {
    const result = await this.repo.listUserOrganizations(userId, q);
    return {
      data: result.data.map(r => ({ id: r.id, name: r.name, slug: r.slug, logoUrl: r.logo_url, role: r.role, status: r.status, createdAt: r.created_at }) as UserOrganizationDto),
      meta: result.meta
    };
  }

  // ── Validate Invitation Token ─────────────────
  async validateInvitationToken(token: string) {
    const tokenHash = hashToken(token);
    const inv = await this.repo.findInvitationByTokenHash(tokenHash);
    if (!inv) throw new NotFoundError("Invitation");
    const org = await this.repo.findOrgById(inv.org_id);
    // Tell the frontend whether the invitee already has an account so it can
    // render sign-in vs. create-account when the link is opened directly.
    const existingUser = await this.repo.findUserByEmail(inv.email);
    return {
      id: inv.id,
      valid: true,
      email: inv.email,
      role: inv.role,
      orgName: org?.name ?? null,
      orgSlug: org?.slug ?? null,
      expiresAt: inv.expires_at,
      accountExists: !!existingUser,
    };
  }

  // ── Slug Availability ─────────────────────────
  async checkSlugAvailability(slug: string) {
    const available = await this.repo.isSlugAvailable(slug);
    return { slug, available };
  }

  // ── Rotate API Key ────────────────────────────
  async rotateApiKey(meta: RequestMeta, orgId: string, keyId: string) {
    await this.requireMutableOrg(orgId);
    await this.requireMember(orgId, meta.actorUserId, "admin");
    const rawKey = generateToken();
    const prefix = rawKey.substring(0, 8);
    const hashed = hashToken(rawKey);
    const key = await this.repo.rotateApiKey(orgId, keyId, `rotated-key`, prefix, hashed, "member", null, null, meta.actorUserId);
    await this.audit(meta, { orgId, action: "api_key.rotated", entityType: "api_key", entityId: key.id, newValues: { oldKeyId: keyId }, isSensitive: true });
    return { ...({ id: key.id, name: key.name, keyPrefix: key.key_prefix, role: key.role, environmentId: key.environment_id, lastUsedAt: key.last_used_at, expiresAt: key.expires_at, revokedAt: key.revoked_at, createdAt: key.created_at } as ApiKeyDto), rawKey };
  }

  // ── Export Audit Logs ─────────────────────────
  async exportAuditLogs(orgId: string, userId: string, filters?: { action?: string; entityType?: string; actorUserId?: string; startDate?: string; endDate?: string }) {
    await this.requireMember(orgId, userId, "admin");
    const rows = await this.repo.exportAuditLogs(orgId, filters);
    return rows.map(a => ({ id: a.id, actorUserId: a.actor_user_id, actorEmail: a.actor_email, action: a.action, entityType: a.entity_type, entityId: a.entity_id, entityName: a.entity_name, oldValues: a.old_values, newValues: a.new_values, changedFields: a.changed_fields, status: a.status, createdAt: a.created_at }) as AuditLogDto & { oldValues: unknown; newValues: unknown; changedFields: unknown });
  }

  // ── Leave Organization ────────────────────────
  async leaveOrganization(meta: RequestMeta, orgId: string) {
    await this.requireMutableOrg(orgId);
    const member = await this.repo.findActiveMember(orgId, meta.actorUserId);
    if (!member) throw new NotFoundError("Member");
    if (member.role === "owner") {
      const ownerCount = await this.repo.countOwners(orgId);
      if (ownerCount <= 1) throw new ForbiddenError("Cannot leave as the last owner. Transfer ownership first.");
    }
    await this.repo.removeMember(orgId, meta.actorUserId, meta.actorUserId, "self-leave");
    invalidateMembershipCache(orgId, meta.actorUserId);
    await this.audit(meta, { orgId, action: "member.left", entityType: "member", entityId: meta.actorUserId });
  }

  // ── List SSO Providers ────────────────────────
  async listSsoProviders(orgId: string, userId: string) {
    await this.requireMember(orgId, userId, "admin");
    const rows = await this.repo.listSsoProviders(orgId);
    return rows.map(sso => ({ id: sso.id, providerName: sso.provider_name, providerType: sso.provider_type, entityId: sso.entity_id, ssoUrl: sso.sso_url, domain: sso.domain, isActive: sso.is_active, createdAt: sso.created_at }) as SsoProviderDto);
  }

  // ── List SCIM Tokens ──────────────────────────
  async listScimTokens(orgId: string, userId: string) {
    await this.requireMember(orgId, userId, "owner");
    const rows = await this.scimTokenService.listTokens(orgId);
    return rows.map((token) => this.toScimTokenDto(token));
  }

  private toScimTokenDto(token: {
    id: string;
    last_used_at: Date | null;
    expires_at: Date | null;
    revoked_at: Date | null;
    created_at: Date;
    scopes?: string[] | null;
    allowed_ips?: string[] | null;
  }): ScimTokenDto {
    return {
      id: token.id,
      lastUsedAt: token.last_used_at,
      expiresAt: token.expires_at,
      revokedAt: token.revoked_at,
      createdAt: token.created_at,
      scopes: token.scopes ?? [],
      allowedIps: token.allowed_ips ?? [],
    } as ScimTokenDto;
  }
}
