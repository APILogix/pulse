/** Project member service with direct organization-member adds only. */
import type { FastifyBaseLogger } from "fastify";
import type { OrganizationRepository } from "../../organization/repository.js";
import type { OrganizationAuditService } from "../../organization/audit-logs/audit-logs.service.js";
import {
  ProjectMemberRole,
  type AddProjectMemberBody,
  type ListProjectMembersQuery,
  type ProjectMember,
  type UpdateProjectMemberBody,
} from "../core/project.types.js";
import type { ProjectsRepository } from "../repository.js";
import { SettingsRepository } from "../settings/settings.repository.js";
import { ApiKeyRepository } from "../api-keys/api-key.repository.js";
import { EnvironmentRepository } from "../environments/environment.repository.js";
import { UsageRepository } from "../usage/usage.repository.js";
import { MemberRepository } from "./member.repository.js";
import { ProjectError } from "../shared/utils.js";
import { BaseProjectService } from "../shared/base.service.js";
import type { RequestMeta } from "../service.js";

export interface ProjectMemberServiceDeps {
  repository: ProjectsRepository;
  membersRepository: MemberRepository;
  logger: FastifyBaseLogger;
  orgRepo: OrganizationRepository;
  auditService: OrganizationAuditService;
  settingsRepository: SettingsRepository;
  apiKeyRepository: ApiKeyRepository;
  environmentRepository: EnvironmentRepository;
  usageRepository: UsageRepository;
}

export class ProjectMemberService extends BaseProjectService {
  private readonly membersRepository: MemberRepository;

  constructor(deps: ProjectMemberServiceDeps) {
    super(
      deps.repository,
      deps.logger,
      deps.orgRepo,
      deps.auditService,
      deps.settingsRepository,
      deps.apiKeyRepository,
      deps.environmentRepository,
      deps.usageRepository,
    );
    this.membersRepository = deps.membersRepository;
  }

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
    if (body.role === ProjectMemberRole.OWNER) {
      throw new ProjectError(
        "MEMBER_OWNER_ROLE",
        "Use the transfer ownership endpoint to change the owner",
        403,
      );
    }
    if (!(await this.membersRepository.isOrganizationMember(orgId, body.userId))) {
      throw new ProjectError(
        "MEMBER_NOT_ORG",
        "User must be an active organization member before joining this project",
        403,
      );
    }

    const existing = await this.membersRepository.findProjectMemberByUserId(projectId, body.userId);
    if (existing?.status === "active") {
      throw new ProjectError("MEMBER_EXISTS", "User is already an active member of this project", 409);
    }

    const added = existing?.status === "removed"
      ? await this.membersRepository.restoreProjectMember(existing.id, body.role, userId)
      : await this.membersRepository.addProjectMember(projectId, orgId, body.userId, body.role, userId);

    await this.auditMemberChange(
      meta, orgId, projectId, "member.added", "member", added.id,
      { userId: added.userId, role: added.role },
      `Member added as ${added.role}`,
    );
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
    if (!member || member.projectId !== projectId || member.status !== "active") {
      throw new ProjectError("MEMBER_NOT_FOUND", "Member not found", 404);
    }
    if (member.role === ProjectMemberRole.OWNER) {
      throw new ProjectError(
        "MEMBER_OWNER_REMOVE",
        "Project owner cannot be removed; transfer ownership first",
        403,
      );
    }
    const removed = await this.membersRepository.removeProjectMember(memberId, userId);
    await this.auditMemberChange(
      meta, orgId, projectId, "member.removed", "member", removed.id,
      { userId: removed.userId, role: removed.role }, "Member removed",
    );
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
    if (member.role === ProjectMemberRole.OWNER || body.role === ProjectMemberRole.OWNER) {
      throw new ProjectError(
        "MEMBER_OWNER_ROLE",
        "Use the transfer ownership endpoint to change the owner",
        403,
      );
    }
    const updated = await this.membersRepository.updateProjectMemberRole(memberId, body.role);
    await this.auditMemberChange(
      meta, orgId, projectId, "member.role_changed", "member", updated.id,
      { userId: updated.userId, oldRole: member.role, newRole: updated.role },
      `Member role changed to ${updated.role}`,
    );
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
      throw new ProjectError("MEMBER_INVALID", "You are already the project owner", 400);
    }
    if (!(await this.membersRepository.isOrganizationMember(orgId, newOwnerUserId))) {
      throw new ProjectError("MEMBER_NOT_ORG", "New owner must be an active organization member", 403);
    }
    const result = await this.membersRepository.transferOwnership(
      projectId, userId, newOwnerUserId, userId,
    );
    await this.auditMemberChange(
      meta, orgId, projectId, "member.role_changed", "member", result.toMember.id,
      { previousOwnerId: userId, newOwnerId: newOwnerUserId },
      "Project ownership transferred",
    );
    return result;
  }
  private async auditMemberChange(
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
      projectId,
      action,
      entityType,
      entityId,
      newValues,
      metadata: { summary },
    });
  }
}
