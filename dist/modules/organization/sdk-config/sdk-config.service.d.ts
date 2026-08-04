import type { OrganizationAuditService } from "../audit-logs/audit-logs.service.js";
import type { OrganizationRepository } from "../repository.js";
import type { RemoteSdkConfigService } from "../../projects/sdk-config/sdk-config.service.js";
import { SdkConfigRepository } from "./sdk-config.repository.js";
import { type CursorPaginationQuery, type RequestMeta } from "../types.js";
import type { SdkConfigDto, SdkConfigResolvedDto, SdkConfigVersionDto } from "./sdk-config.types.js";
export interface UpdateConfigInput {
    editableConfig: Record<string, unknown>;
    changeSummary?: string;
}
/** Admin facade. Compilation, validation, hashing, and revision writes are delegated to the canonical service. */
export declare class SdkConfigService {
    private readonly repo;
    private readonly orgRepo;
    private readonly auditService;
    private readonly canonical;
    constructor(repo: SdkConfigRepository, orgRepo: OrganizationRepository, auditService: OrganizationAuditService, canonical: RemoteSdkConfigService);
    private requireAdmin;
    private requireMember;
    private scope;
    private audit;
    listConfigs(orgId: string, userId: string, filters: {
        projectId?: string;
        environmentId?: string;
    }, query: CursorPaginationQuery): Promise<{
        data: SdkConfigDto[];
        meta: {
            hasMore: boolean;
            nextCursor: string | null;
            limit: number;
            totalCount: number;
        };
    }>;
    getConfig(orgId: string, userId: string, configId: string): Promise<SdkConfigDto>;
    updateConfig(meta: RequestMeta, orgId: string, configId: string, input: UpdateConfigInput): Promise<SdkConfigDto>;
    updateProjectConfig(meta: RequestMeta, orgId: string, projectId: string, configId: string, input: UpdateConfigInput): Promise<SdkConfigDto>;
    private publish;
    rollbackConfig(meta: RequestMeta, orgId: string, configId: string, toRevision: number, reason: string): Promise<SdkConfigDto>;
    listVersions(orgId: string, userId: string, configId: string): Promise<SdkConfigVersionDto[]>;
    getVersion(orgId: string, userId: string, configId: string, revision: number): Promise<SdkConfigVersionDto>;
    resolveForSdk(orgId: string, userId: string, query: {
        environmentId: string;
    }): Promise<SdkConfigResolvedDto>;
}
//# sourceMappingURL=sdk-config.service.d.ts.map