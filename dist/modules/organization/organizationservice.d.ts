import { type AddMemberInput, type AuditLogResponseDto, type BillingResponseDto, type CreateInvitationInput, type CreateOrganizationInput, type InvitationResponseDto, type InvitationStatus, type MemberResponseDto, type OrgRole, type OrganizationResponseDto, type OrganizationServiceDependencies, type PaginatedResponse, type PaginationQuery, type PlanResponseDto, type SecuritySettingsResponseDto, type UpdateBillingInput, type UpdateOrganizationInput, type UpdateSecurityInput, type UpgradePlanInput, type UserOrganizationResponseDto } from "./types.js";
interface RequestMeta {
    ipAddress: string | null;
    userAgent: string | null;
}
export declare class OrganizationService {
    private readonly deps;
    constructor(deps: OrganizationServiceDependencies);
    createOrganization(data: CreateOrganizationInput, ownerUserId: string, meta?: RequestMeta): Promise<OrganizationResponseDto>;
    listUserOrganizations(userId: string, pagination: PaginationQuery): Promise<PaginatedResponse<UserOrganizationResponseDto>>;
    getOrganization(orgId: string, userId: string, requiredRole?: OrgRole): Promise<OrganizationResponseDto>;
    updateOrganization(orgId: string, data: UpdateOrganizationInput, userId: string, meta?: RequestMeta): Promise<OrganizationResponseDto>;
    deleteOrganization(orgId: string, userId: string, meta?: RequestMeta): Promise<void>;
    restoreOrganization(orgId: string, userId: string, meta?: RequestMeta): Promise<OrganizationResponseDto>;
    getAuditLogs(orgId: string, userId: string, pagination: PaginationQuery): Promise<PaginatedResponse<AuditLogResponseDto>>;
    getBilling(orgId: string, userId: string): Promise<BillingResponseDto>;
    updateBilling(orgId: string, data: UpdateBillingInput, userId: string, meta?: RequestMeta): Promise<BillingResponseDto>;
    getPlan(orgId: string, userId: string): Promise<PlanResponseDto>;
    upgradePlan(orgId: string, data: UpgradePlanInput, userId: string, meta?: RequestMeta): Promise<PlanResponseDto>;
    getSecuritySettings(orgId: string, userId: string): Promise<SecuritySettingsResponseDto>;
    updateSecuritySettings(orgId: string, data: UpdateSecurityInput, userId: string, meta?: RequestMeta): Promise<SecuritySettingsResponseDto>;
    listMembers(orgId: string, userId: string, pagination: PaginationQuery): Promise<PaginatedResponse<MemberResponseDto>>;
    getMember(orgId: string, targetUserId: string, requestingUserId: string): Promise<MemberResponseDto>;
    addMember(orgId: string, data: AddMemberInput, addedBy: string, meta?: RequestMeta): Promise<MemberResponseDto>;
    removeMember(orgId: string, userId: string, removedBy: string, reason?: string, meta?: RequestMeta): Promise<void>;
    updateMemberRole(orgId: string, userId: string, newRole: OrgRole, updatedBy: string, meta?: RequestMeta): Promise<void>;
    transferOwnership(orgId: string, toUserId: string, fromUserId: string, meta?: RequestMeta): Promise<void>;
    leaveOrganization(orgId: string, userId: string, meta?: RequestMeta): Promise<void>;
    listInvitations(orgId: string, userId: string, pagination: PaginationQuery, status?: InvitationStatus): Promise<PaginatedResponse<InvitationResponseDto>>;
    inviteMember(orgId: string, data: CreateInvitationInput, invitedBy: string, meta?: RequestMeta): Promise<{
        invitation: InvitationResponseDto;
        token: string;
    }>;
    validateInvitationToken(token: string): Promise<{
        valid: boolean;
        organizationName?: string;
        invitedBy?: string;
        expiresAt?: Date;
    }>;
    acceptInvitation(token: string, userId: string, userEmail: string, meta?: RequestMeta): Promise<MemberResponseDto>;
    declineInvitation(invitationId: string, userId: string, meta?: RequestMeta): Promise<void>;
    resendInvitation(invitationId: string, userId: string, meta?: RequestMeta): Promise<void>;
    revokeInvitation(invitationId: string, revokedBy: string, meta?: RequestMeta): Promise<void>;
    checkSlugAvailability(slug: string): Promise<{
        available: boolean;
        suggestions?: string[];
    }>;
    private requireOrganizationAccess;
    private hasRequiredRole;
    private mapPage;
    private toOrganizationDto;
    private toUserOrganizationDto;
    private toBillingDto;
    private toPlanDto;
    private toSecuritySettingsDto;
    private toMemberDto;
    private toInvitationDto;
    private invitationStatus;
    private toAuditLogDto;
    private audit;
    private safeEmit;
}
export {};
//# sourceMappingURL=organizationservice.d.ts.map