import type { PoolClient } from "pg";
import { BaseRepository } from "../shared/base.repository.js";
import type { CursorPaginationQuery, CursorPaginatedResponse } from "../shared/types.js";
import type { OrganizationRow, OrgSettingsRow, OrganizationProvisioningResult } from "./core.schema.js";
export declare class CoreRepository extends BaseRepository {
    createOrg(client: PoolClient, name: string, ownerUserId: string, data: {
        description?: string | null;
        industry?: string | null;
        companySize?: string | null;
        country?: string | null;
        timezone?: string;
        billingEmail?: string | null;
    }, status?: 'active' | 'trialing'): Promise<OrganizationProvisioningResult>;
    setUserCurrentOrg(userId: string, orgId: string): Promise<void>;
    findOrgById(id: string, includeDeleted?: boolean): Promise<OrganizationRow | null>;
    findOrgBySlug(slug: string): Promise<OrganizationRow | null>;
    updateOrg(id: string, data: Record<string, unknown>): Promise<OrganizationRow>;
    softDeleteOrg(id: string): Promise<void>;
    listOrgApiKeyHashes(orgId: string): Promise<string[]>;
    archiveOrg(id: string): Promise<void>;
    restoreOrg(id: string): Promise<OrganizationRow>;
    transferOwnership(orgId: string, oldOwnerId: string, newOwnerId: string): Promise<void>;
    getSettings(orgId: string): Promise<OrgSettingsRow | null>;
    updateSettings(orgId: string, data: Record<string, unknown>): Promise<OrgSettingsRow>;
    isSlugAvailable(slug: string): Promise<boolean>;
    listUserOrganizations(userId: string, q: CursorPaginationQuery): Promise<CursorPaginatedResponse<any>>;
}
//# sourceMappingURL=core.repository.d.ts.map