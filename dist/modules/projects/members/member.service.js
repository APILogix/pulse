import { ProjectMemberRole, } from "../core/project.types.js";
import { SettingsRepository } from "../settings/settings.repository.js";
import { ApiKeyRepository } from "../api-keys/api-key.repository.js";
import { EnvironmentRepository } from "../environments/environment.repository.js";
import { UsageRepository } from "../usage/usage.repository.js";
import { MemberRepository } from "./member.repository.js";
import { ProjectError } from "../shared/utils.js";
import { BaseProjectService } from "../shared/base.service.js";
export class ProjectMemberService extends BaseProjectService {
    membersRepository;
    constructor(deps) {
        super(deps.repository, deps.logger, deps.orgRepo, deps.auditService, deps.settingsRepository, deps.apiKeyRepository, deps.environmentRepository, deps.usageRepository);
        this.membersRepository = deps.membersRepository;
    }
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
        if (!(await this.membersRepository.isOrganizationMember(orgId, body.userId))) {
            throw new ProjectError("MEMBER_NOT_ORG", "User must be an active organization member before joining this project", 403);
        }
        const existing = await this.membersRepository.findProjectMemberByUserId(projectId, body.userId);
        if (existing?.status === "active") {
            throw new ProjectError("MEMBER_EXISTS", "User is already an active member of this project", 409);
        }
        const added = existing?.status === "removed"
            ? await this.membersRepository.restoreProjectMember(existing.id, body.role, userId)
            : await this.membersRepository.addProjectMember(projectId, orgId, body.userId, body.role, userId);
        await this.auditMemberChange(meta, orgId, projectId, "member.added", "member", added.id, { userId: added.userId, role: added.role }, `Member added as ${added.role}`);
        return added;
    }
    async removeMember(orgId, projectId, memberId, userId, meta) {
        await this.requireProjectAccess(orgId, projectId, userId, ProjectMemberRole.ADMIN);
        const member = await this.membersRepository.findProjectMemberById(memberId);
        if (!member || member.projectId !== projectId || member.status !== "active") {
            throw new ProjectError("MEMBER_NOT_FOUND", "Member not found", 404);
        }
        if (member.role === ProjectMemberRole.OWNER) {
            throw new ProjectError("MEMBER_OWNER_REMOVE", "Project owner cannot be removed; transfer ownership first", 403);
        }
        const removed = await this.membersRepository.removeProjectMember(memberId, userId);
        await this.auditMemberChange(meta, orgId, projectId, "member.removed", "member", removed.id, { userId: removed.userId, role: removed.role }, "Member removed");
        return removed;
    }
    async updateMemberRole(orgId, projectId, memberId, userId, body, meta) {
        await this.requireProjectAccess(orgId, projectId, userId, ProjectMemberRole.ADMIN);
        const member = await this.membersRepository.findProjectMemberById(memberId);
        if (!member || member.projectId !== projectId || member.status !== "active") {
            throw new ProjectError("MEMBER_NOT_FOUND", "Member not found", 404);
        }
        if (member.role === ProjectMemberRole.OWNER || body.role === ProjectMemberRole.OWNER) {
            throw new ProjectError("MEMBER_OWNER_ROLE", "Use the transfer ownership endpoint to change the owner", 403);
        }
        const updated = await this.membersRepository.updateProjectMemberRole(memberId, body.role);
        await this.auditMemberChange(meta, orgId, projectId, "member.role_changed", "member", updated.id, { userId: updated.userId, oldRole: member.role, newRole: updated.role }, `Member role changed to ${updated.role}`);
        return updated;
    }
    async transferOwnership(orgId, projectId, userId, newOwnerUserId, meta) {
        await this.requireProjectAccess(orgId, projectId, userId, ProjectMemberRole.OWNER);
        if (userId === newOwnerUserId) {
            throw new ProjectError("MEMBER_INVALID", "You are already the project owner", 400);
        }
        if (!(await this.membersRepository.isOrganizationMember(orgId, newOwnerUserId))) {
            throw new ProjectError("MEMBER_NOT_ORG", "New owner must be an active organization member", 403);
        }
        const result = await this.membersRepository.transferOwnership(projectId, userId, newOwnerUserId, userId);
        await this.auditMemberChange(meta, orgId, projectId, "member.role_changed", "member", result.toMember.id, { previousOwnerId: userId, newOwnerId: newOwnerUserId }, "Project ownership transferred");
        return result;
    }
    async auditMemberChange(meta, orgId, projectId, action, entityType, entityId, newValues, summary) {
        await this.audit(meta, {
            orgId,
            projectId,
            action,
            entityType,
            entityId,
            newValues,
            metadata: { summary },
        });
    }
}
//# sourceMappingURL=member.service.js.map