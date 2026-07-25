import type { SsoRepository } from "./sso.repository.js";
import type { RequestMeta, OrgMemberRow, OrganizationRow, OrgRole, CursorPaginationQuery } from "../types.js";
import type { BillingEntitlementsRow, OrganizationUsageCounts } from "../repository.js";
export interface SsoProviderDto {
    id: string;
    providerName: string;
    providerType: string;
    entityId: string | null;
    ssoUrl: string | null;
    domain: string | null;
    isActive: boolean;
    createdAt: Date;
}
export interface SsoServiceDependencies {
    repository: SsoRepository;
    requireMutableOrg: (orgId: string) => Promise<OrganizationRow>;
    requireMember: (orgId: string, userId: string, minRole?: OrgRole) => Promise<OrgMemberRow>;
    enforceBillingLimit: (orgId: string, limitKey: "apiKey" | "scim" | "member" | "environment" | "sso") => Promise<{
        entitlements: BillingEntitlementsRow;
        counts: OrganizationUsageCounts;
        maxMembers?: number;
    }>;
    audit: (meta: RequestMeta, payload: any) => Promise<void>;
}
export declare class SsoService {
    private readonly deps;
    constructor(deps: SsoServiceDependencies);
    listSsoProviders(orgId: string, userId: string, q: CursorPaginationQuery): Promise<{
        data: SsoProviderDto[];
        meta: {
            hasMore: boolean;
            nextCursor: string | null;
            limit: number;
            totalCount: number;
        };
    }>;
    createSsoProvider(meta: RequestMeta, orgId: string, data: Record<string, unknown>): Promise<SsoProviderDto>;
    updateSsoProvider(meta: RequestMeta, orgId: string, ssoId: string, data: Record<string, unknown>): Promise<SsoProviderDto>;
    deleteSsoProvider(meta: RequestMeta, orgId: string, ssoId: string): Promise<void>;
}
//# sourceMappingURL=sso.service.d.ts.map