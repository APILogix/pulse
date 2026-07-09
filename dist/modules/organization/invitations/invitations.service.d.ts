import type { FastifyBaseLogger } from "fastify";
import type { InvitationsRepository } from "./invitations.repository.js";
import type { RequestMeta, OrgRole, OrganizationRow, CursorPaginationQuery } from "../types.js";
import type { OrgInvitationRow, InvitationStatus } from "./invitations.schema.js";
import type { CreateAuditLogRecord } from "../audit-logs/audit-logs.schema.js";
export interface InvitationDto {
    id: string;
    email: string;
    role: OrgRole;
    status: InvitationStatus;
    expiresAt: Date;
    invitedAt: Date;
    invitedBy: {
        id: string;
        email: string | null;
        name: string | null;
    };
}
export declare function toInviteDto(r: OrgInvitationRow): InvitationDto;
export declare function buildInviteUrl(token: string, accountExists: boolean): string;
export interface InvitationsServiceDependencies {
    repository: InvitationsRepository;
    log: FastifyBaseLogger;
    requireMutableOrg: (orgId: string) => Promise<OrganizationRow>;
    requireMember: (orgId: string, userId: string, minRole?: OrgRole) => Promise<any>;
    audit: (meta: RequestMeta, data: Omit<CreateAuditLogRecord, "orgId" | "actorUserId" | "actorEmail" | "actorIp" | "actorUserAgent" | "actorSessionId" | "requestId" | "httpMethod" | "endpoint"> & {
        orgId: string;
    }) => Promise<void>;
    enforceBillingLimit: (orgId: string, capability: "member") => Promise<{
        maxMembers?: number;
    }>;
}
export declare class InvitationsService {
    private readonly deps;
    constructor(deps: InvitationsServiceDependencies);
    private sendInvitationEmail;
    inviteMember(meta: RequestMeta, orgId: string, email: string, role: OrgRole): Promise<{
        token: string;
        inviteUrl: string;
        accountExists: boolean;
        emailSent: boolean;
        id: string;
        email: string;
        role: OrgRole;
        status: InvitationStatus;
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
}
//# sourceMappingURL=invitations.service.d.ts.map