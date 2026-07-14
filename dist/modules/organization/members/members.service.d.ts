import type { MembersRepository } from "./members.repository.js";
import type { RequestMeta, OrgRole, CursorPaginationQuery, OrganizationRow } from "../types.js";
import type { OrgMemberRow } from "./members.schema.js";
import type { CreateAuditLogRecord } from "../audit-logs/audit-logs.schema.js";
export interface MemberDto {
    id: string;
    userId: string;
    email: string;
    fullName: string;
    role: OrgRole;
    status: import("../shared/types.js").MemberStatus;
    joinedAt: Date | null;
    lastActiveAt: Date | null;
    createdAt: Date;
}
export interface MembersServiceDependencies {
    repository: MembersRepository;
    requireMutableOrg: (orgId: string) => Promise<OrganizationRow>;
    audit: (meta: RequestMeta, data: Omit<CreateAuditLogRecord, "orgId" | "actorUserId" | "actorEmail" | "actorIp" | "actorUserAgent" | "actorSessionId" | "requestId" | "httpMethod" | "endpoint"> & {
        orgId: string;
    }) => Promise<void>;
    enforceBillingLimit: (orgId: string, capability: "member") => Promise<{
        maxMembers?: number;
    }>;
}
export declare class MembersService {
    private readonly deps;
    constructor(deps: MembersServiceDependencies);
    hasMinRole(member: OrgMemberRow, required: OrgRole): boolean;
    requireMember(orgId: string, userId: string, minRole?: OrgRole): Promise<OrgMemberRow>;
    addMember(meta: RequestMeta, orgId: string, userId: string, role: OrgRole, method?: string): Promise<OrgMemberRow>;
    removeMember(meta: RequestMeta, orgId: string, targetUserId: string, reason?: string): Promise<void>;
    suspendMember(meta: RequestMeta, orgId: string, targetUserId: string, reason?: string): Promise<void>;
    reactivateMember(meta: RequestMeta, orgId: string, targetUserId: string): Promise<void>;
    updateMemberRole(meta: RequestMeta, orgId: string, targetUserId: string, newRole: OrgRole): Promise<void>;
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
    countOwners(orgId: string): Promise<number>;
    leaveOrganization(meta: RequestMeta, orgId: string): Promise<void>;
}
//# sourceMappingURL=members.service.d.ts.map