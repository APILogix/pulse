/**
 * Project module types and request schemas.
 *
 * Flow:
 * - Zod schemas validate every inbound param/query/body before the service
 *   layer runs. snake_case aliases are normalized to camelCase up front so
 *   clients may send either casing.
 * - Domain interfaces are the stable camelCase shapes the service/routes use;
 *   the repository maps snake_case DB rows into these.
 *
 * Scope: projects + API keys + environments only. NO ingestion routes, NO
 * Redis. API-key resolution for ingestion is served from the in-process LRU
 * cache (config/lrucashe.ts).
 */
import { z } from "zod";
export declare const ProjectStatusSchema: z.ZodEnum<{
    active: "active";
    archived: "archived";
    paused: "paused";
}>;
export declare const ProjectEnvironmentSchema: z.ZodEnum<{
    development: "development";
    staging: "staging";
    production: "production";
}>;
export declare const ApiKeyStatusSchema: z.ZodEnum<{
    active: "active";
    suspended: "suspended";
    expired: "expired";
    revoked: "revoked";
    rotated: "rotated";
}>;
export declare const ApiKeyTypeSchema: z.ZodEnum<{
    admin: "admin";
    standard: "standard";
    read_only: "read_only";
    ingestion_only: "ingestion_only";
}>;
export declare const OrgRoleSchema: z.ZodEnum<{
    security: "security";
    admin: "admin";
    member: "member";
    owner: "owner";
    developer: "developer";
    billing: "billing";
    viewer: "viewer";
}>;
export declare const ApiKeyPermissionSchema: z.ZodEnum<{
    "ingest:write": "ingest:write";
    "ingest:read": "ingest:read";
    "events:read": "events:read";
    "metrics:read": "metrics:read";
    "config:read": "config:read";
}>;
export declare const OrgIdParamsSchema: z.ZodObject<{
    orgId: z.ZodString;
}, z.core.$strip>;
export declare const ProjectParamsSchema: z.ZodObject<{
    orgId: z.ZodString;
    projectId: z.ZodString;
}, z.core.$strip>;
export declare const ProjectSdkConfigParamsSchema: z.ZodObject<{
    orgId: z.ZodString;
    projectId: z.ZodString;
    configId: z.ZodString;
}, z.core.$strip>;
export declare const ApiKeyParamsSchema: z.ZodObject<{
    orgId: z.ZodString;
    projectId: z.ZodString;
    apiKeyId: z.ZodString;
}, z.core.$strip>;
export declare const EnvironmentParamsSchema: z.ZodObject<{
    orgId: z.ZodString;
    projectId: z.ZodString;
    environment: z.ZodEnum<{
        development: "development";
        staging: "staging";
        production: "production";
    }>;
}, z.core.$strip>;
export declare const ListProjectsQuerySchema: z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodObject<{
    status: z.ZodOptional<z.ZodEnum<{
        active: "active";
        archived: "archived";
        paused: "paused";
    }>>;
    environment: z.ZodOptional<z.ZodEnum<{
        development: "development";
        staging: "staging";
        production: "production";
    }>>;
    search: z.ZodOptional<z.ZodString>;
    includeDeleted: z.ZodOptional<z.ZodCoercedBoolean<unknown>>;
    page: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    limit: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    offset: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    sortBy: z.ZodDefault<z.ZodEnum<{
        name: "name";
        updated_at: "updated_at";
        created_at: "created_at";
    }>>;
    sortOrder: z.ZodDefault<z.ZodEnum<{
        asc: "asc";
        desc: "desc";
    }>>;
}, z.core.$strip>>;
export declare const ListApiKeysQuerySchema: z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodObject<{
    environment: z.ZodOptional<z.ZodEnum<{
        development: "development";
        staging: "staging";
        production: "production";
    }>>;
    keyType: z.ZodOptional<z.ZodEnum<{
        admin: "admin";
        standard: "standard";
        read_only: "read_only";
        ingestion_only: "ingestion_only";
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
export declare const ListProjectActivityQuerySchema: z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodObject<{
    cursor: z.ZodOptional<z.ZodString>;
    limit: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    action: z.ZodOptional<z.ZodString>;
}, z.core.$strip>>;
export declare const CreateProjectBodySchema: z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodObject<{
    rateLimitPerSecond: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    rateLimitPerMinute: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    rateLimitPerHour: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    burstLimit: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    allowedEventTypes: z.ZodOptional<z.ZodArray<z.ZodString>>;
    maxEventSizeBytes: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    maxBatchSize: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    allowedOrigins: z.ZodOptional<z.ZodArray<z.ZodString>>;
    requireHttps: z.ZodOptional<z.ZodCoercedBoolean<unknown>>;
    ipAllowlist: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString>>>;
    ipBlocklist: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString>>>;
    geoRestrictionEnabled: z.ZodOptional<z.ZodCoercedBoolean<unknown>>;
    allowedCountries: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodPipe<z.ZodString, z.ZodTransform<string, string>>>>>;
    alertEmail: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    alertWebhookUrl: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    alertOnErrorRateThreshold: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    alertOnLatencyThresholdMs: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    settings: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    name: z.ZodString;
    description: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    environment: z.ZodDefault<z.ZodEnum<{
        development: "development";
        staging: "staging";
        production: "production";
    }>>;
    productionApiPrefix: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    developmentApiPrefix: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    stagingApiPrefix: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, z.core.$strip>>;
export declare const UpdateProjectBodySchema: z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodObject<{
    rateLimitPerSecond: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    rateLimitPerMinute: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    rateLimitPerHour: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    burstLimit: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    allowedEventTypes: z.ZodOptional<z.ZodArray<z.ZodString>>;
    maxEventSizeBytes: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    maxBatchSize: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    allowedOrigins: z.ZodOptional<z.ZodArray<z.ZodString>>;
    requireHttps: z.ZodOptional<z.ZodCoercedBoolean<unknown>>;
    ipAllowlist: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString>>>;
    ipBlocklist: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString>>>;
    geoRestrictionEnabled: z.ZodOptional<z.ZodCoercedBoolean<unknown>>;
    allowedCountries: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodPipe<z.ZodString, z.ZodTransform<string, string>>>>>;
    alertEmail: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    alertWebhookUrl: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    alertOnErrorRateThreshold: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    alertOnLatencyThresholdMs: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    settings: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    name: z.ZodOptional<z.ZodString>;
    description: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    status: z.ZodOptional<z.ZodEnum<{
        active: "active";
        archived: "archived";
        paused: "paused";
    }>>;
    environment: z.ZodOptional<z.ZodEnum<{
        development: "development";
        staging: "staging";
        production: "production";
    }>>;
    productionApiPrefix: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    developmentApiPrefix: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    stagingApiPrefix: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, z.core.$strip>>;
export declare const CreateEnvironmentBodySchema: z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodObject<{
    isActive: z.ZodOptional<z.ZodCoercedBoolean<unknown>>;
    rateLimitPerSecond: z.ZodOptional<z.ZodNullable<z.ZodCoercedNumber<unknown>>>;
    rateLimitPerMinute: z.ZodOptional<z.ZodNullable<z.ZodCoercedNumber<unknown>>>;
    rateLimitPerHour: z.ZodOptional<z.ZodNullable<z.ZodCoercedNumber<unknown>>>;
    burstLimit: z.ZodOptional<z.ZodNullable<z.ZodCoercedNumber<unknown>>>;
    allowedEventTypes: z.ZodOptional<z.ZodArray<z.ZodString>>;
    maxEventSizeBytes: z.ZodOptional<z.ZodNullable<z.ZodCoercedNumber<unknown>>>;
    maxBatchSize: z.ZodOptional<z.ZodNullable<z.ZodCoercedNumber<unknown>>>;
    requireHttps: z.ZodOptional<z.ZodCoercedBoolean<unknown>>;
    ipAllowlist: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString>>>;
    ipBlocklist: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString>>>;
    alertEmail: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    alertWebhookUrl: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    environment: z.ZodEnum<{
        development: "development";
        staging: "staging";
        production: "production";
    }>;
}, z.core.$strip>>;
export declare const UpdateEnvironmentBodySchema: z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodObject<{
    isActive: z.ZodOptional<z.ZodCoercedBoolean<unknown>>;
    rateLimitPerSecond: z.ZodOptional<z.ZodNullable<z.ZodCoercedNumber<unknown>>>;
    rateLimitPerMinute: z.ZodOptional<z.ZodNullable<z.ZodCoercedNumber<unknown>>>;
    rateLimitPerHour: z.ZodOptional<z.ZodNullable<z.ZodCoercedNumber<unknown>>>;
    burstLimit: z.ZodOptional<z.ZodNullable<z.ZodCoercedNumber<unknown>>>;
    allowedEventTypes: z.ZodOptional<z.ZodArray<z.ZodString>>;
    maxEventSizeBytes: z.ZodOptional<z.ZodNullable<z.ZodCoercedNumber<unknown>>>;
    maxBatchSize: z.ZodOptional<z.ZodNullable<z.ZodCoercedNumber<unknown>>>;
    requireHttps: z.ZodOptional<z.ZodCoercedBoolean<unknown>>;
    ipAllowlist: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString>>>;
    ipBlocklist: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString>>>;
    alertEmail: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    alertWebhookUrl: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, z.core.$strip>>;
export declare const CreateApiKeyBodySchema: z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodObject<{
    environment: z.ZodEnum<{
        development: "development";
        staging: "staging";
        production: "production";
    }>;
    name: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    description: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    keyType: z.ZodDefault<z.ZodEnum<{
        admin: "admin";
        standard: "standard";
        read_only: "read_only";
        ingestion_only: "ingestion_only";
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
    rateLimitPerSecond: z.ZodOptional<z.ZodNullable<z.ZodCoercedNumber<unknown>>>;
    rateLimitPerMinute: z.ZodOptional<z.ZodNullable<z.ZodCoercedNumber<unknown>>>;
    rateLimitPerHour: z.ZodOptional<z.ZodNullable<z.ZodCoercedNumber<unknown>>>;
}, z.core.$strip>>;
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
    rateLimitPerSecond: z.ZodOptional<z.ZodNullable<z.ZodCoercedNumber<unknown>>>;
    rateLimitPerMinute: z.ZodOptional<z.ZodNullable<z.ZodCoercedNumber<unknown>>>;
    rateLimitPerHour: z.ZodOptional<z.ZodNullable<z.ZodCoercedNumber<unknown>>>;
}, z.core.$strip>>;
export declare const RotateApiKeyBodySchema: z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodObject<{
    name: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    expiresAt: z.ZodPipe<z.ZodTransform<{} | null | undefined, unknown>, z.ZodOptional<z.ZodNullable<z.ZodDate>>>;
    rotationReason: z.ZodOptional<z.ZodString>;
    gracePeriodHours: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
}, z.core.$strip>>;
export declare const RevokeApiKeyBodySchema: z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodObject<{
    revokedReason: z.ZodOptional<z.ZodString>;
}, z.core.$strip>>;
export declare const BulkRotateBodySchema: z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodObject<{
    environment: z.ZodOptional<z.ZodEnum<{
        development: "development";
        staging: "staging";
        production: "production";
    }>>;
    rotationReason: z.ZodOptional<z.ZodString>;
    gracePeriodHours: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
}, z.core.$strip>>;
export declare const BulkRevokeBodySchema: z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodObject<{
    environment: z.ZodOptional<z.ZodEnum<{
        development: "development";
        staging: "staging";
        production: "production";
    }>>;
    apiKeyIds: z.ZodOptional<z.ZodArray<z.ZodString>>;
    revokedReason: z.ZodOptional<z.ZodString>;
}, z.core.$strip>>;
export type ProjectStatus = z.infer<typeof ProjectStatusSchema>;
export type ProjectEnvironment = z.infer<typeof ProjectEnvironmentSchema>;
export type ApiKeyStatus = z.infer<typeof ApiKeyStatusSchema>;
export type ApiKeyType = z.infer<typeof ApiKeyTypeSchema>;
export type ApiKeyPermission = z.infer<typeof ApiKeyPermissionSchema>;
export type OrgRole = z.infer<typeof OrgRoleSchema>;
export type ListProjectsQuery = z.infer<typeof ListProjectsQuerySchema>;
export type ListApiKeysQuery = z.infer<typeof ListApiKeysQuerySchema>;
export type ListProjectActivityQuery = z.infer<typeof ListProjectActivityQuerySchema>;
export type CreateProjectBody = z.infer<typeof CreateProjectBodySchema>;
export type UpdateProjectBody = z.infer<typeof UpdateProjectBodySchema>;
export type CreateEnvironmentBody = z.infer<typeof CreateEnvironmentBodySchema>;
export type UpdateEnvironmentBody = z.infer<typeof UpdateEnvironmentBodySchema>;
export type CreateApiKeyBody = z.infer<typeof CreateApiKeyBodySchema>;
export type UpdateApiKeyBody = z.infer<typeof UpdateApiKeyBodySchema>;
export type RotateApiKeyBody = z.infer<typeof RotateApiKeyBodySchema>;
export type RevokeApiKeyBody = z.infer<typeof RevokeApiKeyBodySchema>;
export type BulkRotateBody = z.infer<typeof BulkRotateBodySchema>;
export type BulkRevokeBody = z.infer<typeof BulkRevokeBodySchema>;
export interface Project {
    id: string;
    orgId: string;
    name: string;
    slug: string;
    description: string | null;
    status: ProjectStatus;
    environment: ProjectEnvironment;
    productionApiPrefix: string | null;
    developmentApiPrefix: string | null;
    stagingApiPrefix: string | null;
    rateLimitPerSecond: number;
    rateLimitPerMinute: number;
    rateLimitPerHour: number;
    burstLimit: number;
    allowedEventTypes: string[];
    maxEventSizeBytes: number;
    maxBatchSize: number;
    allowedOrigins: string[];
    requireHttps: boolean;
    ipAllowlist: string[] | null;
    ipBlocklist: string[] | null;
    geoRestrictionEnabled: boolean;
    allowedCountries: string[] | null;
    alertEmail: string | null;
    alertWebhookUrl: string | null;
    alertOnErrorRateThreshold: number;
    alertOnLatencyThresholdMs: number;
    metadata: Record<string, unknown>;
    settings: Record<string, unknown>;
    archivedAt: Date | null;
    deletedAt: Date | null;
    deletedBy: string | null;
    createdAt: Date;
    updatedAt: Date;
}
export interface ProjectListItem extends Project {
    apiKeysCount: number;
    activeApiKeysCount: number;
}
export interface ProjectStats {
    totalRequests: number;
    apiKeysCount: number;
    activeKeysCount: number;
    environmentCount: number;
}
export interface ProjectWithStats extends Project {
    stats: ProjectStats;
}
export interface ProjectEnvironmentConfig {
    id: string;
    projectId: string;
    orgId: string;
    environment: ProjectEnvironment;
    isActive: boolean;
    rateLimitPerSecond: number | null;
    rateLimitPerMinute: number | null;
    rateLimitPerHour: number | null;
    burstLimit: number | null;
    allowedEventTypes: string[];
    maxEventSizeBytes: number | null;
    maxBatchSize: number | null;
    requireHttps: boolean;
    ipAllowlist: string[] | null;
    ipBlocklist: string[] | null;
    alertEmail: string | null;
    alertWebhookUrl: string | null;
    createdBy: string | null;
    createdAt: Date;
    updatedAt: Date;
}
export interface ProjectApiKey {
    id: string;
    projectId: string;
    orgId: string | null;
    keyPrefix: string;
    keyType: ApiKeyType;
    environment: ProjectEnvironment;
    name: string | null;
    description: string | null;
    isActive: boolean;
    status: ApiKeyStatus;
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
    metadata: Record<string, unknown>;
    createdAt: Date;
    updatedAt: Date;
}
/** Internal record that additionally carries the hash. Never returned to API. */
export interface ProjectApiKeyRecord extends ProjectApiKey {
    keyHash: string;
}
export interface CreateApiKeyResponse {
    apiKey: ProjectApiKey;
    fullKey: string;
}
/** Lightweight validated context returned by the ingestion-facing resolver. */
export interface ValidatedApiKey {
    id: string;
    projectId: string;
    orgId: string;
    environment: ProjectEnvironment;
    keyType: ApiKeyType;
    permissions: string[];
    allowedEndpoints: string[];
    blockedEndpoints: string[];
    rateLimitPerSecond: number | null;
    rateLimitPerMinute: number | null;
    rateLimitPerHour: number | null;
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
export interface ProjectUsageCounter {
    counterType: string;
    totalValue: number;
    lastPeriodStart: Date | null;
    lastPeriodEnd: Date | null;
    lastFlushedAt: Date | null;
}
export interface ProjectActivityItem {
    id: string;
    actorUserId: string | null;
    actorEmail: string | null;
    action: string;
    entityType: string;
    entityId: string | null;
    entityName: string | null;
    changedFields: string[] | null;
    status: string;
    isSensitive: boolean;
    metadata: Record<string, unknown>;
    createdAt: Date;
}
export interface ProjectActivityResult {
    data: ProjectActivityItem[];
    meta: {
        hasMore: boolean;
        nextCursor: string | null;
        limit: number;
    };
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
export interface OrganizationMembership {
    orgId: string;
    userId: string;
    role: OrgRole;
    isActive: boolean;
}
//# sourceMappingURL=types.d.ts.map