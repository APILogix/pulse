/**
 * SDK Remote Config types â€” DB rows, DTOs, and Zod validators.
 *
 * Mirrors migrations2/007_organizations_create_sdk_config_schema.up.sql. Snake_case Row types
 * match columns; camelCase DTOs are what the API returns.
 */
import { z } from "zod";
export declare const ConfigTypeSchema: z.ZodEnum<{
    env: "env";
    json: "json";
    yaml: "yaml";
    feature_flag: "feature_flag";
}>;
export type ConfigType = z.infer<typeof ConfigTypeSchema>;
export declare const DeploymentStatusSchema: z.ZodEnum<{
    pending: "pending";
    deploying: "deploying";
    deployed: "deployed";
    failed: "failed";
    rolled_back: "rolled_back";
}>;
export type DeploymentStatus = z.infer<typeof DeploymentStatusSchema>;
export type ChangeType = "create" | "update" | "rollback" | "delete";
export declare const SdkConfigParamsSchema: z.ZodObject<{
    orgId: z.ZodString;
    configId: z.ZodString;
}, z.core.$strip>;
export declare const SdkConfigVersionParamsSchema: z.ZodObject<{
    orgId: z.ZodString;
    configId: z.ZodString;
    version: z.ZodCoercedNumber<unknown>;
}, z.core.$strip>;
export declare const ListSdkConfigsQuerySchema: z.ZodObject<{
    projectId: z.ZodOptional<z.ZodString>;
    environment: z.ZodOptional<z.ZodString>;
    configKey: z.ZodOptional<z.ZodString>;
    includeInactive: z.ZodOptional<z.ZodCoercedBoolean<unknown>>;
}, z.core.$strip>;
export declare const CreateSdkConfigSchema: z.ZodObject<{
    configKey: z.ZodString;
    configValue: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    configType: z.ZodDefault<z.ZodEnum<{
        env: "env";
        json: "json";
        yaml: "yaml";
        feature_flag: "feature_flag";
    }>>;
    projectId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    environment: z.ZodDefault<z.ZodString>;
    schemaVersion: z.ZodOptional<z.ZodString>;
    targetSdkVersions: z.ZodOptional<z.ZodArray<z.ZodString>>;
    targetPlatforms: z.ZodOptional<z.ZodArray<z.ZodString>>;
    rolloutPercentage: z.ZodDefault<z.ZodNumber>;
    isEncrypted: z.ZodDefault<z.ZodBoolean>;
}, z.core.$strip>;
export declare const UpdateSdkConfigSchema: z.ZodObject<{
    configValue: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    environment: z.ZodOptional<z.ZodString>;
    schemaVersion: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    targetSdkVersions: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString>>>;
    targetPlatforms: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString>>>;
    rolloutPercentage: z.ZodOptional<z.ZodNumber>;
    isActive: z.ZodOptional<z.ZodBoolean>;
    changeSummary: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export declare const RollbackSdkConfigSchema: z.ZodObject<{
    toVersion: z.ZodNumber;
    reason: z.ZodString;
}, z.core.$strip>;
export declare const ResolveSdkConfigQuerySchema: z.ZodObject<{
    projectId: z.ZodOptional<z.ZodString>;
    environment: z.ZodDefault<z.ZodString>;
    platform: z.ZodOptional<z.ZodString>;
    sdkVersion: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export interface SdkConfigRow {
    id: string;
    org_id: string;
    project_id: string | null;
    config_key: string;
    config_type: ConfigType;
    version: number;
    version_hash: string;
    is_latest: boolean;
    config_value: Record<string, unknown>;
    schema_version: string | null;
    environment: string;
    target_sdk_versions: string[] | null;
    target_platforms: string[] | null;
    rollout_percentage: number;
    is_active: boolean;
    is_encrypted: boolean;
    created_by: string | null;
    updated_by: string | null;
    created_at: Date;
    updated_at: Date;
}
export interface SdkConfigVersionRow {
    id: string;
    config_id: string;
    version: number;
    version_hash: string;
    config_value: Record<string, unknown>;
    config_value_encrypted: string | null;
    change_type: ChangeType;
    change_summary: string | null;
    change_diff: Record<string, unknown> | null;
    rolled_back_at: Date | null;
    rolled_back_by: string | null;
    rolled_back_to_version: number | null;
    created_by: string | null;
    created_at: Date;
}
export interface SdkConfigDeploymentRow {
    id: string;
    config_id: string;
    version: number;
    status: DeploymentStatus;
    rollout_percentage: number;
    target_count: number | null;
    reached_count: number;
    error_count: number;
    last_error: string | null;
    started_at: Date | null;
    completed_at: Date | null;
    created_at: Date;
    updated_at: Date;
}
export interface SdkConfigDto {
    id: string;
    orgId: string;
    projectId: string | null;
    configKey: string;
    configType: ConfigType;
    version: number;
    versionHash: string;
    isLatest: boolean;
    configValue: Record<string, unknown>;
    schemaVersion: string | null;
    environment: string;
    targetSdkVersions: string[] | null;
    targetPlatforms: string[] | null;
    rolloutPercentage: number;
    isActive: boolean;
    isEncrypted: boolean;
    createdAt: Date;
    updatedAt: Date;
}
export interface SdkConfigVersionDto {
    id: string;
    configId: string;
    version: number;
    versionHash: string;
    configValue: Record<string, unknown>;
    changeType: ChangeType;
    changeSummary: string | null;
    changeDiff: Record<string, unknown> | null;
    rolledBackAt: Date | null;
    rolledBackToVersion: number | null;
    createdBy: string | null;
    createdAt: Date;
}
export interface SdkConfigDeploymentDto {
    id: string;
    configId: string;
    version: number;
    status: DeploymentStatus;
    rolloutPercentage: number;
    targetCount: number | null;
    reachedCount: number;
    errorCount: number;
    lastError: string | null;
    startedAt: Date | null;
    completedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
}
/** Compact shape returned to SDKs on the runtime fetch path. */
export interface SdkConfigResolvedDto {
    configKey: string;
    configValue: Record<string, unknown>;
    version: number;
    versionHash: string;
    schemaVersion: string | null;
    environment: string;
    targetPlatforms: string[] | null;
}
//# sourceMappingURL=sdk-config.types.d.ts.map