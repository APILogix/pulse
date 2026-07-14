import type { FastifyBaseLogger } from "fastify";
import { ForbiddenError, ValidationError, NotFoundError } from "../shared/errors.js";
import { emailService } from "../../../shared/email/email.service.js";
import { orgInvitationTemplate } from "../../../shared/email/templates.js";
import { env } from "../../../config/env.js";
import { generateToken, hashToken } from "../shared/utils/index.js";
import type { InvitationsRepository } from "./invitations.repository.js";
import type { RequestMeta, OrgRole, OrganizationRow, CursorPaginationQuery } from "../types.js";
import type { OrgInvitationRow, InvitationStatus } from "./invitations.schema.js";
import type { CreateAuditLogRecord } from "../audit-logs/audit-logs.schema.js";

const INVITE_EXPIRY_DAYS = 7;

export interface InvitationDto {
  id: string;
  email: string;
  role: OrgRole;
  status: InvitationStatus;
  expiresAt: Date;
  invitedAt: Date;
  invitedBy: { id: string; email: string | null; name: string | null };
}

export function toInviteDto(r: OrgInvitationRow): InvitationDto {
  return {
    id: r.id,
    email: r.email,
    role: r.role,
    status: r.status,
    expiresAt: r.expires_at,
    invitedAt: r.created_at,
    invitedBy: { id: r.invited_by, email: r.invited_by_email, name: r.invited_by_name },
  };
}

export function buildInviteUrl(token: string, accountExists: boolean): string {
  const base = `${env.FRONTEND_URL}/accept-invite`;
  const url = new URL(base);
  url.searchParams.set("token", token);
  if (!accountExists) {
    url.searchParams.set("signup", "1");
  }
  return url.toString();
}

export interface InvitationsServiceDependencies {
  repository: InvitationsRepository;
  log: FastifyBaseLogger;
  requireMutableOrg: (orgId: string) => Promise<OrganizationRow>;
  requireMember: (orgId: string, userId: string, minRole?: OrgRole) => Promise<any>;
  audit: (meta: RequestMeta, data: Omit<CreateAuditLogRecord, "orgId" | "actorUserId" | "actorEmail" | "actorIp" | "actorUserAgent" | "actorSessionId" | "requestId" | "httpMethod" | "endpoint"> & { orgId: string }) => Promise<void>;
  enforceBillingLimit: (orgId: string, capability: "member") => Promise<{ maxMembers?: number }>;
}

export class InvitationsService {
  constructor(private readonly deps: InvitationsServiceDependencies) {}

  private async sendInvitationEmail(opts: {
    toEmail: string;
    toName?: string | undefined;
    orgName: string;
    inviterName?: string | undefined;
    role: OrgRole;
    inviteUrl: string;
    accountExists: boolean;
  }): Promise<void> {
    const roleLabel = (r: string) => r.charAt(0).toUpperCase() + r.slice(1);
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

  async inviteMember(meta: RequestMeta, orgId: string, email: string, role: OrgRole) {
    const org = await this.deps.requireMutableOrg(orgId);
    await this.deps.requireMember(orgId, meta.actorUserId, "admin");
    await this.deps.enforceBillingLimit(orgId, "member");

    const token = generateToken();
    const tokenHash = hashToken(token);
    const expiresAt = new Date(Date.now() + INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
    const inv = await this.deps.repository.createInvitation(orgId, meta.actorUserId, email, role, tokenHash, expiresAt);

    const existingUser = await this.deps.repository.findUserByEmail(email);
    const accountExists = !!existingUser;
    const inviteUrl = buildInviteUrl(token, accountExists);

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
      this.deps.log.error({ err, orgId, email }, "Invitation email failed to send");
    }

    await this.deps.audit(meta, {
      orgId,
      action: "member.invited",
      entityType: "invitation",
      entityId: inv.id,
      newValues: { email, role, accountExists, emailSent },
      isSensitive: true,
    });
    return { ...toInviteDto(inv), token, inviteUrl, accountExists, emailSent };
  }

  async resendInvitation(meta: RequestMeta, orgId: string, invitationId: string) {
    const org = await this.deps.requireMutableOrg(orgId);
    await this.deps.requireMember(orgId, meta.actorUserId, "admin");

    const inv = await this.deps.repository.findInvitationById(invitationId);
    if (!inv || inv.org_id !== orgId) throw new NotFoundError("Invitation");
    if (inv.status !== "pending") throw new ValidationError("Invitation is not pending");
    if (inv.expires_at < new Date()) {
      throw new ValidationError("Invitation has expired. Create a new one.");
    }

    const token = generateToken();
    const tokenHash = hashToken(token);
    await this.deps.repository.rotateInvitationToken(invitationId, tokenHash);
    await this.deps.repository.incrementResentCount(invitationId);

    const existingUser = await this.deps.repository.findUserByEmail(inv.email);
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

    await this.deps.audit(meta, { orgId, action: "invitation.resent", entityType: "invitation", entityId: invitationId });
    return { inviteUrl, accountExists };
  }

  async revokeInvitation(meta: RequestMeta, orgId: string, invitationId: string) {
    await this.deps.requireMutableOrg(orgId);
    await this.deps.requireMember(orgId, meta.actorUserId, "admin");

    const inv = await this.deps.repository.findInvitationById(invitationId);
    if (!inv || inv.org_id !== orgId) throw new NotFoundError("Invitation");
    await this.deps.repository.revokeInvitation(invitationId, meta.actorUserId);
    await this.deps.audit(meta, { orgId, action: "invitation.revoked", entityType: "invitation", entityId: invitationId });
  }

  async acceptInvitation(meta: RequestMeta, token: string) {
    const tokenHash = hashToken(token);
    const inv = await this.deps.repository.findInvitationByTokenHash(tokenHash);
    if (!inv) throw new NotFoundError("Invitation");

    await this.deps.requireMutableOrg(inv.org_id);

    const invitedEmail = inv.email.trim().toLowerCase();
    const actorEmail = (meta.actorEmail ?? "").trim().toLowerCase();
    if (!actorEmail || actorEmail !== invitedEmail) {
      throw new ForbiddenError("This invitation was issued to a different email address");
    }

    if (inv.expires_at < new Date()) {
      throw new ValidationError("Invitation has expired");
    }

    const limitCheck = await this.deps.enforceBillingLimit(inv.org_id, "member");
    await this.deps.repository.acceptInvitationAndAddMember(tokenHash, meta.actorUserId, limitCheck.maxMembers ?? null);

    await this.deps.audit(meta, { orgId: inv.org_id, action: "invitation.accepted", entityType: "invitation", entityId: inv.id });
  }

  async declineInvitation(meta: RequestMeta, invitationId: string) {
    const inv = await this.deps.repository.findInvitationById(invitationId);
    if (!inv) throw new NotFoundError("Invitation");
    const invitedEmail = inv.email.trim().toLowerCase();
    const actorEmail = (meta.actorEmail ?? "").trim().toLowerCase();
    if (!actorEmail || actorEmail !== invitedEmail) {
      throw new ForbiddenError("This invitation was issued to a different email address");
    }
    await this.deps.repository.declineInvitation(invitationId, meta.actorUserId);
    await this.deps.audit(meta, { orgId: inv.org_id, action: "invitation.declined", entityType: "invitation", entityId: inv.id });
  }

  async listInvitations(orgId: string, userId: string, q: CursorPaginationQuery, status?: string) {
    await this.deps.requireMember(orgId, userId, "admin");
    const result = await this.deps.repository.listInvitations(orgId, q, status);
    return { data: result.data.map(toInviteDto), meta: result.meta };
  }

  async validateInvitationToken(token: string) {
    const tokenHash = hashToken(token);
    const inv = await this.deps.repository.findInvitationByTokenHash(tokenHash);
    if (!inv) throw new NotFoundError("Invitation");
    const existingUser = await this.deps.repository.findUserByEmail(inv.email);
    const org = await this.deps.repository.findOrgNameAndSlug(inv.org_id);
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
}
