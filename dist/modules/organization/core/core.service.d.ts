import type { FastifyBaseLogger } from "fastify";
import type { RequestMeta, CursorPaginationQuery, OrgRole } from "../shared/types.js";
import type { CoreRepository } from "./core.repository.js";
import { BillingProvisioningService } from "../../billing/provisioning/service.js";
import type { OrganizationRow, OrgSettingsRow, OrganizationDto, OrgSettingsDto, UserOrganizationDto } from "./core.schema.js";
export declare function toOrgDto(row: OrganizationRow): OrganizationDto;
export declare function toSettingsDto(row: OrgSettingsRow): OrgSettingsDto;
export declare function isMutableOrg(status: string): boolean;
export interface CoreServiceDeps {
    repository: CoreRepository;
    log: FastifyBaseLogger;
    requireMember: (orgId: string, userId: string, minRole?: OrgRole) => Promise<any>;
    audit: (meta: RequestMeta, data: any) => Promise<void>;
    listOrgApiKeyHashes?: (orgId: string) => Promise<string[]>;
    deleteApiKeyCache?: (hash: string) => void;
    billingProvisioning: BillingProvisioningService;
}
export declare class CoreService {
    private deps;
    constructor(deps: CoreServiceDeps);
    requireMutableOrg(orgId: string): Promise<OrganizationRow>;
    createOrganization(meta: RequestMeta, data: {
        name: string;
        description?: string;
        industry?: string;
        companySize?: string;
        country?: string;
        timezone?: string;
        billingEmail?: string;
    }): Promise<OrganizationDto>;
    switchOrganization(meta: RequestMeta, orgId: string): Promise<OrganizationDto>;
    getOrganization(orgId: string, userId: string): Promise<OrganizationDto>;
    getOrganizationBySlug(slug: string, userId: string): Promise<OrganizationDto>;
    updateOrganization(meta: RequestMeta, orgId: string, data: Record<string, unknown>): Promise<OrganizationDto>;
    deleteOrganization(meta: RequestMeta, orgId: string): Promise<void>;
    archiveOrganization(meta: RequestMeta, orgId: string): Promise<void>;
    restoreOrganization(meta: RequestMeta, orgId: string): Promise<OrganizationDto>;
    transferOwnership(meta: RequestMeta, orgId: string, newOwnerUserId: string): Promise<void>;
    getSettings(orgId: string, userId: string): Promise<OrgSettingsDto>;
    updateSettings(meta: RequestMeta, orgId: string, data: Record<string, unknown>): Promise<OrgSettingsDto>;
    checkSlugAvailability(slug: string): Promise<{
        slug: string;
        available: boolean;
    }>;
    listUserOrganizations(userId: string, q: CursorPaginationQuery): Promise<{
        data: UserOrganizationDto[];
        meta: {
            hasMore: boolean;
            nextCursor: string | null;
            limit: number;
        };
    }>;
}
//# sourceMappingURL=core.service.d.ts.map