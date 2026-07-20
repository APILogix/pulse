import type { Pool, PoolClient } from "pg";
import { ProjectMemberRole, type CreateProjectRoleBody, type InviteProjectMemberBody, type ListProjectInvitationsQuery, type ListProjectMembersQuery, type ProjectMember, type ProjectMemberInvitation, type ProjectMemberStatus, type ProjectRole, type UpdateProjectRoleBody } from "../core/project.types.js";
import type { OrganizationMembership } from "../types.js";
type DbClient = Pool | PoolClient;
type MemberRow = {
    id: string;
    project_id: string;
    user_id: string;
    organization_id: string;
    role: ProjectMemberRole;
    role_id: string | null;
    status: ProjectMemberStatus;
    added_by_user_id: string | null;
    added_at: Date;
    removed_by_user_id: string | null;
    removed_at: Date | null;
    created_at: Date;
    updated_at: Date;
    email?: string;
    full_name?: string;
};
export declare function hashInvitationToken(token: string): string;
export declare function createInvitationToken(): string;
export declare class MemberRepository {
    private readonly db;
    constructor(db?: Pool);
    withTransaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T>;
    findOrganizationMembership(orgId: string, userId: string, client?: DbClient): Promise<OrganizationMembership | null>;
    isOrganizationMember(orgId: string, userId: string, client?: DbClient): Promise<boolean>;
    findOrganizationMembershipByEmail(orgId: string, email: string, client?: DbClient): Promise<{
        userId: string;
        email: string;
    } | null>;
    findInvitationById(invitationId: string, client?: DbClient): Promise<ProjectMemberInvitation | null>;
    listProjectMembers(projectId: string, query: ListProjectMembersQuery, client?: DbClient): Promise<{
        members: ProjectMember[];
        total: number;
    }>;
    findProjectMemberByUserId(projectId: string, userId: string, client?: DbClient): Promise<ProjectMember | null>;
    findProjectMemberById(memberId: string, client?: DbClient): Promise<ProjectMember | null>;
    addProjectMember(projectId: string, organizationId: string, userId: string, role: ProjectMemberRole, addedByUserId: string, client?: DbClient): Promise<ProjectMember>;
    updateProjectMemberRole(memberId: string, role: ProjectMemberRole, client?: DbClient): Promise<ProjectMember>;
    removeProjectMember(memberId: string, removedByUserId: string, client?: DbClient): Promise<ProjectMember>;
    transferOwnership(projectId: string, fromUserId: string, toUserId: string, actorUserId: string, client?: DbClient): Promise<{
        fromMember: ProjectMember;
        toMember: ProjectMember;
    }>;
    findPendingInvitationByToken(tokenHash: string, client?: DbClient): Promise<ProjectMemberInvitation | null>;
    findPendingInvitationByEmail(projectId: string, email: string, client?: DbClient): Promise<ProjectMemberInvitation | null>;
    createInvitation(projectId: string, organizationId: string, body: InviteProjectMemberBody, invitedByUserId: string, invitedUserId: string | null, expiresAt: Date, client?: DbClient): Promise<{
        invitation: ProjectMemberInvitation;
        token: string;
    }>;
    updateInvitationToken(invitationId: string, expiresAt: Date, client?: DbClient): Promise<{
        invitation: ProjectMemberInvitation;
        token: string;
    }>;
    acceptInvitation(invitationId: string, userId: string, client?: DbClient): Promise<ProjectMemberInvitation>;
    declineInvitation(invitationId: string, client?: DbClient): Promise<ProjectMemberInvitation>;
    cancelInvitation(invitationId: string, client?: DbClient): Promise<ProjectMemberInvitation>;
    expireInvitations(client?: DbClient): Promise<number>;
    listProjectInvitations(projectId: string, query: ListProjectInvitationsQuery, client?: DbClient): Promise<{
        invitations: ProjectMemberInvitation[];
        total: number;
    }>;
    createRole(organizationId: string, projectId: string | null, body: CreateProjectRoleBody, client?: DbClient): Promise<ProjectRole>;
    updateRole(roleId: string, organizationId: string, body: UpdateProjectRoleBody, client?: DbClient): Promise<ProjectRole>;
    deleteRole(roleId: string, organizationId: string, client?: DbClient): Promise<void>;
    listRoles(organizationId: string, projectId: string | null, client?: DbClient): Promise<ProjectRole[]>;
    findRoleBySlug(organizationId: string, projectId: string | null, slug: string, client?: DbClient): Promise<ProjectRole | null>;
    findRoleById(roleId: string, organizationId: string, client?: DbClient): Promise<ProjectRole | null>;
    private findRoleIdForSlug;
    mapMember(row: MemberRow): ProjectMember;
    private mapInvitation;
    private mapRole;
}
export {};
//# sourceMappingURL=member.repository.d.ts.map