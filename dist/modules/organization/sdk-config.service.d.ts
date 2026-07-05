import type { FastifyBaseLogger } from "fastify";
import type { OrganizationRepository } from "./repository.js";
import { SdkConfigRepository } from "./sdk-config.repository.js";
import { type RequestMeta } from "./types.js";
import type { SdkConfigDto, SdkConfigVersionDto, SdkConfigDeploymentDto, SdkConfigResolvedDto, ConfigType } from "./sdk-config.types.js";
export interface CreateConfigInput {
    configKey: string;
    configValue: Record<string, unknown>;
    configType: ConfigType;
    projectId?: string | null;
    environment: string;
    schemaVersion?: string | undefined;
    targetSdkVersions?: string[] | undefined;
    targetPlatforms?: string[] | undefined;
    rolloutPercentage: number;
    isEncrypted: boolean;
}
export interface UpdateConfigInput {
    configValue?: Record<string, unknown>;
    environment?: string;
    schemaVersion?: string | null;
    targetSdkVersions?: string[] | null;
    targetPlatforms?: string[] | null;
    rolloutPercentage?: number;
    isActive?: boolean;
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
    createConfig(meta: RequestMeta, orgId: string, input: CreateConfigInput): Promise<SdkConfigDto>;
    listConfigs(orgId: string, userId: string, filters: {
        projectId?: string;
        environment?: string;
        configKey?: string;
        includeInactive?: boolean;
    }): Promise<SdkConfigDto[]>;
    getConfig(orgId: string, userId: string, configId: string): Promise<SdkConfigDto>;
    updateConfig(meta: RequestMeta, orgId: string, configId: string, input: UpdateConfigInput): Promise<SdkConfigDto>;
    updateProjectConfig(meta: RequestMeta, orgId: string, projectId: string, configId: string, input: UpdateConfigInput): Promise<SdkConfigDto>;
    rollbackConfig(meta: RequestMeta, orgId: string, configId: string, toVersion: number, reason: string): Promise<SdkConfigDto>;
    listVersions(orgId: string, userId: string, configId: string): Promise<SdkConfigVersionDto[]>;
    getVersion(orgId: string, userId: string, configId: string, version: number): Promise<SdkConfigVersionDto>;
    listDeployments(orgId: string, userId: string, configId: string): Promise<SdkConfigDeploymentDto[]>;
    resolveForSdk(orgId: string, userId: string, query: {
        projectId?: string;
        environment: string;
        platform?: string;
    }): Promise<SdkConfigResolvedDto[]>;
    acknowledgeDeployment(orgId: string, userId: string, configId: string, version: number): Promise<void>;
}
//# sourceMappingURL=sdk-config.service.d.ts.map