/** Direct project-member persistence. Invitations and custom roles are intentionally absent. */
import type { Pool, PoolClient } from "pg";
import { ProjectMemberRole, type ListProjectMembersQuery, type ProjectMember, type ProjectMemberStatus } from "../core/project.types.js";
import type { OrganizationMembership } from "../types.js";
type DbClient = Pool | PoolClient;
type MemberRow = {
    id: string;
    project_id: string;
    user_id: string;
    organization_id: string;
    role: ProjectMemberRole;
    invited_by: string | null;
    invited_at: Date | null;
    joined_at: Date | null;
    status: ProjectMemberStatus;
    created_by: string | null;
    created_at: Date;
    updated_at: Date | null;
    email?: string;
    full_name?: string;
};
export declare class MemberRepository {
    private readonly db;
    constructor(db?: Pool);
    withTransaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T>;
    findOrganizationMembership(orgId: string, userId: string, client?: DbClient): Promise<OrganizationMembership | null>;
    isOrganizationMember(orgId: string, userId: string, client?: DbClient): Promise<boolean>;
    listProjectMembers(projectId: string, query: ListProjectMembersQuery, client?: DbClient): Promise<{
        members: ProjectMember[];
        total: number;
    }>;
    findProjectMemberByUserId(projectId: string, userId: string, client?: DbClient): Promise<ProjectMember | null>;
    findProjectMemberById(memberId: string, client?: DbClient): Promise<ProjectMember | null>;
    addProjectMember(projectId: string, organizationId: string, userId: string, role: ProjectMemberRole, addedByUserId: string, client?: DbClient): Promise<ProjectMember>;
    restoreProjectMember(memberId: string, role: ProjectMemberRole, addedByUserId: string, client?: DbClient): Promise<ProjectMember>;
    ensureProjectOwner(projectId: string, organizationId: string, userId: string, client: DbClient): Promise<ProjectMember>;
    updateProjectMemberRole(memberId: string, role: ProjectMemberRole, client?: DbClient): Promise<ProjectMember>;
    removeProjectMember(memberId: string, _removedByUserId: string, client?: DbClient): Promise<ProjectMember>;
    transferOwnership(projectId: string, fromUserId: string, toUserId: string, actorUserId: string, client?: PoolClient): Promise<{
        fromMember: ProjectMember;
        toMember: ProjectMember;
    }>;
    mapMember(row: MemberRow): ProjectMember;
}
export {};
//# sourceMappingURL=member.repository.d.ts.map