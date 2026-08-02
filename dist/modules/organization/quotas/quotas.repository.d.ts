import { BaseRepository } from "../shared/base.repository.js";
import type { CursorPaginationQuery, CursorPaginatedResponse } from "../shared/types.js";
import type { BillingEntitlementsRow, OrganizationUsageCounts, QuotaRequestRow } from "./quotas.schema.js";
export declare class QuotasRepository extends BaseRepository {
    getBillingEntitlements(orgId: string): Promise<BillingEntitlementsRow | null>;
    getOrganizationUsageCounts(orgId: string): Promise<OrganizationUsageCounts>;
    createQuotaRequest(orgId: string, quotaType: string, currentLimit: number, requestedLimit: number, reason: string): Promise<QuotaRequestRow>;
    reviewQuotaRequest(orgId: string, requestId: string, status: string, reviewedBy: string, notes?: string): Promise<QuotaRequestRow>;
    listQuotaRequests(orgId: string, q: CursorPaginationQuery): Promise<CursorPaginatedResponse<QuotaRequestRow>>;
}
//# sourceMappingURL=quotas.repository.d.ts.map