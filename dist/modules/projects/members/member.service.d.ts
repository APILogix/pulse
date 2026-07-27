/** Project member service with direct organization-member adds only. */
import type { FastifyBaseLogger } from "fastify";
import type { OrganizationRepository } from "../../organization/repository.js";
import { type AddProjectMemberBody, type ListProjectMembersQuery, type ProjectMember, type UpdateProjectMemberBody } from "../core/project.types.js";
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
    private auditAndActivity;
}
//# sourceMappingURL=member.service.d.ts.map