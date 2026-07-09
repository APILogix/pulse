import type { ChangeType, SdkConfigRow, SdkConfigVersionRow, SdkConfigDeploymentRow, SdkConfigResolvedDto } from "./sdk-config.types.js";
export interface CreateSdkConfigData {
    orgId: string;
    projectId: string | null;
    configKey: string;
    configType: string;
    configValue: Record<string, unknown>;
    versionHash: string;
    schemaVersion: string | null;
    environment: string;
    targetSdkVersions: string[] | null;
    targetPlatforms: string[] | null;
    rolloutPercentage: number;
    isEncrypted: boolean;
    createdBy: string;
}
export interface UpdateSdkConfigData {
    configValue: Record<string, unknown>;
    versionHash: string;
    newVersion: number;
    schemaVersion?: string | null | undefined;
    environment?: string | undefined;
    targetSdkVersions?: string[] | null | undefined;
    targetPlatforms?: string[] | null | undefined;
    rolloutPercentage?: number | undefined;
    isActive?: boolean | undefined;
    changeType: ChangeType;
    changeSummary: string | null;
    changeDiff: Record<string, unknown> | null;
    rolledBackToVersion?: number | null | undefined;
    updatedBy: string;
}
export declare class SdkConfigRepository {
    private readonly db;
    private withTransaction;
    create(data: CreateSdkConfigData): Promise<SdkConfigRow>;
    findById(orgId: string, configId: string): Promise<SdkConfigRow | null>;
    list(orgId: string, filters: {
        projectId?: string;
        environment?: string;
        configKey?: string;
        includeInactive?: boolean;
    }): Promise<SdkConfigRow[]>;
    update(orgId: string, configId: string, data: UpdateSdkConfigData): Promise<SdkConfigRow>;
    listVersions(configId: string): Promise<SdkConfigVersionRow[]>;
    getVersion(configId: string, version: number): Promise<SdkConfigVersionRow | null>;
    listDeployments(configId: string): Promise<SdkConfigDeploymentRow[]>;
    /** Bump reached_count for a (config,version) deployment; mark deployed when target reached. */
    acknowledgeDeployment(configId: string, version: number): Promise<void>;
    /**
     * Resolve the active config set an SDK should receive for a scope. Matches the
     * org-wide rows plus (optionally) the project's rows, the requested
     * environment or 'all', and platform targeting (NULL target = all platforms).
     * Rollout filtering is applied by the caller (needs a stable per-instance key).
     */
    resolveForSdk(orgId: string, projectId: string | null, environment: string, platform: string | null): Promise<Array<SdkConfigResolvedDto & {
        rollout_percentage: number;
    }>>;
}
//# sourceMappingURL=sdk-config.repository.d.ts.map