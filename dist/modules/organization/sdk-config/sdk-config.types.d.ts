/** Environment-owned SDK configuration heads and immutable revisions. */
import { z } from "zod";
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
    cursor: z.ZodOptional<z.ZodString>;
    limit: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    search: z.ZodOptional<z.ZodString>;
    sortBy: z.ZodOptional<z.ZodString>;
    sortOrder: z.ZodDefault<z.ZodEnum<{
        asc: "asc";
        desc: "desc";
    }>>;
    projectId: z.ZodOptional<z.ZodString>;
    environmentId: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export declare const UpdateSdkConfigSchema: z.ZodObject<{
    configValue: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    schemaVersion: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    changeSummary: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export declare const RollbackSdkConfigSchema: z.ZodObject<{
    toRevision: z.ZodNumber;
    reason: z.ZodString;
}, z.core.$strip>;
export declare const ResolveSdkConfigQuerySchema: z.ZodObject<{
    environmentId: z.ZodString;
}, z.core.$strip>;
export type SdkConfigChangeType = "initial" | "publish" | "rollback";
export interface SdkConfigRow {
    id: string;
    organization_id: string;
    project_id: string;
    environment_id: string;
    environment_name: string;
    environment_slug: string;
    published_revision_id: string;
    current_revision: number;
    current_hash: string;
    schema_version: string | null;
    created_by: string | null;
    updated_by: string | null;
    created_at: Date;
    updated_at: Date;
    version: number;
    config_value: Record<string, unknown>;
    published_at: Date;
}
export interface SdkConfigVersionRow {
    id: string;
    config_id: string;
    organization_id: string;
    project_id: string;
    environment_id: string;
    environment_name: string;
    environment_slug: string;
    revision_number: number;
    config_value: Record<string, unknown>;
    config_hash: string;
    schema_version: string | null;
    change_type: SdkConfigChangeType;
    change_summary: string | null;
    rolled_back_to_revision: number | null;
    published_by: string | null;
    published_at: Date;
}
export interface SdkConfigDto {
    id: string;
    orgId: string;
    projectId: string;
    environmentId: string;
    environmentName: string;
    environmentSlug: string;
    publishedRevisionId: string;
    revision: number;
    revisionHash: string;
    configValue: Record<string, unknown>;
    schemaVersion: string | null;
    publishedAt: Date;
    createdAt: Date;
    updatedAt: Date;
    version: number;
}
export interface SdkConfigVersionDto {
    id: string;
    configId: string;
    orgId: string;
    projectId: string;
    environmentId: string;
    environmentName: string;
    environmentSlug: string;
    revision: number;
    revisionHash: string;
    configValue: Record<string, unknown>;
    schemaVersion: string | null;
    changeType: SdkConfigChangeType;
    changeSummary: string | null;
    rolledBackToRevision: number | null;
    publishedBy: string | null;
    publishedAt: Date;
}
/** Exact published document returned to every SDK in one environment. */
export interface SdkConfigResolvedDto {
    environmentId: string;
    environmentName: string;
    environmentSlug: string;
    revision: number;
    revisionHash: string;
    schemaVersion: string | null;
    configValue: Record<string, unknown>;
    publishedAt: Date;
}
//# sourceMappingURL=sdk-config.types.d.ts.map