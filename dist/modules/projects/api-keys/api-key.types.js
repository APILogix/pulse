import { z } from "zod";
import { normalizeObjectKeys, OptionalDateSchema, Ipv4OrV6 } from "../shared/schema-utils.js";
export const ApiKeyStatusSchema = z.enum([
    "active",
    "revoked",
    "expired",
    "rotated",
    "suspended",
]);
export const ApiKeyTypeSchema = z.enum([
    "read_write",
    "read_only",
    "write_only",
    "temporary",
]);
export const ApiKeyPermissionSchema = z.enum([
    "ingest:write",
    "ingest:read",
    "events:read",
    "metrics:read",
    "config:read",
]);
export const ApiKeyRotationStateSchema = z.enum([
    "none",
    "rotating",
    "grace_period",
    "completed",
]);
export const ApiKeyParamsSchema = z.object({
    orgId: z.string().uuid(),
    projectId: z.string().uuid(),
    apiKeyId: z.string().uuid(),
});
export const ListApiKeysQuerySchema = z.preprocess(normalizeObjectKeys, z.object({
    environmentId: z.string().uuid().optional(),
    keyType: ApiKeyTypeSchema.optional(),
    status: ApiKeyStatusSchema.optional(),
    isActive: z.coerce.boolean().optional(),
    includeInactive: z.coerce.boolean().optional(),
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    offset: z.coerce.number().int().min(0).optional(),
}));
export const CreateApiKeyBodySchema = z.preprocess(normalizeObjectKeys, z.object({
    environmentId: z.string().uuid(),
    name: z.string().min(1).max(255).nullable().optional(),
    description: z.string().max(2000).nullable().optional(),
    keyType: ApiKeyTypeSchema.default("read_write"),
    expiresAt: OptionalDateSchema,
    autoRotateEnabled: z.coerce.boolean().optional(),
    autoRotateDays: z.coerce.number().int().min(1).max(365).optional(),
    permissions: z.array(ApiKeyPermissionSchema).min(1).max(20).optional(),
    allowedEndpoints: z.array(z.string().min(1).max(255)).max(100).optional(),
    blockedEndpoints: z.array(z.string().min(1).max(255)).max(100).optional(),
    allowedEventTypes: z.array(z.string().min(1).max(100)).max(100).optional(),
    allowedOrigins: z.array(z.string().min(1).max(255)).max(100).optional(),
    allowedIps: z.array(Ipv4OrV6).max(256).optional(),
    allowedDomains: z.array(z.string().min(1).max(255)).max(100).optional(),
    samplingRules: z.record(z.string(), z.unknown()).optional(),
    featureFlags: z.record(z.string(), z.unknown()).optional(),
    sdkConfig: z.record(z.string(), z.unknown()).optional(),
    rateLimitPerSecond: z.coerce.number().int().min(1).max(1_000_000).nullable().optional(),
    rateLimitPerMinute: z.coerce.number().int().min(1).max(100_000_000).nullable().optional(),
    rateLimitPerHour: z.coerce.number().int().min(1).max(1_000_000_000).nullable().optional(),
}));
export const UpdateApiKeyBodySchema = z.preprocess(normalizeObjectKeys, z
    .object({
    name: z.string().min(1).max(255).nullable().optional(),
    description: z.string().max(2000).nullable().optional(),
    expiresAt: OptionalDateSchema,
    autoRotateEnabled: z.coerce.boolean().optional(),
    autoRotateDays: z.coerce.number().int().min(1).max(365).optional(),
    permissions: z.array(ApiKeyPermissionSchema).min(1).max(20).optional(),
    allowedEndpoints: z.array(z.string().min(1).max(255)).max(100).optional(),
    blockedEndpoints: z.array(z.string().min(1).max(255)).max(100).optional(),
    allowedEventTypes: z.array(z.string().min(1).max(100)).max(100).optional(),
    allowedOrigins: z.array(z.string().min(1).max(255)).max(100).optional(),
    allowedIps: z.array(Ipv4OrV6).max(256).optional(),
    allowedDomains: z.array(z.string().min(1).max(255)).max(100).optional(),
    samplingRules: z.record(z.string(), z.unknown()).optional(),
    featureFlags: z.record(z.string(), z.unknown()).optional(),
    sdkConfig: z.record(z.string(), z.unknown()).optional(),
    rateLimitPerSecond: z.coerce.number().int().min(1).max(1_000_000).nullable().optional(),
    rateLimitPerMinute: z.coerce.number().int().min(1).max(100_000_000).nullable().optional(),
    rateLimitPerHour: z.coerce.number().int().min(1).max(1_000_000_000).nullable().optional(),
    version: z.number().int().min(1).optional(),
})
    .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field is required",
}));
export const RotateApiKeyBodySchema = z.preprocess(normalizeObjectKeys, z.object({
    name: z.string().min(1).max(255).nullable().optional(),
    expiresAt: OptionalDateSchema,
    rotationReason: z.string().min(1).max(500).optional(),
    gracePeriodHours: z.coerce.number().int().min(0).max(168).optional(),
}));
export const RevokeApiKeyBodySchema = z.preprocess(normalizeObjectKeys, z.object({
    revokedReason: z.string().min(1).max(500).optional(),
}));
export const BulkRotateBodySchema = z.preprocess(normalizeObjectKeys, z.object({
    environmentId: z.string().uuid().optional(),
    rotationReason: z.string().min(1).max(500).optional(),
    gracePeriodHours: z.coerce.number().int().min(0).max(168).optional(),
}));
export const BulkRevokeBodySchema = z.preprocess(normalizeObjectKeys, z.object({
    environmentId: z.string().uuid().optional(),
    apiKeyIds: z.array(z.string().uuid()).min(1).max(100).optional(),
    revokedReason: z.string().min(1).max(500).optional(),
}));
//# sourceMappingURL=api-key.types.js.map