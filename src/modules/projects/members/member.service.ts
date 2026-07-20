/**
 * Project member, invitation, and custom role business service.
 *
 * Flow:
 * 1. Authorize via project membership (tenant isolation + role gating).
 * 2. Enforce business rules: only org members can be added, owner cannot be
 *    removed, only owner/admins manage members, only owner transfers ownership.
 * 3. Persist mutations and write immutable audit + activity records.
 */
import type { FastifyBaseLogger } from "fastify";
import { pool } from "../../../config/database.js";
import type { OrganizationRepository } from "../../organization/repository.js";
import {
  ProjectMemberRole,
  type AddProjectMemberBody,
  type CreateProjectRoleBody,
  type InviteProjectMemberBody,
  type ListProjectInvitationsQuery,
  type ListProjectMembersQuery,
  type ProjectMember,
  type ProjectMemberInvitation,
  type ProjectRole,
  type UpdateProjectMemberBody,
  type UpdateProjectRoleBody,
} from "../core/project.types.js";
import type { ProjectsRepository } from "../repository.js";
import { SettingsRepository } from "../settings/settings.repository.js";
import { ApiKeyRepository } from "../api-keys/api-key.repository.js";
import { EnvironmentRepository } from "../environments/environment.repository.js";
import { ActivityRepository } from "../activity/activity.repository.js";
import { UsageRepository } from "../usage/usage.repository.js";
import { hashInvitationToken, MemberRepository } from "./member.repository.js";
import { ProjectError } from "../shared/utils.js";
import { BaseProjectService, hasProjectRole } from "../shared/base.service.js";
import type { RequestMeta } from "../service.js";

export interface ProjectMemberServiceDeps {
  repository: ProjectsRepository;
  membersRepository: MemberRepository;
  logger: FastifyBaseLogger;
  orgRepo: OrganizationRepository;
  settingsRepository: SettingsRepository;
  apiKeyRepository: ApiKeyRepository;
  environmentRepository: EnvironmentRepository;
  activityRepository: ActivityRepository;
  usageRepository: UsageRepository;
}

const INVITATION_EXPIRY_DAYS = 7;

export class ProjectMemberService extends BaseProjectService {
  private readonly membersRepository: MemberRepository;

  constructor(deps: ProjectMemberServiceDeps) {
    super(
      deps.repository,
      deps.logger,
      deps.orgRepo,
      deps.settingsRepository,
      deps.apiKeyRepository,
      deps.environmentRepository,
      deps.activityRepository,
      deps.usageRepository,
    );
    this.membersRepository = deps.membersRepository;
  }

  // ── Project members ─────────────────────────────────────────────────────────

  async listMembers(
    orgId: string,
    projectId: string,
    userId: string,
    query: ListProjectMembersQuery,
  ): Promise<{ members: ProjectMember[]; total: number; limit: number; offset: number }> {
    await this.requireProjectAccess(orgId, projectId, userId, ProjectMemberRole.VIEWER);
    const result = await this.membersRepository.listProjectMembers(projectId, query);
    const offset = query.offset ?? ((query.page ?? 1) - 1) * query.limit;
    return { ...result, limit: query.limit, offset };
  }

  async addMember(
    orgId: string,
    projectId: string,
    userId: string,
    body: AddProjectMemberBody,
    meta: RequestMeta,
  ): Promise<ProjectMember> {
    await this.requireProjectAccess(orgId, projectId, userId, ProjectMemberRole.ADMIN);

    if (userId === body.userId) {
      throw new ProjectError("MEMBER_INVALID", "You cannot add yourself as a member", 400);
    }

    const isOrgMember = await this.membersRepository.isOrganizationMember(orgId, body.userId);
    if (!isOrgMember) {
      throw new ProjectError(
        "MEMBER_NOT_ORG",
        "User must be an active member of the organization before joining this project",
        403,
      );
    }

    const existing = await this.membersRepository.findProjectMemberByUserId(projectId, body.userId);
    if (existing && existing.status === "active") {
      throw new ProjectError(
        "MEMBER_EXISTS",
        "User is already an active member of this project",
        409,
      );
    }

    const added = await this.membersRepository.withTransaction(async (client) => {
      if (existing && existing.status === "removed") {
        await client.query(
          `UPDATE project_members
              SET role = $1, status = 'active', removed_by_user_id = NULL,
                  removed_at = NULL, added_by_user_id = $2, added_at = NOW(),
                  updated_at = NOW()
            WHERE id = $3`,
          [body.role, userId, existing.id],
        );
        const restored = await this.membersRepository.findProjectMemberById(existing.id, client);
        if (!restored) {
          throw new ProjectError("INTERNAL_ERROR", "Member restoration failed", 500);
        }
        return restored;
      }
      return this.membersRepository.addProjectMember(
        projectId,
        orgId,
        body.userId,
        body.role,
        userId,
        client,
      );
    });

    await this.auditAndActivity(meta, orgId, projectId, "member.added", "member", added.id, {
      userId: added.userId,
      role: added.role,
    }, `Member added as ${added.role}`);

    return added;
  }

  async removeMember(
    orgId: string,
    projectId: string,
    memberId: string,
    userId: string,
    meta: RequestMeta,
  ): Promise<ProjectMember> {
    await this.requireProjectAccess(orgId, projectId, userId, ProjectMemberRole.ADMIN);

    const member = await this.membersRepository.findProjectMemberById(memberId);
    if (!member || member.projectId !== projectId) {
      throw new ProjectError("MEMBER_NOT_FOUND", "Member not found", 404);
    }
    if (member.userId === userId && member.role === ProjectMemberRole.OWNER) {
      throw new ProjectError(
        "MEMBER_OWNER_REMOVE",
        "Project owner cannot be removed; transfer ownership first",
        403,
      );
    }
    if (member.status !== "active") {
      throw new ProjectError("MEMBER_NOT_FOUND", "Member is not active", 400);
    }

    const removed = await this.membersRepository.removeProjectMember(memberId, userId);
    await this.auditAndActivity(meta, orgId, projectId, "member.removed", "member", removed.id, {
      userId: removed.userId,
      role: removed.role,
    }, "Member removed");
    return removed;
  }

  async updateMemberRole(
    orgId: string,
    projectId: string,
    memberId: string,
    userId: string,
    body: UpdateProjectMemberBody,
    meta: RequestMeta,
  ): Promise<ProjectMember> {
    await this.requireProjectAccess(orgId, projectId, userId, ProjectMemberRole.ADMIN);

    const member = await this.membersRepository.findProjectMemberById(memberId);
    if (!member || member.projectId !== projectId || member.status !== "active") {
      throw new ProjectError("MEMBER_NOT_FOUND", "Member not found", 404);
    }
    if (member.role === ProjectMemberRole.OWNER) {
      throw new ProjectError(
        "MEMBER_OWNER_ROLE",
        "Cannot change the project owner's role; transfer ownership instead",
        403,
      );
    }
    if (body.role === ProjectMemberRole.OWNER) {
      throw new ProjectError(
        "MEMBER_OWNER_ROLE",
        "Use the transfer ownership endpoint to assign the owner role",
        403,
      );
    }

    const updated = await this.membersRepository.updateProjectMemberRole(memberId, body.role);
    await this.auditAndActivity(meta, orgId, projectId, "member.role_changed", "member", updated.id, {
      userId: updated.userId,
      oldRole: member.role,
      newRole: updated.role,
    }, `Member role changed to ${updated.role}`);
    return updated;
  }

  async transferOwnership(
    orgId: string,
    projectId: string,
    userId: string,
    newOwnerUserId: string,
    meta: RequestMeta,
  ): Promise<{ fromMember: ProjectMember; toMember: ProjectMember }> {
    await this.requireProjectAccess(orgId, projectId, userId, ProjectMemberRole.OWNER);

    if (userId === newOwnerUserId) {
      throw new ProjectError(
        "MEMBER_INVALID",
        "You are already the project owner",
        400,
      );
    }

    const isOrgMember = await this.membersRepository.isOrganizationMember(orgId, newOwnerUserId);
    if (!isOrgMember) {
      throw new ProjectError(
        "MEMBER_NOT_ORG",
        "New owner must be an active member of the organization",
        403,
      );
    }

    const result = await this.membersRepository.transferOwnership(
      projectId,
      userId,
      newOwnerUserId,
      userId,
    );
    await this.auditAndActivity(meta, orgId, projectId, "member.role_changed", "member", result.toMember.id, {
      previousOwnerId: userId,
      newOwnerId: newOwnerUserId,
    }, "Project ownership transferred");
    return result;
  }

  // ── Invitations ───────────────────────────────────────────────────────────

  async inviteMember(
    orgId: string,
    projectId: string,
    userId: string,
    body: InviteProjectMemberBody,
    meta: RequestMeta,
  ): Promise<{ invitation: ProjectMemberInvitation; token: string }> {
    await this.requireProjectAccess(orgId, projectId, userId, ProjectMemberRole.ADMIN);

    const email = body.email.toLowerCase();
    const user = await this.membersRepository.findOrganizationMembershipByEmail(orgId, email);
    const invitedUserId = user?.userId ?? null;

    if (invitedUserId) {
      const existingMember = await this.membersRepository.findProjectMemberByUserId(
        projectId,
        invitedUserId,
      );
      if (existingMember && existingMember.status === "active") {
        throw new ProjectError(
          "MEMBER_EXISTS",
          "User is already an active member of this project",
          409,
        );
      }
    }

    const pending = await this.membersRepository.findPendingInvitationByEmail(projectId, email);
    const expiresAt = new Date(Date.now() + INVITATION_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

    let result: { invitation: ProjectMemberInvitation; token: string };
    if (pending) {
      result = await this.membersRepository.updateInvitationToken(pending.id, expiresAt);
    } else {
      result = await this.membersRepository.createInvitation(
        projectId,
        orgId,
        body,
        userId,
        invitedUserId,
        expiresAt,
      );
    }

    await this.auditAndActivity(meta, orgId, projectId, "member.invited", "invitation", result.invitation.id, {
      email: result.invitation.email,
      role: result.invitation.role,
      invitedUserId,
    }, `Invited ${email} as ${result.invitation.role}`);
    return result;
  }

  async acceptInvitation(
    orgId: string,
    userId: string,
    token: string,
    meta: RequestMeta,
  ): Promise<ProjectMember> {
    const tokenHash = hashInvitationToken(token);
    const invitation = await this.membersRepository.findPendingInvitationByToken(tokenHash);
    if (!invitation || invitation.organizationId !== orgId) {
      throw new ProjectError("INVITATION_INVALID", "Invalid or expired invitation", 400);
    }
    if (invitation.expiresAt <= new Date()) {
      throw new ProjectError("INVITATION_EXPIRED", "Invitation has expired", 400);
    }

    const isOrgMember = await this.membersRepository.isOrganizationMember(orgId, userId);
    if (!isOrgMember) {
      throw new ProjectError(
        "MEMBER_NOT_ORG",
        "You must be an active organization member to accept this invitation",
        403,
      );
    }

    const member = await this.membersRepository.withTransaction(async (client) => {
      await this.membersRepository.acceptInvitation(invitation.id, userId, client);
      const existing = await this.membersRepository.findProjectMemberByUserId(
        invitation.projectId,
        userId,
        client,
      );
      if (existing && existing.status === "removed") {
        await client.query(
          `UPDATE project_members
              SET role = $1, status = 'active', removed_by_user_id = NULL,
                  removed_at = NULL, added_by_user_id = $2, added_at = NOW(),
                  updated_at = NOW()
            WHERE id = $3`,
          [invitation.role, invitation.invitedByUserId, existing.id],
        );
        return existing;
      }
      if (existing) {
        throw new ProjectError("MEMBER_EXISTS", "You are already a member of this project", 409);
      }
      return this.membersRepository.addProjectMember(
        invitation.projectId,
        invitation.organizationId,
        userId,
        invitation.role,
        invitation.invitedByUserId,
        client,
      );
    });

    await this.auditAndActivity(meta, orgId, invitation.projectId, "member.added", "member", member.id, {
      userId: member.userId,
      role: member.role,
      invitationId: invitation.id,
    }, `Member joined via invitation as ${member.role}`);
    return member;
  }

  async declineInvitation(
    orgId: string,
    userId: string,
    invitationId: string,
    meta: RequestMeta,
  ): Promise<ProjectMemberInvitation> {
    const invitation = await this.membersRepository.findInvitationById(invitationId);
    if (!invitation || invitation.organizationId !== orgId) {
      throw new ProjectError("INVITATION_NOT_FOUND", "Invitation not found", 404);
    }
    if (invitation.invitedUserId && invitation.invitedUserId !== userId) {
      throw new ProjectError("INVITATION_NOT_FOUND", "Invitation not found", 404);
    }

    const declined = await this.membersRepository.declineInvitation(invitationId);
    await this.auditAndActivity(meta, orgId, invitation.projectId, "member.invitation_declined", "invitation", declined.id, {
      email: declined.email,
    }, "Invitation declined");
    return declined;
  }

  async cancelInvitation(
    orgId: string,
    projectId: string,
    invitationId: string,
    userId: string,
    meta: RequestMeta,
  ): Promise<ProjectMemberInvitation> {
    await this.requireProjectAccess(orgId, projectId, userId, ProjectMemberRole.ADMIN);

    const invitation = await this.membersRepository.findInvitationById(invitationId);
    if (!invitation || invitation.projectId !== projectId) {
      throw new ProjectError("INVITATION_NOT_FOUND", "Invitation not found", 404);
    }

    const cancelled = await this.membersRepository.cancelInvitation(invitationId);
    await this.auditAndActivity(meta, orgId, projectId, "member.invitation_cancelled", "invitation", cancelled.id, {
      email: cancelled.email,
    }, "Invitation cancelled");
    return cancelled;
  }

  async listInvitations(
    orgId: string,
    projectId: string,
    userId: string,
    query: ListProjectInvitationsQuery,
  ): Promise<{ invitations: ProjectMemberInvitation[]; total: number; limit: number; offset: number }> {
    await this.requireProjectAccess(orgId, projectId, userId, ProjectMemberRole.VIEWER);
    const result = await this.membersRepository.listProjectInvitations(projectId, query);
    const offset = query.offset ?? ((query.page ?? 1) - 1) * query.limit;
    return { ...result, limit: query.limit, offset };
  }

  // ── Custom roles ────────────────────────────────────────────────────────────

  async createRole(
    orgId: string,
    projectId: string,
    userId: string,
    body: CreateProjectRoleBody,
    meta: RequestMeta,
  ): Promise<ProjectRole> {
    await this.requireProjectAccess(orgId, projectId, userId, ProjectMemberRole.ADMIN);
    const created = await this.membersRepository.createRole(orgId, projectId, body);
    await this.auditAndActivity(meta, orgId, projectId, "member.role_created", "role", created.id, {
      name: created.name,
      slug: created.slug,
      permissions: created.permissions,
    }, `Custom role "${created.name}" created`);
    return created;
  }

  async updateRole(
    orgId: string,
    projectId: string,
    roleId: string,
    userId: string,
    body: UpdateProjectRoleBody,
    meta: RequestMeta,
  ): Promise<ProjectRole> {
    await this.requireProjectAccess(orgId, projectId, userId, ProjectMemberRole.ADMIN);
    const updated = await this.membersRepository.updateRole(roleId, orgId, body);
    await this.auditAndActivity(meta, orgId, projectId, "member.role_updated", "role", updated.id, {
      name: updated.name,
      permissions: updated.permissions,
    }, `Custom role "${updated.name}" updated`);
    return updated;
  }

  async deleteRole(
    orgId: string,
    projectId: string,
    roleId: string,
    userId: string,
    meta: RequestMeta,
  ): Promise<void> {
    await this.requireProjectAccess(orgId, projectId, userId, ProjectMemberRole.ADMIN);
    await this.membersRepository.deleteRole(roleId, orgId);
    await this.auditAndActivity(meta, orgId, projectId, "member.role_deleted", "role", roleId, {}, "Custom role deleted");
  }

  async listRoles(
    orgId: string,
    projectId: string,
    userId: string,
  ): Promise<ProjectRole[]> {
    await this.requireProjectAccess(orgId, projectId, userId, ProjectMemberRole.VIEWER);
    return this.membersRepository.listRoles(orgId, projectId);
  }

  // ── Internal helpers ───────────────────────────────────────────────────────

  private async auditAndActivity(
    meta: RequestMeta,
    orgId: string,
    projectId: string,
    action: string,
    entityType: string,
    entityId: string,
    newValues: Record<string, unknown>,
    summary: string,
  ): Promise<void> {
    await this.audit(meta, {
      orgId,
      action,
      entityType,
      entityId,
      newValues: { ...newValues, projectId },
    });

    try {
      const client = await pool.connect();
      try {
        await client.query(
          `INSERT INTO project_activity (
             organization_id, project_id, actor_user_id, actor_email, action,
             entity_type, entity_id, summary, metadata
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            orgId,
            projectId,
            meta.actorUserId,
            meta.actorEmail,
            action,
            entityType,
            entityId,
            summary,
            JSON.stringify({ ...newValues, projectId }),
          ],
        );
      } finally {
        client.release();
      }
    } catch (err) {
      this.logger.error({ err, action }, "Failed to write project activity");
    }
  }
}
