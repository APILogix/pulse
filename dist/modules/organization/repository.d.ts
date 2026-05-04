import type { Pool } from "pg";
import { type AddMemberRecord, type AuditLogRow, type CreateAuditLogRecord, type CreateInvitationRecord, type CreateOrganizationRecord, type IOrganizationRepository, type InvitationStatus, type OrganizationInvitationRow, type OrganizationMemberRow, type OrganizationRow, type PaginatedResponse, type PaginationQuery, type UpdateOrganizationRecord, type UserOrganizationRow } from "./types.js";
export declare class OrganizationRepository implements IOrganizationRepository {
    private readonly db;
    constructor(db?: Pool);
    create(org: CreateOrganizationRecord): Promise<OrganizationRow>;
    findById(id: string, includeDeleted?: boolean): Promise<OrganizationRow | null>;
    findBySlug(slug: string): Promise<OrganizationRow | null>;
    findByUserId(userId: string, input: PaginationQuery): Promise<PaginatedResponse<UserOrganizationRow>>;
    update(id: string, data: UpdateOrganizationRecord): Promise<OrganizationRow>;
    softDelete(id: string, _deletedBy: string): Promise<void>;
    restore(id: string): Promise<void>;
    addMember(member: AddMemberRecord): Promise<OrganizationMemberRow>;
    removeMember(orgId: string, userId: string, deactivatedBy: string, reason?: string): Promise<void>;
    findMember(orgId: string, userId: string): Promise<OrganizationMemberRow | null>;
    findMembersByOrgId(orgId: string, input: PaginationQuery): Promise<PaginatedResponse<OrganizationMemberRow>>;
    updateMemberRole(orgId: string, userId: string): Promise<void>;
    transferOwnership(orgId: string, fromUserId: string, toUserId: string): Promise<void>;
    createInvitation(invitation: CreateInvitationRecord): Promise<OrganizationInvitationRow>;
    findInvitationById(id: string, includeSecrets?: boolean): Promise<OrganizationInvitationRow | null>;
    findInvitationByTokenHash(tokenHash: string): Promise<OrganizationInvitationRow | null>;
    findInvitationsByOrgId(orgId: string, input: PaginationQuery, status?: InvitationStatus): Promise<PaginatedResponse<OrganizationInvitationRow>>;
    acceptInvitation(tokenHash: string, acceptedBy: string): Promise<void>;
    declineInvitation(id: string): Promise<void>;
    revokeInvitation(id: string, revokedBy: string): Promise<void>;
    incrementResentCount(id: string): Promise<void>;
    createAuditLog(entry: CreateAuditLogRecord): Promise<void>;
    findAuditLogs(orgId: string, input: PaginationQuery): Promise<PaginatedResponse<AuditLogRow>>;
    private invitationStatusWhere;
    private mapOrganization;
    private mapMember;
    private mapInvitation;
    private mapAuditLog;
}
//# sourceMappingURL=repository.d.ts.map