import { QuotasService } from "./quotas/quotas.service.js";
import { MembersService } from "./members/members.service.js";
import { InvitationsService } from "./invitations/invitations.service.js";
import { type OrgRole, type RequestMeta, type MemberDto, type InvitationDto, type ScimTokenDto, type SecurityEventDto, type AuditLogDto, type QuotaRequestDto, type OrganizationServiceDependencies, type CursorPaginationQuery } from "./types.js";
import { CoreService } from "./core/core.service.js";
export declare class OrganizationService {
    private repo;
    private log;
    private readonly emitEvent;
    private readonly sso;
    private readonly auditLogs;
    readonly core: CoreService;
    readonly invitations: InvitationsService;
    readonly quotas: QuotasService;
    readonly members: MembersService;
    private scimTokenService;
    private readonly securityEvents;
    constructor(deps: OrganizationServiceDependencies);
    private audit;
    private requireMember;
    private requireMutableOrg;
    createOrganization(meta: RequestMeta, data: {
        name: string;
        description?: string;
        industry?: string;
        companySize?: string;
        country?: string;
        timezone?: string;
        billingEmail?: string;
    }): Promise<import("./types.js").OrganizationDto>;
    switchOrganization(meta: RequestMeta, orgId: string): Promise<import("./types.js").OrganizationDto>;
    getOrganization(orgId: string, userId: string): Promise<import("./types.js").OrganizationDto>;
    getOrganizationBySlug(slug: string, userId: string): Promise<import("./types.js").OrganizationDto>;
    updateOrganization(meta: RequestMeta, orgId: string, data: Record<string, unknown>): Promise<import("./types.js").OrganizationDto>;
    deleteOrganization(meta: RequestMeta, orgId: string): Promise<void>;
    archiveOrganization(meta: RequestMeta, orgId: string): Promise<void>;
    restoreOrganization(meta: RequestMeta, orgId: string): Promise<import("./types.js").OrganizationDto>;
    transferOwnership(meta: RequestMeta, orgId: string, newOwnerUserId: string): Promise<void>;
    getSettings(orgId: string, userId: string): Promise<import("./types.js").OrgSettingsDto>;
    updateSettings(meta: RequestMeta, orgId: string, data: Record<string, unknown>): Promise<import("./types.js").OrgSettingsDto>;
    listMembers(orgId: string, userId: string, q: CursorPaginationQuery, filters?: {
        status?: string;
        role?: string;
    }): Promise<{
        data: MemberDto[];
        meta: {
            hasMore: boolean;
            nextCursor: string | null;
            limit: number;
        };
    }>;
    getMember(orgId: string, actorUserId: string, targetUserId: string): Promise<MemberDto>;
    updateMemberRole(meta: RequestMeta, orgId: string, targetUserId: string, newRole: OrgRole): Promise<void>;
    removeMember(meta: RequestMeta, orgId: string, targetUserId: string): Promise<void>;
    suspendMember(meta: RequestMeta, orgId: string, targetUserId: string): Promise<void>;
    reactivateMember(meta: RequestMeta, orgId: string, targetUserId: string): Promise<void>;
    inviteMember(meta: RequestMeta, orgId: string, email: string, role: OrgRole): Promise<{
        token: string;
        inviteUrl: string;
        accountExists: boolean;
        emailSent: boolean;
        id: string;
        email: string;
        role: OrgRole;
        status: import("./types.js").InvitationStatus;
        expiresAt: Date;
        invitedAt: Date;
        invitedBy: {
            id: string;
            email: string | null;
            name: string | null;
        };
    }>;
    resendInvitation(meta: RequestMeta, orgId: string, invitationId: string): Promise<{
        inviteUrl: string;
        accountExists: boolean;
    }>;
    revokeInvitation(meta: RequestMeta, orgId: string, invitationId: string): Promise<void>;
    acceptInvitation(meta: RequestMeta, token: string): Promise<void>;
    declineInvitation(meta: RequestMeta, invitationId: string): Promise<void>;
    listInvitations(orgId: string, userId: string, q: CursorPaginationQuery, status?: string): Promise<{
        data: InvitationDto[];
        meta: {
            hasMore: boolean;
            nextCursor: string | null;
            limit: number;
        };
    }>;
    createSsoProvider(meta: RequestMeta, orgId: string, data: Record<string, unknown>): Promise<import("./sso/sso.service.js").SsoProviderDto>;
    updateSsoProvider(meta: RequestMeta, orgId: string, ssoId: string, data: Record<string, unknown>): Promise<import("./sso/sso.service.js").SsoProviderDto>;
    deleteSsoProvider(meta: RequestMeta, orgId: string, ssoId: string): Promise<void>;
    createScimToken(meta: RequestMeta, orgId: string, data?: {
        scopes?: string[];
        allowedIps?: string[];
        expiresInDays?: number | undefined;
    }): Promise<{
        rawToken: string;
        id: string;
        lastUsedAt: Date | null;
        expiresAt: Date | null;
        revokedAt: Date | null;
        createdAt: Date;
        scopes: string[];
        allowedIps: string[];
    }>;
    revokeScimToken(meta: RequestMeta, orgId: string, tokenId: string): Promise<void>;
    rotateScimToken(meta: RequestMeta, orgId: string, tokenId: string): Promise<{
        rawToken: string;
        id: string;
        lastUsedAt: Date | null;
        expiresAt: Date | null;
        revokedAt: Date | null;
        createdAt: Date;
        scopes: string[];
        allowedIps: string[];
    }>;
    listSecurityEvents(orgId: string, userId: string, q: CursorPaginationQuery, filters?: {
        severity?: string;
        eventType?: string;
    }): Promise<{
        data: SecurityEventDto[];
        meta: {
            hasMore: boolean;
            nextCursor: string | null;
            limit: number;
        };
    }>;
    listAuditLogs(orgId: string, userId: string, q: CursorPaginationQuery, filters?: {
        action?: string;
        entityType?: string;
        actorUserId?: string;
    }): Promise<{
        data: AuditLogDto[];
        meta: {
            hasMore: boolean;
            nextCursor: string | null;
            limit: number;
        };
    }>;
    createQuotaRequest(meta: RequestMeta, orgId: string, data: {
        quotaType: string;
        currentLimit: number;
        requestedLimit: number;
        reason: string;
    }): Promise<QuotaRequestDto>;
    approveQuotaRequest(meta: RequestMeta, orgId: string, requestId: string, notes?: string): Promise<QuotaRequestDto>;
    rejectQuotaRequest(meta: RequestMeta, orgId: string, requestId: string, notes?: string): Promise<QuotaRequestDto>;
    listQuotaRequests(orgId: string, userId: string, q: CursorPaginationQuery): Promise<{
        data: QuotaRequestDto[];
        meta: {
            hasMore: boolean;
            nextCursor: string | null;
            limit: number;
        };
    }>;
    getBillingSummary(orgId: string, userId: string): Promise<{
        orgId: string;
        subscriptionStatus: string;
        planTier: string;
        eventLimitMonthly: number;
        hardCap: boolean;
        usage: {
            activeMembers: {
                used: number;
                limit: number;
            };
            ssoProviders: {
                used: number;
                limit: number;
                enabled: boolean;
            };
            scimTokens: {
                used: number;
                limit: number;
                enabled: boolean;
            };
        };
    }>;
    getUsageLimits(orgId: string, userId: string): Promise<{
        subscriptionStatus: string;
        planKey: string;
        limits: {
            members: {
                used: number;
                pending: number;
                limit: number | null;
            };
            ssoProviders: {
                used: number;
                limit: number | null;
                enabled: boolean;
            };
            scimTokens: {
                used: number;
                limit: number | null;
                enabled: boolean;
            };
            eventsMonthly: {
                used: null;
                limit: number;
                hardCap: boolean;
            };
        };
    }>;
    listUserOrganizations(userId: string, q: CursorPaginationQuery): Promise<{
        data: import("./types.js").UserOrganizationDto[];
        meta: {
            hasMore: boolean;
            nextCursor: string | null;
            limit: number;
        };
    }>;
    validateInvitationToken(token: string): Promise<{
        id: string;
        valid: boolean;
        email: string;
        role: "security" | "admin" | "member" | "owner" | "developer" | "billing" | "viewer";
        orgName: string | null;
        orgSlug: string | null;
        expiresAt: Date;
        accountExists: boolean;
    }>;
    checkSlugAvailability(slug: string): Promise<{
        slug: string;
        available: boolean;
    }>;
    exportAuditLogs(orgId: string, userId: string, filters?: {
        action?: string;
        entityType?: string;
        actorUserId?: string;
        startDate?: string;
        endDate?: string;
    }): Promise<(AuditLogDto & {
        oldValues: unknown;
        newValues: unknown;
        changedFields: unknown;
    })[]>;
    leaveOrganization(meta: RequestMeta, orgId: string): Promise<void>;
    listSsoProviders(orgId: string, userId: string): Promise<import("./sso/sso.service.js").SsoProviderDto[]>;
    listScimTokens(orgId: string, userId: string): Promise<ScimTokenDto[]>;
    private toScimTokenDto;
}
//# sourceMappingURL=organizationservice.d.ts.map