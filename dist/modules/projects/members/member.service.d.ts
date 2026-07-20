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
import type { OrganizationRepository } from "../../organization/repository.js";
import { type AddProjectMemberBody, type CreateProjectRoleBody, type InviteProjectMemberBody, type ListProjectInvitationsQuery, type ListProjectMembersQuery, type ProjectMember, type ProjectMemberInvitation, type ProjectRole, type UpdateProjectMemberBody, type UpdateProjectRoleBody } from "../core/project.types.js";
import type { ProjectsRepository } from "../repository.js";
import { SettingsRepository } from "../settings/settings.repository.js";
import { ApiKeyRepository } from "../api-keys/api-key.repository.js";
import { EnvironmentRepository } from "../environments/environment.repository.js";
import { ActivityRepository } from "../activity/activity.repository.js";
import { UsageRepository } from "../usage/usage.repository.js";
import { MemberRepository } from "./member.repository.js";
import { BaseProjectService } from "../shared/base.service.js";
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
export declare class ProjectMemberService extends BaseProjectService {
    private readonly membersRepository;
    constructor(deps: ProjectMemberServiceDeps);
    listMembers(orgId: string, projectId: string, userId: string, query: ListProjectMembersQuery): Promise<{
        members: ProjectMember[];
        total: number;
        limit: number;
        offset: number;
    }>;
    addMember(orgId: string, projectId: string, userId: string, body: AddProjectMemberBody, meta: RequestMeta): Promise<ProjectMember>;
    removeMember(orgId: string, projectId: string, memberId: string, userId: string, meta: RequestMeta): Promise<ProjectMember>;
    updateMemberRole(orgId: string, projectId: string, memberId: string, userId: string, body: UpdateProjectMemberBody, meta: RequestMeta): Promise<ProjectMember>;
    transferOwnership(orgId: string, projectId: string, userId: string, newOwnerUserId: string, meta: RequestMeta): Promise<{
        fromMember: ProjectMember;
        toMember: ProjectMember;
    }>;
    inviteMember(orgId: string, projectId: string, userId: string, body: InviteProjectMemberBody, meta: RequestMeta): Promise<{
        invitation: ProjectMemberInvitation;
        token: string;
    }>;
    acceptInvitation(orgId: string, userId: string, token: string, meta: RequestMeta): Promise<ProjectMember>;
    declineInvitation(orgId: string, userId: string, invitationId: string, meta: RequestMeta): Promise<ProjectMemberInvitation>;
    cancelInvitation(orgId: string, projectId: string, invitationId: string, userId: string, meta: RequestMeta): Promise<ProjectMemberInvitation>;
    listInvitations(orgId: string, projectId: string, userId: string, query: ListProjectInvitationsQuery): Promise<{
        invitations: ProjectMemberInvitation[];
        total: number;
        limit: number;
        offset: number;
    }>;
    createRole(orgId: string, projectId: string, userId: string, body: CreateProjectRoleBody, meta: RequestMeta): Promise<ProjectRole>;
    updateRole(orgId: string, projectId: string, roleId: string, userId: string, body: UpdateProjectRoleBody, meta: RequestMeta): Promise<ProjectRole>;
    deleteRole(orgId: string, projectId: string, roleId: string, userId: string, meta: RequestMeta): Promise<void>;
    listRoles(orgId: string, projectId: string, userId: string): Promise<ProjectRole[]>;
    private auditAndActivity;
}
//# sourceMappingURL=member.service.d.ts.map