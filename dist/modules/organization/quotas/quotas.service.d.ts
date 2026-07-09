import type { QuotasRepository } from "./quotas.repository.js";
import type { RequestMeta, OrgMemberRow, OrgRole, OrganizationRow, CursorPaginationQuery } from "../types.js";
import type { QuotaRequestStatus, BillingEntitlementsRow, OrganizationUsageCounts } from "./quotas.schema.js";
import type { CreateAuditLogRecord } from "../audit-logs/audit-logs.schema.js";
export interface QuotaRequestDto {
    id: string;
    quotaType: string;
    currentLimit: number;
    requestedLimit: number;
    reason: string;
    status: QuotaRequestStatus;
    reviewedAt: Date | null;
    notes: string | null;
    createdAt: Date;
}
export interface QuotasServiceDependencies {
    repository: QuotasRepository;
    requireMutableOrg: (orgId: string) => Promise<OrganizationRow>;
    requireMember: (orgId: string, userId: string, minRole?: OrgRole) => Promise<OrgMemberRow>;
    audit: (meta: RequestMeta, data: Omit<CreateAuditLogRecord, "orgId" | "actorUserId" | "actorEmail" | "actorIp" | "actorUserAgent" | "actorSessionId" | "requestId" | "httpMethod" | "endpoint"> & {
        orgId: string;
    }) => Promise<void>;
}
export declare class QuotasService {
    private readonly deps;
    constructor(deps: QuotasServiceDependencies);
    limitFrom(entitlements: BillingEntitlementsRow, keys: string[], fallback?: number): number;
    featureAllowed(entitlements: BillingEntitlementsRow, keys: string[], fallback?: boolean): boolean;
    assertWithinLimit(name: string, used: number, limit: number): void;
    requireBillingEntitlements(orgId: string): Promise<{
        entitlements: BillingEntitlementsRow;
        counts: OrganizationUsageCounts;
    }>;
    enforceBillingLimit(orgId: string, capability: "member" | "environment" | "apiKey" | "sso" | "scim"): Promise<{
        entitlements: BillingEntitlementsRow;
        counts: OrganizationUsageCounts;
        maxMembers?: number;
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
}
//# sourceMappingURL=quotas.service.d.ts.map