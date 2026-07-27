import type { FastifyBaseLogger } from "fastify";
import type { OrganizationRepository } from "../repository.js";
import { SdkConfigRepository } from "./sdk-config.repository.js";
import { type CursorPaginationQuery, type RequestMeta } from "../types.js";
import type { SdkConfigDto, SdkConfigResolvedDto, SdkConfigVersionDto } from "./sdk-config.types.js";
export interface UpdateConfigInput {
    configValue: Record<string, unknown>;
    schemaVersion?: string | null;
    changeSummary?: string;
}
export declare class SdkConfigService {
    private readonly repo;
    private readonly orgRepo;
    private readonly log;
    constructor(repo: SdkConfigRepository, orgRepo: OrganizationRepository, log: FastifyBaseLogger);
    private requireAdmin;
    private requireMember;
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