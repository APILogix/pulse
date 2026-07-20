import { pool } from "../../../config/database.js";
import { ProjectMemberRole, } from "../core/project.types.js";
import { SettingsRepository } from "../settings/settings.repository.js";
import { ApiKeyRepository } from "../api-keys/api-key.repository.js";
import { EnvironmentRepository } from "../environments/environment.repository.js";
import { ActivityRepository } from "../activity/activity.repository.js";
import { UsageRepository } from "../usage/usage.repository.js";
import { hashInvitationToken, MemberRepository } from "./member.repository.js";
import { ProjectError } from "../shared/utils.js";
import { BaseProjectService, hasProjectRole } from "../shared/base.service.js";
const INVITATION_EXPIRY_DAYS = 7;
export class ProjectMemberService extends BaseProjectService {
    membersRepository;
    constructor(deps) {
        super(deps.repository, deps.logger, deps.orgRepo, deps.settingsRepository, deps.apiKeyRepository, deps.environmentRepository, deps.activityRepository, deps.usageRepository);
        this.membersRepository = deps.membersRepository;
    }
    // ── Project members ─────────────────────────────────────────────────────────
    async listMembers(orgId, projectId, userId, query) {
        await this.requireProjectAccess(orgId, projectId, userId, ProjectMemberRole.VIEWER);
        const result = await this.membersRepository.listProjectMembers(projectId, query);
        const offset = query.offset ?? ((query.page ?? 1) - 1) * query.limit;
        return { ...result, limit: query.limit, offset };
    }
    async addMember(orgId, projectId, userId, body, meta) {
        await this.requireProjectAccess(orgId, projectId, userId, ProjectMemberRole.ADMIN);
        if (userId === body.userId) {
            throw new ProjectError("MEMBER_INVALID", "You cannot add yourself as a member", 400);
        }
        const isOrgMember = await this.membersRepository.isOrganizationMember(orgId, body.userId);
        if (!isOrgMember) {
            throw new ProjectError("MEMBER_NOT_ORG", "User must be an active member of the organization before joining this project", 403);
        }
        const existing = await this.membersRepository.findProjectMemberByUserId(projectId, body.userId);
        if (existing && existing.status === "active") {
            throw new ProjectError("MEMBER_EXISTS", "User is already an active member of this project", 409);
        }
        const added = await this.membersRepository.withTransaction(async (client) => {
            if (existing && existing.status === "removed") {
                await client.query(`UPDATE project_members
              SET role = $1, status = 'active', removed_by_user_id = NULL,
                  removed_at = NULL, added_by_user_id = $2, added_at = NOW(),
                  updated_at = NOW()
            WHERE id = $3`, [body.role, userId, existing.id]);
                const restored = await this.membersRepository.findProjectMemberById(existing.id, client);
                if (!restored) {
                    throw new ProjectError("INTERNAL_ERROR", "Member restoration failed", 500);
                }
                return restored;
            }
            return this.membersRepository.addProjectMember(projectId, orgId, body.userId, body.role, userId, client);
        });
        await this.auditAndActivity(meta, orgId, projectId, "member.added", "member", added.id, {
            userId: added.userId,
            role: added.role,
        }, `Member added as ${added.role}`);
        return added;
    }
    async removeMember(orgId, projectId, memberId, userId, meta) {
        await this.requireProjectAccess(orgId, projectId, userId, ProjectMemberRole.ADMIN);
        const member = await this.membersRepository.findProjectMemberById(memberId);
        if (!member || member.projectId !== projectId) {
            throw new ProjectError("MEMBER_NOT_FOUND", "Member not found", 404);
        }
        if (member.userId === userId && member.role === ProjectMemberRole.OWNER) {
            throw new ProjectError("MEMBER_OWNER_REMOVE", "Project owner cannot be removed; transfer ownership first", 403);
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
    async updateMemberRole(orgId, projectId, memberId, userId, body, meta) {
        await this.requireProjectAccess(orgId, projectId, userId, ProjectMemberRole.ADMIN);
        const member = await this.membersRepository.findProjectMemberById(memberId);
        if (!member || member.projectId !== projectId || member.status !== "active") {
            throw new ProjectError("MEMBER_NOT_FOUND", "Member not found", 404);
        }
        if (member.role === ProjectMemberRole.OWNER) {
            throw new ProjectError("MEMBER_OWNER_ROLE", "Cannot change the project owner's role; transfer ownership instead", 403);
        }
        if (body.role === ProjectMemberRole.OWNER) {
            throw new ProjectError("MEMBER_OWNER_ROLE", "Use the transfer ownership endpoint to assign the owner role", 403);
        }
        const updated = await this.membersRepository.updateProjectMemberRole(memberId, body.role);
        await this.auditAndActivity(meta, orgId, projectId, "member.role_changed", "member", updated.id, {
            userId: updated.userId,
            oldRole: member.role,
            newRole: updated.role,
        }, `Member role changed to ${updated.role}`);
        return updated;
    }
    async transferOwnership(orgId, projectId, userId, newOwnerUserId, meta) {
        await this.requireProjectAccess(orgId, projectId, userId, ProjectMemberRole.OWNER);
        if (userId === newOwnerUserId) {
            throw new ProjectError("MEMBER_INVALID", "You are already the project owner", 400);
        }
        const isOrgMember = await this.membersRepository.isOrganizationMember(orgId, newOwnerUserId);
        if (!isOrgMember) {
            throw new ProjectError("MEMBER_NOT_ORG", "New owner must be an active member of the organization", 403);
        }
        const result = await this.membersRepository.transferOwnership(projectId, userId, newOwnerUserId, userId);
        await this.auditAndActivity(meta, orgId, projectId, "member.role_changed", "member", result.toMember.id, {
            previousOwnerId: userId,
            newOwnerId: newOwnerUserId,
        }, "Project ownership transferred");
        return result;
    }
    // ── Invitations ───────────────────────────────────────────────────────────
    async inviteMember(orgId, projectId, userId, body, meta) {
        await this.requireProjectAccess(orgId, projectId, userId, ProjectMemberRole.ADMIN);
        const email = body.email.toLowerCase();
        const user = await this.membersRepository.findOrganizationMembershipByEmail(orgId, email);
        const invitedUserId = user?.userId ?? null;
        if (invitedUserId) {
            const existingMember = await this.membersRepository.findProjectMemberByUserId(projectId, invitedUserId);
            if (existingMember && existingMember.status === "active") {
                throw new ProjectError("MEMBER_EXISTS", "User is already an active member of this project", 409);
            }
        }
        const pending = await this.membersRepository.findPendingInvitationByEmail(projectId, email);
        const expiresAt = new Date(Date.now() + INVITATION_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
        let result;
        if (pending) {
            result = await this.membersRepository.updateInvitationToken(pending.id, expiresAt);
        }
        else {
            result = await this.membersRepository.createInvitation(projectId, orgId, body, userId, invitedUserId, expiresAt);
        }
        await this.auditAndActivity(meta, orgId, projectId, "member.invited", "invitation", result.invitation.id, {
            email: result.invitation.email,
            role: result.invitation.role,
            invitedUserId,
        }, `Invited ${email} as ${result.invitation.role}`);
        return result;
    }
    async acceptInvitation(orgId, userId, token, meta) {
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
            throw new ProjectError("MEMBER_NOT_ORG", "You must be an active organization member to accept this invitation", 403);
        }
        const member = await this.membersRepository.withTransaction(async (client) => {
            await this.membersRepository.acceptInvitation(invitation.id, userId, client);
            const existing = await this.membersRepository.findProjectMemberByUserId(invitation.projectId, userId, client);
            if (existing && existing.status === "removed") {
                await client.query(`UPDATE project_members
              SET role = $1, status = 'active', removed_by_user_id = NULL,
                  removed_at = NULL, added_by_user_id = $2, added_at = NOW(),
                  updated_at = NOW()
            WHERE id = $3`, [invitation.role, invitation.invitedByUserId, existing.id]);
                return existing;
            }
            if (existing) {
                throw new ProjectError("MEMBER_EXISTS", "You are already a member of this project", 409);
            }
            return this.membersRepository.addProjectMember(invitation.projectId, invitation.organizationId, userId, invitation.role, invitation.invitedByUserId, client);
        });
        await this.auditAndActivity(meta, orgId, invitation.projectId, "member.added", "member", member.id, {
            userId: member.userId,
            role: member.role,
            invitationId: invitation.id,
        }, `Member joined via invitation as ${member.role}`);
        return member;
    }
    async declineInvitation(orgId, userId, invitationId, meta) {
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
    async cancelInvitation(orgId, projectId, invitationId, userId, meta) {
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
    async listInvitations(orgId, projectId, userId, query) {
        await this.requireProjectAccess(orgId, projectId, userId, ProjectMemberRole.VIEWER);
        const result = await this.membersRepository.listProjectInvitations(projectId, query);
        const offset = query.offset ?? ((query.page ?? 1) - 1) * query.limit;
        return { ...result, limit: query.limit, offset };
    }
    // ── Custom roles ────────────────────────────────────────────────────────────
    async createRole(orgId, projectId, userId, body, meta) {
        await this.requireProjectAccess(orgId, projectId, userId, ProjectMemberRole.ADMIN);
        const created = await this.membersRepository.createRole(orgId, projectId, body);
        await this.auditAndActivity(meta, orgId, projectId, "member.role_created", "role", created.id, {
            name: created.name,
            slug: created.slug,
            permissions: created.permissions,
        }, `Custom role "${created.name}" created`);
        return created;
    }
    async updateRole(orgId, projectId, roleId, userId, body, meta) {
        await this.requireProjectAccess(orgId, projectId, userId, ProjectMemberRole.ADMIN);
        const updated = await this.membersRepository.updateRole(roleId, orgId, body);
        await this.auditAndActivity(meta, orgId, projectId, "member.role_updated", "role", updated.id, {
            name: updated.name,
            permissions: updated.permissions,
        }, `Custom role "${updated.name}" updated`);
        return updated;
    }
    async deleteRole(orgId, projectId, roleId, userId, meta) {
        await this.requireProjectAccess(orgId, projectId, userId, ProjectMemberRole.ADMIN);
        await this.membersRepository.deleteRole(roleId, orgId);
        await this.auditAndActivity(meta, orgId, projectId, "member.role_deleted", "role", roleId, {}, "Custom role deleted");
    }
    async listRoles(orgId, projectId, userId) {
        await this.requireProjectAccess(orgId, projectId, userId, ProjectMemberRole.VIEWER);
        return this.membersRepository.listRoles(orgId, projectId);
    }
    // ── Internal helpers ───────────────────────────────────────────────────────
    async auditAndActivity(meta, orgId, projectId, action, entityType, entityId, newValues, summary) {
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
                await client.query(`INSERT INTO project_activity (
             organization_id, project_id, actor_user_id, actor_email, action,
             entity_type, entity_id, summary, metadata
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`, [
                    orgId,
                    projectId,
                    meta.actorUserId,
                    meta.actorEmail,
                    action,
                    entityType,
                    entityId,
                    summary,
                    JSON.stringify({ ...newValues, projectId }),
                ]);
            }
            finally {
                client.release();
            }
        }
        catch (err) {
            this.logger.error({ err, action }, "Failed to write project activity");
        }
    }
}
//# sourceMappingURL=member.service.js.map