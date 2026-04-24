/**
 * Organization business service.
 *
 * Flow:
 * 1. Verify membership and role hierarchy before organization operations.
 * 2. Keep owner-only actions, admin actions, billing/security updates, and
 *    invitation lifecycle rules centralized outside the routes.
 * 3. Persist state through the repository and write audit records for sensitive
 *    changes.
 * 4. Emit domain events best-effort; event failures are logged but do not roll
 *    back already committed organization state.
 */
import { createHash } from "crypto";
import { generateInvitationToken } from "./utils.js";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  type AddMemberInput,
  type AuditAction,
  type AuditResourceType,
  type CreateInvitationInput,
  type CreateOrganizationInput,
  type OrgRole,
  type Organization,
  type OrganizationInvitation,
  type OrganizationMember,
  type OrganizationServiceDependencies,
  type UpdateBillingInput,
  type UpdateOrganizationInput,
  type UpdateOrganizationRecord,
  type UpdateSecurityInput,
  type UpgradePlanInput,
} from "./types.js";

interface RequestMeta {
  ipAddress: string | null;
  userAgent: string | null;
}

const ROLE_HIERARCHY: Record<OrgRole, number> = {
  owner: 5,
  admin: 4,
  billing: 3,
  member: 2,
  viewer: 1,
};

export class OrganizationService {
  constructor(private readonly deps: OrganizationServiceDependencies) {}

  async createOrganization(
    data: CreateOrganizationInput,
    ownerUserId: string,
    meta?: RequestMeta,
  ): Promise<Organization> {
    // Creation is delegated to the repository because it must create the
    // organization, owner membership, settings, billing, and initial usage rows
    // in one transaction.
    const org = await this.deps.repository.create({
      name: data.name,
      ownerUserId,
    });

    // await this.audit(
    //   org.id,
    //   ownerUserId,
    //   "org.created",
    //   "organization",
    //   org.id,
    //   { name: org.name, planId: org.planId },
    //   meta,
    // );

    // this.deps.logger.info({ orgId: org.id, ownerUserId }, "Organization created");

    // await this.safeEmit("organization.created", {
    //   orgId: org.id,
    //   ownerUserId,
    //   planId: org.planId,
    // });

    return org;
  }

  async listUserOrganizations(userId: string): Promise<Array<{ id: string; name: string; logoUrl: string | null }>> {
    return this.deps.repository.findByUserId(userId);
  }

  async getOrganization(orgId: string, userId: string, requiredRole?: OrgRole): Promise<Organization> {
    // Fetch organization and membership in parallel, then enforce membership
    // and optional minimum role before returning organization details.
    const [org, membership] = await Promise.all([
      this.deps.repository.findById(orgId),
      this.deps.repository.findMember(orgId, userId),
    ]);

    if (!org) {
      throw new NotFoundError("Organization");
    }

    if (!membership || !membership.isActive) {
      throw new ForbiddenError("Not a member of this organization");
    }

    if (requiredRole && !this.hasRequiredRole(membership.role, requiredRole)) {
      throw new ForbiddenError(`Requires ${requiredRole} role`);
    }

    return org;
  }

  async updateOrganization(
    orgId: string,
    data: UpdateOrganizationInput,
    userId: string,
    meta?: RequestMeta,
  ): Promise<Organization> {
    // Build a partial update payload so omitted fields keep their current
    // values. The repository decides which backing table owns each field.
    await this.getOrganization(orgId, userId, "admin");

    const updatePayload: UpdateOrganizationRecord = {};

    if (data.name !== undefined) updatePayload.name = data.name;
    if (data.description !== undefined) updatePayload.description = data.description;
    if (data.websiteUrl !== undefined) updatePayload.websiteUrl = data.websiteUrl;
    if (data.billingEmail !== undefined) updatePayload.billingEmail = data.billingEmail;
    if (data.billingName !== undefined) updatePayload.billingName = data.billingName;
    if (data.billingAddress !== undefined) updatePayload.billingAddress = data.billingAddress;
    if (data.dataRegion !== undefined) updatePayload.dataRegion = data.dataRegion;
    if (data.enforceSso !== undefined) updatePayload.enforceSso = data.enforceSso;
    if (data.enforceMfa !== undefined) updatePayload.enforceMfa = data.enforceMfa;
    if (data.allowedEmailDomains !== undefined) {
      updatePayload.allowedEmailDomains = data.allowedEmailDomains;
    }
    if (data.ipAllowlist !== undefined) updatePayload.ipAllowlist = data.ipAllowlist;
    if (data.sessionTimeoutMinutes !== undefined) {
      updatePayload.sessionTimeoutMinutes = data.sessionTimeoutMinutes;
    }
    if (data.dataRetentionDays !== undefined) {
      updatePayload.dataRetentionDays = data.dataRetentionDays;
    }

    const updated = await this.deps.repository.update(orgId, updatePayload);

    await this.audit(
      orgId,
      userId,
      "org.updated",
      "organization",
      orgId,
      { fields: Object.keys(updatePayload) },
      meta,
    );

    this.deps.logger.info({ orgId, updatedBy: userId }, "Organization updated");

    return updated;
  }

  async deleteOrganization(orgId: string, userId: string, meta?: RequestMeta): Promise<void> {
    const member = await this.deps.repository.findMember(orgId, userId);
    if (!member || member.role !== "owner") {
      throw new ForbiddenError("Only owner can delete organization");
    }

    await this.deps.repository.softDelete(orgId, userId);

    await this.audit(orgId, userId, "org.deleted", "organization", orgId, null, meta);
    this.deps.logger.warn({ orgId, deletedBy: userId }, "Organization deleted");

    await this.safeEmit("organization.deleted", { orgId, deletedBy: userId });
  }

  async restoreOrganization(orgId: string, userId: string, meta?: RequestMeta): Promise<Organization> {
    const org = await this.deps.repository.findById(orgId, true);
    if (!org || !org.deletedAt) {
      throw new NotFoundError("Organization");
    }

    if (org.ownerUserId !== userId) {
      throw new ForbiddenError("Only owner can restore organization");
    }

    await this.deps.repository.restore(orgId);
    await this.audit(orgId, userId, "org.updated", "organization", orgId, { restored: true }, meta);

    const restored = await this.deps.repository.findById(orgId);
    if (!restored) {
      throw new NotFoundError("Organization");
    }

    this.deps.logger.info({ orgId, restoredBy: userId }, "Organization restored");
    return restored;
  }

  async getAuditLogs(orgId: string, userId: string, limit = 50, offset = 0) {
    await this.getOrganization(orgId, userId, "admin");
    return this.deps.repository.findAuditLogs(orgId, limit, offset);
  }

  async updateBilling(
    orgId: string,
    data: UpdateBillingInput,
    userId: string,
    meta?: RequestMeta,
  ): Promise<Organization> {
    await this.getOrganization(orgId, userId, "admin");

    const updated = await this.deps.repository.update(orgId, {
      billingEmail: data.billingEmail,
      billingName: data.billingName ?? null,
      billingAddress: data.billingAddress,
    });

    await this.audit(
      orgId,
      userId,
      "org.updated",
      "organization",
      orgId,
      { section: "billing" },
      meta,
    );

    this.deps.logger.info({ orgId, updatedBy: userId }, "Billing settings updated");

    return updated;
  }

  async updateSecuritySettings(
    orgId: string,
    data: UpdateSecurityInput,
    userId: string,
    meta?: RequestMeta,
  ): Promise<Organization> {
    await this.getOrganization(orgId, userId, "admin");

    const updated = await this.deps.repository.update(orgId, {
      enforceSso: data.enforceSso,
      enforceMfa: data.enforceMfa,
      allowedEmailDomains: data.allowedEmailDomains,
      ipAllowlist: data.ipAllowlist,
      sessionTimeoutMinutes: data.sessionTimeoutMinutes,
    });

    await this.audit(
      orgId,
      userId,
      "org.updated",
      "organization",
      orgId,
      {
        section: "security",
        enforceSso: data.enforceSso,
        enforceMfa: data.enforceMfa,
      },
      meta,
    );

    this.deps.logger.info({ orgId, updatedBy: userId }, "Security settings updated");
    return updated;
  }

  async upgradePlan(
    orgId: string,
    data: UpgradePlanInput,
    userId: string,
    meta?: RequestMeta,
  ): Promise<Organization> {
    const member = await this.deps.repository.findMember(orgId, userId);
    if (!member || member.role !== "owner") {
      throw new ForbiddenError("Only owner can upgrade plan");
    }

    const updated = await this.deps.repository.update(orgId, {
      planId: data.planId,
      planStartedAt: new Date(),
      billingStatus: "active",
    });

    await this.audit(
      orgId,
      userId,
      "billing.subscription_created",
      "subscription",
      orgId,
      {
        planId: data.planId,
        billingCycle: data.billingCycle,
      },
      meta,
    );

    await this.safeEmit("billing.plan_changed", {
      orgId,
      planId: data.planId,
      billingCycle: data.billingCycle,
      changedBy: userId,
    });

    return updated;
  }

  async listMembers(orgId: string, userId: string): Promise<OrganizationMember[]> {
    await this.getOrganization(orgId, userId);
    return this.deps.repository.findMembersByOrgId(orgId);
  }

  async getMember(orgId: string, targetUserId: string, requestingUserId: string): Promise<OrganizationMember> {
    await this.getOrganization(orgId, requestingUserId);

    const member = await this.deps.repository.findMember(orgId, targetUserId);
    if (!member) {
      throw new NotFoundError("Member");
    }

    return member;
  }

  async addMember(
    orgId: string,
    data: AddMemberInput,
    addedBy: string,
    meta?: RequestMeta,
  ): Promise<OrganizationMember> {
    const actor = await this.deps.repository.findMember(orgId, addedBy);
    if (!actor || !this.hasRequiredRole(actor.role, "admin")) {
      throw new ForbiddenError("Insufficient permissions");
    }

    const existing = await this.deps.repository.findMember(orgId, data.userId);
    if (existing?.isActive) {
      throw new ConflictError("User is already a member");
    }

    const member = await this.deps.repository.addMember({
      orgId,
      userId: data.userId,
      role: data.role,
      permissions: {},
      isActive: true,
      invitedBy: addedBy,
      invitedAt: new Date(),
      joinedMethod: "admin_add",
      lastActiveAt: new Date(),
    });

    await this.audit(
      orgId,
      addedBy,
      "org.member_invited",
      "organization",
      orgId,
      { memberUserId: data.userId, role: data.role, method: "admin_add" },
      meta,
    );

    await this.safeEmit("organization.member.added", {
      orgId,
      userId: data.userId,
      role: data.role,
      method: "admin_add",
    });

    return member;
  }

  async removeMember(
    orgId: string,
    userId: string,
    removedBy: string,
    reason?: string,
    meta?: RequestMeta,
  ): Promise<void> {
    // Member removal checks actor authority, target existence, owner protection,
    // and last-owner protection before deactivating membership.
    const [actor, target] = await Promise.all([
      this.deps.repository.findMember(orgId, removedBy),
      this.deps.repository.findMember(orgId, userId),
    ]);

    if (!actor || !this.hasRequiredRole(actor.role, "admin")) {
      throw new ForbiddenError("Insufficient permissions");
    }

    if (!target || !target.isActive) {
      throw new NotFoundError("Member");
    }

    if (target.role === "owner" && actor.role !== "owner") {
      throw new ForbiddenError("Cannot remove organization owner");
    }

    if (target.role === "owner") {
      const ownerCount = await this.deps.repository.countActiveOwners(orgId);
      if (ownerCount <= 1) {
        throw new ForbiddenError("Cannot remove the last owner");
      }
    }

    await this.deps.repository.removeMember(orgId, userId, removedBy, reason);
    await this.audit(
      orgId,
      removedBy,
      "org.member_removed",
      "organization",
      orgId,
      { memberUserId: userId, reason: reason ?? null },
      meta,
    );
  }

  async updateMemberRole(
    orgId: string,
    userId: string,
    newRole: OrgRole,
    updatedBy: string,
    meta?: RequestMeta,
  ): Promise<void> {
    // Role changes protect ownership invariants: only owners can grant owner,
    // and the last owner cannot be demoted.
    const [actor, target] = await Promise.all([
      this.deps.repository.findMember(orgId, updatedBy),
      this.deps.repository.findMember(orgId, userId),
    ]);

    if (!actor || !this.hasRequiredRole(actor.role, "admin")) {
      throw new ForbiddenError("Insufficient permissions");
    }

    if (!target || !target.isActive) {
      throw new NotFoundError("Member");
    }

    if (newRole === "owner" && actor.role !== "owner") {
      throw new ForbiddenError("Only owner can assign owner role");
    }

    if (target.role === "owner" && newRole !== "owner") {
      const ownerCount = await this.deps.repository.countActiveOwners(orgId);
      if (ownerCount <= 1) {
        throw new ForbiddenError("Cannot demote the last owner");
      }
    }

    await this.deps.repository.updateMemberRole(orgId, userId, newRole);
    await this.audit(
      orgId,
      updatedBy,
      "org.role_changed",
      "organization",
      orgId,
      { memberUserId: userId, oldRole: target.role, newRole },
      meta,
    );
  }

  async transferOwnership(orgId: string, toUserId: string, fromUserId: string, meta?: RequestMeta): Promise<void> {
    const [fromMember, toMember] = await Promise.all([
      this.deps.repository.findMember(orgId, fromUserId),
      this.deps.repository.findMember(orgId, toUserId),
    ]);

    if (!fromMember || fromMember.role !== "owner") {
      throw new ForbiddenError("Only owner can transfer ownership");
    }

    if (!toMember || !toMember.isActive) {
      throw new NotFoundError("Target member");
    }

    await this.deps.repository.transferOwnership(orgId, fromUserId, toUserId);
    await this.audit(
      orgId,
      fromUserId,
      "org.role_changed",
      "organization",
      orgId,
      { fromUserId, toUserId, action: "ownership_transfer" },
      meta,
    );
  }

  async leaveOrganization(orgId: string, userId: string, meta?: RequestMeta): Promise<void> {
    const member = await this.deps.repository.findMember(orgId, userId);
    if (!member || !member.isActive) {
      throw new NotFoundError("Member");
    }

    if (member.role === "owner") {
      const ownerCount = await this.deps.repository.countActiveOwners(orgId);
      if (ownerCount <= 1) {
        throw new ForbiddenError("Owner must transfer ownership before leaving");
      }
    }

    await this.deps.repository.removeMember(orgId, userId, userId, "self_leave");
    await this.audit(
      orgId,
      userId,
      "org.member_removed",
      "organization",
      orgId,
      { memberUserId: userId, reason: "self_leave" },
      meta,
    );
  }

  async listInvitations(
    orgId: string,
    userId: string,
    status?: "pending" | "accepted" | "declined" | "revoked",
  ): Promise<OrganizationInvitation[]> {
    const member = await this.deps.repository.findMember(orgId, userId);
    if (!member || !this.hasRequiredRole(member.role, "admin")) {
      throw new ForbiddenError("Insufficient permissions");
    }

    return this.deps.repository.findInvitationsByOrgId(orgId, status);
  }

  async inviteMember(
    orgId: string,
    data: CreateInvitationInput,
    invitedBy: string,
    meta?: RequestMeta,
  ): Promise<{ invitation: OrganizationInvitation; token: string }> {
    // Invitation tokens are returned once, while only the SHA-256 hash is stored
    // for later validation and acceptance.
    const member = await this.deps.repository.findMember(orgId, invitedBy);
    if (!member || !this.hasRequiredRole(member.role, "admin")) {
      throw new ForbiddenError("Insufficient permissions");
    }

    const token = generateInvitationToken();
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const emailNormalized = data.email.toLowerCase();

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    const invitation = await this.deps.repository.createInvitation({
      orgId,
      invitedBy,
      email: emailNormalized,
      role: data.role,
      tokenHash,
      expiresAt,
    });

    await this.audit(
      orgId,
      invitedBy,
      "org.member_invited",
      "organization",
      orgId,
      {
        invitationId: invitation.id,
        email: emailNormalized,
        role: data.role,
      },
      meta,
    );

    await this.safeEmit("organization.invitation.created", {
      invitationId: invitation.id,
      orgId,
      invitedBy,
      email: emailNormalized,
      token,
    });

    return { invitation, token };
  }

  async validateInvitationToken(token: string): Promise<{
    valid: boolean;
    organizationName?: string;
    invitedBy?: string;
    expiresAt?: Date;
  }> {
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const invitation = await this.deps.repository.findInvitationByTokenHash(tokenHash);

    if (!invitation) {
      return { valid: false };
    }

    const org = await this.deps.repository.findById(invitation.orgId);
    if (!org) {
      return { valid: false };
    }

    return {
      valid: true,
      organizationName: org.name,
      invitedBy: invitation.invitedBy,
      expiresAt: invitation.expiresAt,
    };
  }

  async acceptInvitation(
    token: string,
    userId: string,
    userEmail: string,
    meta?: RequestMeta,
  ): Promise<OrganizationMember> {
    // Accepting an invitation validates the token, confirms the accepting
    // user's email matches the invitation, consumes the invitation, and creates
    // or reactivates membership.
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const invitation = await this.deps.repository.findInvitationByTokenHash(tokenHash);

    if (!invitation) {
      throw new NotFoundError("Invitation");
    }

    const emailHash = createHash("sha256").update(userEmail.toLowerCase()).digest("hex");
    if (invitation.emailHash !== emailHash) {
      throw new ForbiddenError("Invitation email does not match user email");
    }

    const existing = await this.deps.repository.findMember(invitation.orgId, userId);
    if (existing?.isActive) {
      throw new ConflictError("User is already a member");
    }

    await this.deps.repository.acceptInvitation(tokenHash, userId);

    const member = await this.deps.repository.addMember({
      orgId: invitation.orgId,
      userId,
      role: invitation.role,
      permissions: {},
      isActive: true,
      invitedBy: invitation.invitedBy,
      invitedAt: invitation.createdAt,
      joinedMethod: "invite",
      lastActiveAt: new Date(),
    });

    await this.audit(
      invitation.orgId,
      userId,
      "org.member_joined",
      "organization",
      invitation.orgId,
      { invitationId: invitation.id },
      meta,
    );

    await this.safeEmit("organization.member.added", {
      orgId: invitation.orgId,
      userId,
      role: invitation.role,
      method: "invite",
    });

    return member;
  }

  async declineInvitation(invitationId: string, userId: string, meta?: RequestMeta): Promise<void> {
    const invitation = await this.deps.repository.findInvitationById(invitationId);
    if (!invitation) {
      throw new NotFoundError("Invitation");
    }

    await this.deps.repository.declineInvitation(invitation.tokenHash);
    await this.audit(
      invitation.orgId,
      userId,
      "org.updated",
      "organization",
      invitation.orgId,
      { invitationId: invitation.id, action: "declined" },
      meta,
    );
  }

  async resendInvitation(invitationId: string, userId: string, meta?: RequestMeta): Promise<void> {
    const invitation = await this.deps.repository.findInvitationById(invitationId);
    if (!invitation) {
      throw new NotFoundError("Invitation");
    }

    const member = await this.deps.repository.findMember(invitation.orgId, userId);
    if (!member || !this.hasRequiredRole(member.role, "admin")) {
      throw new ForbiddenError("Insufficient permissions");
    }

    if (invitation.resentCount >= 3) {
      throw new ForbiddenError("Maximum resend limit reached");
    }

    await this.deps.repository.incrementResentCount(invitationId);
    await this.audit(
      invitation.orgId,
      userId,
      "org.updated",
      "organization",
      invitation.orgId,
      { invitationId: invitation.id, action: "resent" },
      meta,
    );

    await this.safeEmit("organization.invitation.resent", {
      invitationId,
      orgId: invitation.orgId,
      email: invitation.email,
    });
  }

  async revokeInvitation(invitationId: string, revokedBy: string, meta?: RequestMeta): Promise<void> {
    const invitation = await this.deps.repository.findInvitationById(invitationId);
    if (!invitation) {
      throw new NotFoundError("Invitation");
    }

    const member = await this.deps.repository.findMember(invitation.orgId, revokedBy);
    if (!member || !this.hasRequiredRole(member.role, "admin")) {
      throw new ForbiddenError("Insufficient permissions");
    }

    await this.deps.repository.revokeInvitation(invitationId, revokedBy);
    await this.audit(
      invitation.orgId,
      revokedBy,
      "org.updated",
      "organization",
      invitation.orgId,
      { invitationId: invitation.id, action: "revoked" },
      meta,
    );
  }

  async checkSlugAvailability(slug: string): Promise<{ available: boolean; suggestions?: string[] }> {
    const existing = await this.deps.repository.findBySlug(slug);
    if (!existing) {
      return { available: true };
    }

    const year = new Date().getUTCFullYear();
    return {
      available: false,
      suggestions: [`${slug}-corp`, `${slug}-team`, `${slug}-${year}`],
    };
  }

  private hasRequiredRole(userRole: OrgRole, required: OrgRole): boolean {
    // Numeric hierarchy keeps role comparisons simple and consistent across all
    // organization service methods.
    return ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[required];
  }

  private async audit(
    orgId: string,
    userId: string | null,
    action: AuditAction,
    resourceType: AuditResourceType,
    resourceId: string | null,
    metadata: Record<string, unknown> | null,
    meta?: RequestMeta,
  ): Promise<void> {
    // The service owns audit shape so route handlers do not duplicate actor,
    // resource, metadata, or request-context mapping.
    await this.deps.repository.createAuditLog({
      orgId,
      userId,
      action,
      resourceType,
      resourceId,
      metadata,
      ipAddress: meta?.ipAddress ?? "0.0.0.0",
      userAgent: meta?.userAgent ?? null,
    });
  }

  private async safeEmit(event: string, payload: Record<string, unknown>): Promise<void> {
    // Domain events are non-critical side effects. They should never hide the
    // successful state change from the caller.
    try {
      await this.deps.emitEvent(event, payload);
    } catch (error) {
      this.deps.logger.error({ err: error, event, payload }, "Failed to emit organization event");
    }
  }
}
