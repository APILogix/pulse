import { z } from "zod";
import type { EnvironmentReference } from "../environments/environment.types.js";
/**
 * An API key is only an authentication credential: it answers "which
 * project/environment is sending this telemetry?". Rate limits, permissions,
 * network policy, SDK configuration, and analytics live in their own modules.
 */
export declare const ApiKeyStatusSchema: z.ZodEnum<{
    active: "active";
    suspended: "suspended";
    expired: "expired";
    revoked: "revoked";
    rotated: "rotated";
}>;
export type ApiKeyStatus = z.infer<typeof ApiKeyStatusSchema>;
/** Rotation workflow state is owned by `project_api_key_rotations`. */
export declare const ApiKeyRotationStateSchema: z.ZodEnum<{
    completed: "completed";
    rotating: "rotating";
    grace_period: "grace_period";
}>;
export type ApiKeyRotationState = z.infer<typeof ApiKeyRotationStateSchema>;
export declare const ApiKeyUsageGranularitySchema: z.ZodEnum<{
    monthly: "monthly";
    hourly: "hourly";
    daily: "daily";
}>;
export type ApiKeyUsageGranularity = z.infer<typeof ApiKeyUsageGranularitySchema>;
export declare const ApiKeyParamsSchema: z.ZodObject<{
    orgId: z.ZodString;
    projectId: z.ZodString;
    apiKeyId: z.ZodString;
}, z.core.$strip>;
export declare const ListApiKeysQuerySchema: z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodObject<{
    environmentId: z.ZodOptional<z.ZodString>;
    status: z.ZodOptional<z.ZodEnum<{
        active: "active";
        suspended: "suspended";
        expired: "expired";
        revoked: "revoked";
        rotated: "rotated";
    }>>;
    includeInactive: z.ZodOptional<z.ZodCoercedBoolean<unknown>>;
    page: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    limit: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    offset: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
}, z.core.$strict>>;
export type ListApiKeysQuery = z.infer<typeof ListApiKeysQuerySchema>;
export declare const CreateApiKeyBodySchema: z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodObject<{
    environmentId: z.ZodString;
    name: z.ZodString;
    expiresAt: z.ZodPipe<z.ZodTransform<{} | null | undefined, unknown>, z.ZodOptional<z.ZodNullable<z.ZodDate>>>;
}, z.core.$strict>>;
export type CreateApiKeyBody = z.infer<typeof CreateApiKeyBodySchema>;
export declare const UpdateApiKeyBodySchema: z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodObject<{
    name: z.ZodOptional<z.ZodString>;
    expiresAt: z.ZodPipe<z.ZodTransform<{} | null | undefined, unknown>, z.ZodOptional<z.ZodNullable<z.ZodDate>>>;
}, z.core.$strict>>;
export type UpdateApiKeyBody = z.infer<typeof UpdateApiKeyBodySchema>;
export declare const RotateApiKeyBodySchema: z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodObject<{
    name: z.ZodOptional<z.ZodString>;
    expiresAt: z.ZodPipe<z.ZodTransform<{} | null | undefined, unknown>, z.ZodOptional<z.ZodNullable<z.ZodDate>>>;
    rotationReason: z.ZodOptional<z.ZodString>;
    gracePeriodHours: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
}, z.core.$strict>>;
export type RotateApiKeyBody = z.infer<typeof RotateApiKeyBodySchema>;
export declare const RevokeApiKeyBodySchema: z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodObject<{
    revokedReason: z.ZodOptional<z.ZodString>;
}, z.core.$strict>>;
export type RevokeApiKeyBody = z.infer<typeof RevokeApiKeyBodySchema>;
export declare const BulkRotateBodySchema: z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodObject<{
    environmentId: z.ZodOptional<z.ZodString>;
    rotationReason: z.ZodOptional<z.ZodString>;
    gracePeriodHours: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
}, z.core.$strict>>;
export type BulkRotateBody = z.infer<typeof BulkRotateBodySchema>;
export declare const BulkRevokeBodySchema: z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodObject<{
    environmentId: z.ZodOptional<z.ZodString>;
    apiKeyIds: z.ZodOptional<z.ZodArray<z.ZodString>>;
    revokedReason: z.ZodOptional<z.ZodString>;
}, z.core.$strict>>;
export type BulkRevokeBody = z.infer<typeof BulkRevokeBodySchema>;
export declare const ApiKeyUsageQuerySchema: z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodObject<{
    from: z.ZodCoercedDate<unknown>;
    to: z.ZodCoercedDate<unknown>;
    granularity: z.ZodDefault<z.ZodEnum<{
        monthly: "monthly";
        hourly: "hourly";
        daily: "daily";
    }>>;
}, z.core.$strip>>;
export type ApiKeyUsageQuery = z.infer<typeof ApiKeyUsageQuerySchema>;
/** Canonical minimal credential. */
export interface ProjectApiKey {
    id: string;
    organizationId: string;
    projectId: string;
    environmentId: string;
    name: string;
    publicKey: string;
    status: ApiKeyStatus;
    expiresAt: Date | null;
    lastUsedAt: Date | null;
    createdBy: string | null;
    rotatedFromKeyId: string | null;
    createdAt: Date;
    updatedAt: Date;
    deletedAt: Date | null;
    /** Derived display data; never stored on the credential. */
    environment?: EnvironmentReference | null;
}
export interface ProjectApiKeyRecord extends ProjectApiKey {
    secretHash: string;
}
export interface CreateApiKeyResponse {
    apiKey: ProjectApiKey;
    fullKey: string;
}
export interface ApiKeyRotation {
    id: string;
    organizationId: string;
    projectId: string;
    environmentId: string;
    oldKeyId: string;
    newKeyId: string | null;
    state: ApiKeyRotationState;
    reason: string | null;
    initiatedBy: string | null;
    initiatedAt: Date;
    graceEndsAt: Date | null;
    completedAt: Date | null;
}
/**
 * Authentication context. Rate limits and ingestion policy are resolved from
 * organization/platform configuration, not from the credential row.
 */
export interface ValidatedApiKey {
    id: string;
    projectId: string;
    orgId: string;
    environmentId: string;
    environmentName: string;
    environmentSlug: string;
}
export interface ApiKeyUsageSeriesPoint {
    bucket: string;
    requests: number;
    acceptedEvents: number;
    errorEvents: number;
    ingestionFailures: number;
    acceptedBytes: number;
    rateLimitedRequests: number;
}
export interface ApiKeyUsageSummary {
    requests: number;
    acceptedEvents: number;
    errorEvents: number;
    ingestionFailures: number;
    acceptedBytes: number;
    rateLimitedRequests: number;
    errorRate: number;
}
export interface ApiKeyUsage {
    keyId: string;
    keyPrefix: string;
    lastUsedAt: Date | null;
    granularity: ApiKeyUsageGranularity;
    from: string;
    to: string;
    summary: ApiKeyUsageSummary;
    series: ApiKeyUsageSeriesPoint[];
}
export interface BulkOperationResult {
    total: number;
    succeeded: number;
    failed: number;
    results: Array<{
        apiKeyId: string;
        status: "ok" | "error";
        newKeyId?: string;
        reason?: string;
    }>;
}
export interface ApiKeyUpdateInput {
    name?: string;
    expiresAt?: Date | null;
}
//# sourceMappingURL=api-key.types.d.ts.map