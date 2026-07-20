import { z } from "zod";
import type { EnvironmentReference } from "../environments/environment.types.js";
export declare const ApiKeyStatusSchema: z.ZodEnum<{
    active: "active";
    suspended: "suspended";
    expired: "expired";
    revoked: "revoked";
    rotated: "rotated";
}>;
export type ApiKeyStatus = z.infer<typeof ApiKeyStatusSchema>;
export declare const ApiKeyTypeSchema: z.ZodEnum<{
    read_write: "read_write";
    read_only: "read_only";
    write_only: "write_only";
    temporary: "temporary";
}>;
export type ApiKeyType = z.infer<typeof ApiKeyTypeSchema>;
export declare const ApiKeyPermissionSchema: z.ZodEnum<{
    "ingest:write": "ingest:write";
    "ingest:read": "ingest:read";
    "events:read": "events:read";
    "metrics:read": "metrics:read";
    "config:read": "config:read";
}>;
export type ApiKeyPermission = z.infer<typeof ApiKeyPermissionSchema>;
export declare const ApiKeyRotationStateSchema: z.ZodEnum<{
    none: "none";
    rotating: "rotating";
    grace_period: "grace_period";
    completed: "completed";
}>;
export type ApiKeyRotationState = z.infer<typeof ApiKeyRotationStateSchema>;
export declare const ApiKeyParamsSchema: z.ZodObject<{
    orgId: z.ZodString;
    projectId: z.ZodString;
    apiKeyId: z.ZodString;
}, z.core.$strip>;
export declare const ListApiKeysQuerySchema: z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodObject<{
    environmentId: z.ZodOptional<z.ZodString>;
    keyType: z.ZodOptional<z.ZodEnum<{
        read_write: "read_write";
        read_only: "read_only";
        write_only: "write_only";
        temporary: "temporary";
    }>>;
    status: z.ZodOptional<z.ZodEnum<{
        active: "active";
        suspended: "suspended";
        expired: "expired";
        revoked: "revoked";
        rotated: "rotated";
    }>>;
    isActive: z.ZodOptional<z.ZodCoercedBoolean<unknown>>;
    includeInactive: z.ZodOptional<z.ZodCoercedBoolean<unknown>>;
    page: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    limit: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    offset: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
}, z.core.$strip>>;
export type ListApiKeysQuery = z.infer<typeof ListApiKeysQuerySchema>;
export declare const CreateApiKeyBodySchema: z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodObject<{
    environmentId: z.ZodString;
    name: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    description: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    keyType: z.ZodDefault<z.ZodEnum<{
        read_write: "read_write";
        read_only: "read_only";
        write_only: "write_only";
        temporary: "temporary";
    }>>;
    expiresAt: z.ZodPipe<z.ZodTransform<{} | null | undefined, unknown>, z.ZodOptional<z.ZodNullable<z.ZodDate>>>;
    autoRotateEnabled: z.ZodOptional<z.ZodCoercedBoolean<unknown>>;
    autoRotateDays: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    permissions: z.ZodOptional<z.ZodArray<z.ZodEnum<{
        "ingest:write": "ingest:write";
        "ingest:read": "ingest:read";
        "events:read": "events:read";
        "metrics:read": "metrics:read";
        "config:read": "config:read";
    }>>>;
    allowedEndpoints: z.ZodOptional<z.ZodArray<z.ZodString>>;
    blockedEndpoints: z.ZodOptional<z.ZodArray<z.ZodString>>;
    allowedEventTypes: z.ZodOptional<z.ZodArray<z.ZodString>>;
    allowedOrigins: z.ZodOptional<z.ZodArray<z.ZodString>>;
    allowedIps: z.ZodOptional<z.ZodArray<z.ZodString>>;
    allowedDomains: z.ZodOptional<z.ZodArray<z.ZodString>>;
    samplingRules: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    featureFlags: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    sdkConfig: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    rateLimitPerSecond: z.ZodOptional<z.ZodNullable<z.ZodCoercedNumber<unknown>>>;
    rateLimitPerMinute: z.ZodOptional<z.ZodNullable<z.ZodCoercedNumber<unknown>>>;
    rateLimitPerHour: z.ZodOptional<z.ZodNullable<z.ZodCoercedNumber<unknown>>>;
}, z.core.$strip>>;
export type CreateApiKeyBody = z.infer<typeof CreateApiKeyBodySchema>;
export declare const UpdateApiKeyBodySchema: z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodObject<{
    name: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    description: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    expiresAt: z.ZodPipe<z.ZodTransform<{} | null | undefined, unknown>, z.ZodOptional<z.ZodNullable<z.ZodDate>>>;
    autoRotateEnabled: z.ZodOptional<z.ZodCoercedBoolean<unknown>>;
    autoRotateDays: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    permissions: z.ZodOptional<z.ZodArray<z.ZodEnum<{
        "ingest:write": "ingest:write";
        "ingest:read": "ingest:read";
        "events:read": "events:read";
        "metrics:read": "metrics:read";
        "config:read": "config:read";
    }>>>;
    allowedEndpoints: z.ZodOptional<z.ZodArray<z.ZodString>>;
    blockedEndpoints: z.ZodOptional<z.ZodArray<z.ZodString>>;
    allowedEventTypes: z.ZodOptional<z.ZodArray<z.ZodString>>;
    allowedOrigins: z.ZodOptional<z.ZodArray<z.ZodString>>;
    allowedIps: z.ZodOptional<z.ZodArray<z.ZodString>>;
    allowedDomains: z.ZodOptional<z.ZodArray<z.ZodString>>;
    samplingRules: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    featureFlags: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    sdkConfig: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    rateLimitPerSecond: z.ZodOptional<z.ZodNullable<z.ZodCoercedNumber<unknown>>>;
    rateLimitPerMinute: z.ZodOptional<z.ZodNullable<z.ZodCoercedNumber<unknown>>>;
    rateLimitPerHour: z.ZodOptional<z.ZodNullable<z.ZodCoercedNumber<unknown>>>;
    version: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>>;
export type UpdateApiKeyBody = z.infer<typeof UpdateApiKeyBodySchema>;
export declare const RotateApiKeyBodySchema: z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodObject<{
    name: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    expiresAt: z.ZodPipe<z.ZodTransform<{} | null | undefined, unknown>, z.ZodOptional<z.ZodNullable<z.ZodDate>>>;
    rotationReason: z.ZodOptional<z.ZodString>;
    gracePeriodHours: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
}, z.core.$strip>>;
export type RotateApiKeyBody = z.infer<typeof RotateApiKeyBodySchema>;
export declare const RevokeApiKeyBodySchema: z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodObject<{
    revokedReason: z.ZodOptional<z.ZodString>;
}, z.core.$strip>>;
export type RevokeApiKeyBody = z.infer<typeof RevokeApiKeyBodySchema>;
export declare const BulkRotateBodySchema: z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodObject<{
    environmentId: z.ZodOptional<z.ZodString>;
    rotationReason: z.ZodOptional<z.ZodString>;
    gracePeriodHours: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
}, z.core.$strip>>;
export type BulkRotateBody = z.infer<typeof BulkRotateBodySchema>;
export declare const BulkRevokeBodySchema: z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodObject<{
    environmentId: z.ZodOptional<z.ZodString>;
    apiKeyIds: z.ZodOptional<z.ZodArray<z.ZodString>>;
    revokedReason: z.ZodOptional<z.ZodString>;
}, z.core.$strip>>;
export type BulkRevokeBody = z.infer<typeof BulkRevokeBodySchema>;
export interface ProjectApiKey {
    id: string;
    projectId: string;
    orgId: string | null;
    publicKey: string;
    keyType: ApiKeyType;
    environmentId: string;
    environment: EnvironmentReference | null;
    name: string | null;
    description: string | null;
    isActive: boolean;
    status: ApiKeyStatus;
    rotationState: ApiKeyRotationState;
    rotationVersion: number;
    createdBy: string | null;
    rotatedFromKeyId: string | null;
    rotatedAt: Date | null;
    rotatedBy: string | null;
    rotationReason: string | null;
    gracePeriodEndsAt: Date | null;
    revokedAt: Date | null;
    revokedBy: string | null;
    revokedReason: string | null;
    expiresAt: Date | null;
    autoRotateEnabled: boolean;
    autoRotateDays: number;
    lastUsedAt: Date | null;
    lastUsedIp: string | null;
    usageCount: number;
    errorCount: number;
    rateLimitPerSecond: number | null;
    rateLimitPerMinute: number | null;
    rateLimitPerHour: number | null;
    permissions: string[];
    allowedEndpoints: string[];
    blockedEndpoints: string[];
    allowedEventTypes: string[];
    allowedOrigins: string[];
    allowedIps: string[];
    allowedDomains: string[];
    allowedSdks: string[];
    samplingRules: Record<string, unknown>;
    featureFlags: Record<string, unknown>;
    sdkConfig: Record<string, unknown>;
    metadata: Record<string, unknown>;
    createdAt: Date;
    updatedAt: Date;
    version: number;
}
export interface ProjectApiKeyRecord extends ProjectApiKey {
    secretHash: string;
}
export interface CreateApiKeyResponse {
    apiKey: ProjectApiKey;
    fullKey: string;
}
export interface ValidatedApiKey {
    id: string;
    projectId: string;
    orgId: string;
    environmentId: string;
    environmentName: string;
    keyType: ApiKeyType;
    permissions: string[];
    allowedEndpoints: string[];
    blockedEndpoints: string[];
    allowedEventTypes: string[];
    allowedOrigins: string[];
    allowedIps: string[];
    allowedDomains: string[];
    allowedSdks: string[];
    rateLimitPerSecond: number | null;
    rateLimitPerMinute: number | null;
    rateLimitPerHour: number | null;
    samplingRules: Record<string, unknown>;
    featureFlags: Record<string, unknown>;
    sdkConfig: Record<string, unknown>;
}
export interface ApiKeyUsage {
    keyId: string;
    keyPrefix: string;
    totalRequests: number;
    totalSuccess: number;
    totalErrors: number;
    bytesIngested: number;
    eventsIngested: number;
    lastUsedAt: Date | null;
    requestsByDay: Array<{
        date: string;
        count: number;
    }>;
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
    name?: string | null;
    description?: string | null;
    expiresAt?: Date | null;
    autoRotateEnabled?: boolean;
    autoRotateDays?: number;
    permissions?: string[];
    allowedEndpoints?: string[];
    blockedEndpoints?: string[];
    allowedEventTypes?: string[];
    allowedOrigins?: string[];
    allowedIps?: string[];
    allowedDomains?: string[];
    samplingRules?: Record<string, unknown>;
    featureFlags?: Record<string, unknown>;
    sdkConfig?: Record<string, unknown>;
    rateLimitPerSecond?: number | null;
    rateLimitPerMinute?: number | null;
    rateLimitPerHour?: number | null;
    version?: number;
}
//# sourceMappingURL=api-key.types.d.ts.map