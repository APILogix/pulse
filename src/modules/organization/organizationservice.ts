import { createHash } from "crypto";
import { generateInvitationToken } from "./utils.js";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  type AddMemberInput,
  type AuditAction,
  type AuditLogResponseDto,
  type AuditLogRow,
  type AuditResourceType,
  type BillingResponseDto,
  type CreateInvitationInput,
  type CreateOrganizationInput,
  type InvitationResponseDto,
  type InvitationStatus,
  type MemberResponseDto,
  type OrgRole,
  type OrganizationInvitationRow,
  type OrganizationMemberRow,
  type OrganizationResponseDto,
  type OrganizationRow,
  type OrganizationServiceDependencies,
  type PaginatedResponse,
  type PaginationQuery,
  type PlanResponseDto,
  type SecuritySettingsResponseDto,
  type UpdateBillingInput,
  type UpdateOrganizationInput,
  type UpdateOrganizationRecord,
  type UpdateSecurityInput,
  type UpgradePlanInput,
  type UserOrganizationResponseDto,
  type UserOrganizationRow,
} from "./types.js";

interface RequestMeta {
  ipAddress: string | null;
  userAgent: string | null;
}

const ROLE_HIERARCHY: Record<OrgRole, number> = {
  admin: 2,
  member: 1,
};

export class OrganizationService {
  constructor(private readonly deps: OrganizationServiceDependencies) {}

  async createOrganization(
    data: CreateOrganizationInput,
    ownerUserId: string,
    meta?: RequestMeta,
  ): Promise<OrganizationResponseDto> {
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
    //   { name: org.name },
    //   meta,
    // );

    return this.toOrganizationDto(org);
  }

  async listUserOrganizations(
    userId: string,
    pagination: PaginationQuery,
  ): Promise<PaginatedResponse<UserOrganizationResponseDto>> {
    const result = await this.deps.repository.findByUserId(userId, pagination);
    return this.mapPage(result, (row) => this.toUserOrganizationDto(row));
  }

  async getOrganization(
    orgId: string,
    userId: string,
    requiredRole?: OrgRole,
  ): Promise<OrganizationResponseDto> {
    const org = await this.requireOrganizationAccess(
      orgId,
      userId,
      requiredRole,
    );
    return this.toOrganizationDto(org);
  }

  async updateOrganization(
    orgId: string,
    data: UpdateOrganizationInput,
    userId: string,
    meta?: RequestMeta,
  ): Promise<OrganizationResponseDto> {
    // await this.requireOrganizationAccess(orgId, userId, "admin");

    const updatePayload: UpdateOrganizationRecord = {};

    if (data.name !== undefined) updatePayload.name = data.name;
    if (data.description !== undefined) {
      updatePayload.description = data.description;
    }
    if (data.websiteUrl !== undefined) updatePayload.websiteUrl = data.websiteUrl;
    if (data.billingEmail !== undefined) {
      updatePayload.billingEmail = data.billingEmail;
    }
    if (data.billingName !== undefined) updatePayload.billingName = data.billingName;
    if (data.billingAddress !== undefined) {
      updatePayload.billingAddress = data.billingAddress;
    }
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

    // await this.audit(
    //   orgId,
    //   userId,
    //   "org.updated",
    //   "organization",
    //   orgId,
    //   { fields: Object.keys(updatePayload) },
    //   meta,
    // );

    return this.toOrganizationDto(updated);
  }

  async deleteOrganization(
    orgId: string,
    userId: string,
    meta?: RequestMeta,
  ): Promise<void> {
    const org = await this.requireOrganizationAccess(orgId, userId, "admin");
    if (org.ownerUserId !== userId) {
      throw new ForbiddenError("Only the organization owner can delete organization");
    }

    await this.deps.repository.softDelete(orgId, userId);
    // await this.audit(orgId, userId, "org.deleted", "organization", orgId, null, meta);
    // await this.safeEmit("organization.deleted", { orgId, deletedBy: userId });
  }

  async restoreOrganization(
    orgId: string,
    userId: string,
    meta?: RequestMeta,
  ): Promise<OrganizationResponseDto> {
    const org = await this.deps.repository.findById(orgId, true);
    if (!org || !org.deletedAt) {
      throw new NotFoundError("Organization");
    }

    if (org.ownerUserId !== userId) {
      throw new ForbiddenError("Only the organization owner can restore organization");
    }

    await this.deps.repository.restore(orgId);
    // await this.audit(
    //   orgId,
    //   userId,
    //   "org.updated",
    //   "organization",
    //   orgId,
    //   { restored: true },
    //   meta,
    // );

    const restored = await this.deps.repository.findById(orgId);
    if (!restored) {
      throw new NotFoundError("Organization");
    }

    return this.toOrganizationDto(restored);
  }

  async getAuditLogs(
    orgId: string,
    userId: string,
    pagination: PaginationQuery,
  ): Promise<PaginatedResponse<AuditLogResponseDto>> {
    // await this.requireOrganizationAccess(orgId, userId, "admin");
    const result = await this.deps.repository.findAuditLogs(orgId, pagination);
    return this.mapPage(result, (row) => this.toAuditLogDto(row));
  }

  async getBilling(
    orgId: string,
    userId: string,
  ): Promise<BillingResponseDto> {
    const org = await this.requireOrganizationAccess(orgId, userId);
    return this.toBillingDto(org);
  }

  async updateBilling(
    orgId: string,
    data: UpdateBillingInput,
    userId: string,
    meta?: RequestMeta,
  ): Promise<BillingResponseDto> {
    // await this.requireOrganizationAccess(orgId, userId, "admin");

    const updated = await this.deps.repository.update(orgId, {
      billingEmail: data.billingEmail,
      billingName: data.billingName ?? null,
      billingAddress: data.billingAddress,
    });

    // await this.audit(
    //   orgId,
    //   userId,
    //   "org.updated",
    //   "organization",
    //   orgId,
    //   { section: "billing" },
    //   meta,
    // );

    return this.toBillingDto(updated);
  }

  async getPlan(orgId: string, userId: string): Promise<PlanResponseDto> {
    const org = await this.requireOrganizationAccess(orgId, userId);
    return this.toPlanDto(org);
  }

  async upgradePlan(
    orgId: string,
    data: UpgradePlanInput,
    userId: string,
    meta?: RequestMeta,
  ): Promise<PlanResponseDto> {
    const org = await this.requireOrganizationAccess(orgId, userId, "admin");
    if (org.ownerUserId !== userId) {
      throw new ForbiddenError("Only the organization owner can upgrade plan");
    }

    const updated = await this.deps.repository.update(orgId, {
      planId: data.planId,
      planStartedAt: new Date(),
      billingStatus: "active",
    });

    // await this.audit(
    //   orgId,
    //   userId,
    //   "billing.subscription_created",
    //   "subscription",
    //   orgId,
    //   { planId: data.planId, billingCycle: data.billingCycle },
    //   meta,
    // );

    // await this.safeEmit("billing.plan_changed", {
    //   orgId,
    //   planId: data.planId,
    //   billingCycle: data.billingCycle,
    //   changedBy: userId,
    // });

    return this.toPlanDto(updated);
  }

  async getSecuritySettings(
    orgId: string,
    userId: string,
  ): Promise<SecuritySettingsResponseDto> {
    const org = await this.requireOrganizationAccess(orgId, userId, "admin");
    return this.toSecuritySettingsDto(org);
  }

  async updateSecuritySettings(
    orgId: string,
    data: UpdateSecurityInput,
    userId: string,
    meta?: RequestMeta,
  ): Promise<SecuritySettingsResponseDto> {
    // await this.requireOrganizationAccess(orgId, userId, "admin");

    const updated = await this.deps.repository.update(orgId, {
      enforceSso: data.enforceSso,
      enforceMfa: data.enforceMfa,
      allowedEmailDomains: data.allowedEmailDomains,
      ipAllowlist: data.ipAllowlist,
      sessionTimeoutMinutes: data.sessionTimeoutMinutes,
    });

    // await this.audit(
    //   orgId,
    //   userId,
    //   "org.updated",
    //   "organization",
    //   orgId,
    //   {
    //     section: "security",
    //     enforceSso: data.enforceSso,
    //     enforceMfa: data.enforceMfa,
    //   },
    //   meta,
    // );

    return this.toSecuritySettingsDto(updated);
  }

  async listMembers(
    orgId: string,
    userId: string,
    pagination: PaginationQuery,
  ): Promise<PaginatedResponse<MemberResponseDto>> {
    await this.requireOrganizationAccess(orgId, userId);
    const result = await this.deps.repository.findMembersByOrgId(
      orgId,
      pagination,
    );
    return this.mapPage(result, (row) => this.toMemberDto(row));
  }

  async getMember(
    orgId: string,
    targetUserId: string,
    requestingUserId: string,
  ): Promise<MemberResponseDto> {
    await this.requireOrganizationAccess(orgId, requestingUserId);

    const member = await this.deps.repository.findMember(orgId, targetUserId);
    if (!member) {
      throw new NotFoundError("Member");
    }

    return this.toMemberDto(member);
  }

  async addMember(
    orgId: string,
    data: AddMemberInput,
    addedBy: string,
    meta?: RequestMeta,
  ): Promise<MemberResponseDto> {
    await this.requireOrganizationAccess(orgId, addedBy, "admin");

    const existing = await this.deps.repository.findMember(orgId, data.userId);
    if (existing?.isActive) {
      throw new ConflictError("User is already a member");
    }

    const member = await this.deps.repository.addMember({
      orgId,
      userId: data.userId,
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
      { memberUserId: data.userId, role: "member", method: "admin_add" },
      meta,
    );

    // await this.safeEmit("organization.member.added", {
    //   orgId,
    //   userId: data.userId,
    //   role: "member",
    //   method: "admin_add",
    // });

    return this.toMemberDto(member);
  }

  async removeMember(
    orgId: string,
    userId: string,
    removedBy: string,
    reason?: string,
    meta?: RequestMeta,
  ): Promise<void> {
    const [org, target] = await Promise.all([
      this.requireOrganizationAccess(orgId, removedBy, "admin"),
      this.deps.repository.findMember(orgId, userId),
    ]);

    if (!target || !target.isActive) {
      throw new NotFoundError("Member");
    }

    if (org.ownerUserId === userId) {
      throw new ForbiddenError("Cannot remove the organization owner");
    }

    await this.deps.repository.removeMember(orgId, userId, removedBy, reason);
    // await this.audit(
    //   orgId,
    //   removedBy,
    //   "org.member_removed",
    //   "organization",
    //   orgId,
    //   { memberUserId: userId, reason: reason ?? null },
    //   meta,
    // );
  }

  async updateMemberRole(
    orgId: string,
    userId: string,
    newRole: OrgRole,
    updatedBy: string,
    meta?: RequestMeta,
  ): Promise<void> {
    const [org, target] = await Promise.all([
      this.requireOrganizationAccess(orgId, updatedBy, "admin"),
      this.deps.repository.findMember(orgId, userId),
    ]);

    if (!target || !target.isActive) {
      throw new NotFoundError("Member");
    }

    if (org.ownerUserId === userId) {
      throw new ForbiddenError("Cannot change the organization owner's role");
    }

    if (newRole === "admin") {
      await this.deps.repository.transferOwnership(orgId, updatedBy, userId);
    } else {
      await this.deps.repository.updateMemberRole(orgId, userId);
    }

    // await this.audit(
    //   orgId,
    //   updatedBy,
    //   "org.role_changed",
    //   "organization",
    //   orgId,
    //   { memberUserId: userId, oldRole: target.role, newRole },
    //   meta,
    // );
  }

  async transferOwnership(
    orgId: string,
    toUserId: string,
    fromUserId: string,
    meta?: RequestMeta,
  ): Promise<void> {
    const [org, toMember] = await Promise.all([
      this.requireOrganizationAccess(orgId, fromUserId, "admin"),
      this.deps.repository.findMember(orgId, toUserId),
    ]);

    if (org.ownerUserId !== fromUserId) {
      throw new ForbiddenError("Only the organization owner can transfer ownership");
    }

    if (!toMember || !toMember.isActive) {
      throw new NotFoundError("Target member");
    }

    await this.deps.repository.transferOwnership(orgId, fromUserId, toUserId);
    // await this.audit(
    //   orgId,
    //   fromUserId,
    //   "org.role_changed",
    //   "organization",
    //   orgId,
    //   { fromUserId, toUserId, action: "ownership_transfer" },
    //   meta,
    // );
  }

  async leaveOrganization(
    orgId: string,
    userId: string,
    meta?: RequestMeta,
  ): Promise<void> {
    const org = await this.requireOrganizationAccess(orgId, userId);
    if (org.ownerUserId === userId) {
      throw new ForbiddenError("Owner must transfer ownership before leaving");
    }

    await this.deps.repository.removeMember(orgId, userId, userId, "self_leave");
    // await this.audit(
    //   orgId,
    //   userId,
    //   "org.member_removed",
    //   "organization",
    //   orgId,
    //   { memberUserId: userId, reason: "self_leave" },
    //   meta,
    // );
  }

  async listInvitations(
    orgId: string,
    userId: string,
    pagination: PaginationQuery,
    status?: InvitationStatus,
  ): Promise<PaginatedResponse<InvitationResponseDto>> {
    await this.requireOrganizationAccess(orgId, userId, "admin");
    const result = await this.deps.repository.findInvitationsByOrgId(
      orgId,
      pagination,
      status,
    );
    return this.mapPage(result, (row) => this.toInvitationDto(row));
  }

  async inviteMember(
    orgId: string,
    data: CreateInvitationInput,
    invitedBy: string,
    meta?: RequestMeta,
  ): Promise<{ invitation: InvitationResponseDto; token: string }> {
    await this.requireOrganizationAccess(orgId, invitedBy, "admin");

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

    // await this.audit(
    //   orgId,
    //   invitedBy,
    //   "org.member_invited",
    //   "organization",
    //   orgId,
    //   {
    //     invitationId: invitation.id,
    //     email: emailNormalized,
    //     role: data.role,
    //   },
    //   meta,
    // );

    // await this.safeEmit("organization.invitation.created", {
    //   invitationId: invitation.id,
    //   orgId,
    //   invitedBy,
    //   email: emailNormalized,
    //   token,
    // });

    return { invitation: this.toInvitationDto(invitation), token };
  }

  async validateInvitationToken(token: string): Promise<{
    valid: boolean;
    organizationName?: string;
    invitedBy?: string;
    expiresAt?: Date;
  }> {
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const invitation = await this.deps.repository.findInvitationByTokenHash(
      tokenHash,
    );

    if (!invitation) {
      return { valid: false };
    }

    const org = await this.deps.repository.findById(invitation.orgId);
    if (!org) {
      return { valid: false };
    }

    const response: {
      valid: boolean;
      organizationName?: string;
      invitedBy?: string;
      expiresAt?: Date;
    } = {
      valid: true,
      organizationName: org.name,
      expiresAt: invitation.expiresAt,
    };

    const inviter = invitation.invitedByName ?? invitation.invitedByEmail;
    if (inviter) {
      response.invitedBy = inviter;
    }

    return response;
  }

  async acceptInvitation(
    token: string,
    userId: string,
    userEmail: string,
    meta?: RequestMeta,
  ): Promise<MemberResponseDto> {
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const invitation = await this.deps.repository.findInvitationByTokenHash(
      tokenHash,
    );

    if (!invitation || !invitation.emailHash) {
      throw new NotFoundError("Invitation");
    }

    const emailHash = createHash("sha256")
      .update(userEmail.toLowerCase())
      .digest("hex");
    if (invitation.emailHash !== emailHash) {
      throw new ForbiddenError("Invitation email does not match user email");
    }

    const existing = await this.deps.repository.findMember(
      invitation.orgId,
      userId,
    );
    if (existing?.isActive) {
      throw new ConflictError("User is already a member");
    }

    await this.deps.repository.acceptInvitation(tokenHash, userId);

    const member = await this.deps.repository.addMember({
      orgId: invitation.orgId,
      userId,
      isActive: true,
      invitedBy: invitation.invitedBy,
      invitedAt: invitation.createdAt,
      joinedMethod: "invite",
      lastActiveAt: new Date(),
    });

    // await this.audit(
    //   invitation.orgId,
    //   userId,
    //   "org.member_joined",
    //   "organization",
    //   invitation.orgId,
    //   { invitationId: invitation.id },
    //   meta,
    // );

    // await this.safeEmit("organization.member.added", {
    //   orgId: invitation.orgId,
    //   userId,
    //   role: invitation.role,
    //   method: "invite",
    // });

    return this.toMemberDto(member);
  }

  async declineInvitation(
    invitationId: string,
    userId: string,
    meta?: RequestMeta,
  ): Promise<void> {
    const invitation = await this.deps.repository.findInvitationById(invitationId);
    if (!invitation) {
      throw new NotFoundError("Invitation");
    }

    await this.deps.repository.declineInvitation(invitationId);
    // await this.audit(
    //   invitation.orgId,
    //   userId,
    //   "org.updated",
    //   "organization",
    //   invitation.orgId,
    //   { invitationId: invitation.id, action: "declined" },
    //   meta,
    // );
  }

  async resendInvitation(
    invitationId: string,
    userId: string,
    meta?: RequestMeta,
  ): Promise<void> {
    const invitation = await this.deps.repository.findInvitationById(invitationId);
    if (!invitation) {
      throw new NotFoundError("Invitation");
    }

    await this.requireOrganizationAccess(invitation.orgId, userId, "admin");

    if (invitation.resentCount >= 3) {
      throw new ForbiddenError("Maximum resend limit reached");
    }

    await this.deps.repository.incrementResentCount(invitationId);
    // await this.audit(
    //   invitation.orgId,
    //   userId,
    //   "org.updated",
    //   "organization",
    //   invitation.orgId,
    //   { invitationId: invitation.id, action: "resent" },
    //   meta,
    // );

    // await this.safeEmit("organization.invitation.resent", {
    //   invitationId,
    //   orgId: invitation.orgId,
    //   email: invitation.email,
    // });
  }

  async revokeInvitation(
    invitationId: string,
    revokedBy: string,
    meta?: RequestMeta,
  ): Promise<void> {
    const invitation = await this.deps.repository.findInvitationById(invitationId);
    if (!invitation) {
      throw new NotFoundError("Invitation");
    }

    await this.requireOrganizationAccess(invitation.orgId, revokedBy, "admin");

    await this.deps.repository.revokeInvitation(invitationId, revokedBy);
    // await this.audit(
    //   invitation.orgId,
    //   revokedBy,
    //   "org.updated",
    //   "organization",
    //   invitation.orgId,
    //   { invitationId: invitation.id, action: "revoked" },
    //   meta,
    // );
  }

  async checkSlugAvailability(
    slug: string,
  ): Promise<{ available: boolean; suggestions?: string[] }> {
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

  private async requireOrganizationAccess(
    orgId: string,
    userId: string,
    requiredRole?: OrgRole,
  ): Promise<OrganizationRow> {
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

    // if (requiredRole && !this.hasRequiredRole(membership.role, requiredRole)) {
    //   throw new ForbiddenError(`Requires ${requiredRole} role`);
    // }

    return org;
  }

  private hasRequiredRole(userRole: OrgRole, required: OrgRole): boolean {
    return (ROLE_HIERARCHY[userRole] ?? 0) >= (ROLE_HIERARCHY[required] ?? 0);
  }

  private mapPage<TInput, TOutput>(
    page: PaginatedResponse<TInput>,
    mapper: (row: TInput) => TOutput,
  ): PaginatedResponse<TOutput> {
    return {
      data: page.data.map(mapper),
      pagination: page.pagination,
    };
  }

  private toOrganizationDto(org: OrganizationRow): OrganizationResponseDto {
    return {
      id: org.id,
      name: org.name,
      slug: org.slug,
      description: org.description,
      logoUrl: org.logoUrl,
      websiteUrl: org.websiteUrl,
      ownerUserId: org.ownerUserId,
      status: org.status,
      createdAt: org.createdAt,
      updatedAt: org.updatedAt,
    };
  }

  private toUserOrganizationDto(
    org: UserOrganizationRow,
  ): UserOrganizationResponseDto {
    return {
      id: org.id,
      name: org.name,
      slug: org.slug,
      logoUrl: org.logoUrl,
      role: org.role,
      createdAt: org.createdAt,
    };
  }

  private toBillingDto(org: OrganizationRow): BillingResponseDto {
    return {
      billingEmail: org.billingEmail,
      billingName: org.billingName,
      billingAddress: org.billingAddress,
      planId: org.planId,
      billingStatus: org.billingStatus,
      planStartedAt: org.planStartedAt,
      planExpiresAt: org.planExpiresAt,
    };
  }

  private toPlanDto(org: OrganizationRow): PlanResponseDto {
    return {
      planId: org.planId,
      billingStatus: org.billingStatus,
      trialEndsAt: org.trialEndsAt,
      planExpiresAt: org.planExpiresAt,
    };
  }

  private toSecuritySettingsDto(
    org: OrganizationRow,
  ): SecuritySettingsResponseDto {
    return {
      enforceSso: org.enforceSso,
      enforceMfa: org.enforceMfa,
      allowedEmailDomains: org.allowedEmailDomains,
      ipAllowlist: org.ipAllowlist,
      sessionTimeoutMinutes: org.sessionTimeoutMinutes,
    };
  }

  private toMemberDto(member: OrganizationMemberRow): MemberResponseDto {
    return {
      id: member.id,
      userId: member.userId,
      email: member.email,
      name: member.fullName,
      role: member.role,
      isActive: member.isActive,
      createdAt: member.createdAt,
      lastActiveAt: member.lastActiveAt,
    };
  }

  private toInvitationDto(
    invitation: OrganizationInvitationRow,
  ): InvitationResponseDto {
    return {
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      status: this.invitationStatus(invitation),
      invitedAt: invitation.createdAt,
      expiresAt: invitation.expiresAt,
      invitedBy: {
        id: invitation.invitedBy,
        email: invitation.invitedByEmail,
        name: invitation.invitedByName,
      },
    };
  }

  private invitationStatus(invitation: OrganizationInvitationRow): InvitationStatus {
    if (invitation.acceptedAt) return "accepted";
    if (invitation.declinedAt) return "declined";
    if (invitation.revokedAt) return "revoked";
    return "pending";
  }

  private toAuditLogDto(row: AuditLogRow): AuditLogResponseDto {
    return {
      id: row.id,
      userId: row.userId,
      action: row.action,
      resourceType: row.resourceType,
      resourceId: row.resourceId,
      metadata: row.metadata,
      createdAt: row.createdAt,
    };
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

  private async safeEmit(
    event: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.deps.emitEvent(event, payload);
    } catch (error) {
      this.deps.logger.error(
        { err: error, event, payload },
        "Failed to emit organization event",
      );
    }
  }
}
