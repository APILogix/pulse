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
// ─────────────────────────────────────────────────────────────────────────────
// Input normalization
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Accept either camelCase or snake_case keys on the way in. We only alias the
 * fields clients realistically send in both casings; everything else passes
 * through untouched.
 */
const normalizeObjectKeys = (value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return value;
    }
    const r = value;
    const alias = (camel, snake) => {
        if (r[camel] === undefined && r[snake] !== undefined) {
            r[camel] = r[snake];
        }
    };
    alias("productionApiPrefix", "production_api_prefix");
    alias("developmentApiPrefix", "development_api_prefix");
    alias("stagingApiPrefix", "staging_api_prefix");
    alias("rateLimitPerSecond", "rate_limit_per_second");
    alias("rateLimitPerMinute", "rate_limit_per_minute");
    alias("rateLimitPerHour", "rate_limit_per_hour");
    alias("burstLimit", "burst_limit");
    alias("allowedEventTypes", "allowed_event_types");
    alias("blockedEventTypes", "blocked_event_types");
    alias("maxEventSizeBytes", "max_event_size_bytes");
    alias("maxBatchSize", "max_batch_size");
    alias("allowedOrigins", "allowed_origins");
    alias("requireHttps", "require_https");
    alias("ipAllowlist", "ip_allowlist");
    alias("ipBlocklist", "ip_blocklist");
    alias("geoRestrictionEnabled", "geo_restriction_enabled");
    alias("allowedCountries", "allowed_countries");
    alias("alertEmail", "alert_email");
    alias("alertWebhookUrl", "alert_webhook_url");
    alias("alertOnErrorRateThreshold", "alert_on_error_rate_threshold");
    alias("alertOnLatencyThresholdMs", "alert_on_latency_threshold_ms");
    alias("expiresAt", "expires_at");
    alias("gracePeriodHours", "grace_period_hours");
    alias("keyType", "key_type");
    alias("autoRotateEnabled", "auto_rotate_enabled");
    alias("autoRotateDays", "auto_rotate_days");
    alias("allowedEndpoints", "allowed_endpoints");
    alias("blockedEndpoints", "blocked_endpoints");
    alias("rotationReason", "rotation_reason");
    alias("revokedReason", "revoked_reason");
    alias("sortBy", "sort_by");
    alias("sortOrder", "sort_order");
    alias("isActive", "is_active");
    alias("includeInactive", "include_inactive");
    alias("includeDeleted", "include_deleted");
    return r;
};
const OptionalDateSchema = z.preprocess((value) => {
    if (value === undefined || value === null || value instanceof Date) {
        return value;
    }
    if (typeof value === "string") {
        const parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? value : parsed;
    }
    return value;
}, z.date().nullable().optional());
// ─────────────────────────────────────────────────────────────────────────────
// Enums
// ─────────────────────────────────────────────────────────────────────────────
export const ProjectStatusSchema = z.enum(["active", "paused", "archived"]);
export const ProjectEnvironmentSchema = z.enum([
    "development",
    "staging",
    "production",
]);
export const ApiKeyStatusSchema = z.enum([
    "active",
    "revoked",
    "expired",
    "rotated",
    "suspended",
]);
export const ApiKeyTypeSchema = z.enum([
    "standard",
    "read_only",
    "admin",
    "ingestion_only",
]);
export const OrgRoleSchema = z.enum([
    "owner",
    "admin",
    "billing",
    "member",
    "viewer",
]);
// Permission tokens a key may carry. Kept as a closed set so callers cannot
// mint arbitrary scopes.
export const ApiKeyPermissionSchema = z.enum([
    "ingest:write",
    "ingest:read",
    "events:read",
    "metrics:read",
    "config:read",
]);
const Ipv4OrV6 = z
    .string()
    .min(1)
    .max(64)
    .regex(/^(?:\d{1,3}(?:\.\d{1,3}){3}(?:\/\d{1,2})?|[0-9a-fA-F:]+(?:\/\d{1,3})?)$/, "must be a valid IPv4/IPv6 address or CIDR");
const CountryCode = z
    .string()
    .length(2)
    .regex(/^[A-Za-z]{2}$/, "must be a 2-letter ISO country code")
    .transform((v) => v.toUpperCase());
// ─────────────────────────────────────────────────────────────────────────────
// Param schemas
// ─────────────────────────────────────────────────────────────────────────────
export const OrgIdParamsSchema = z.object({
    orgId: z.string().uuid(),
});
export const ProjectParamsSchema = z.object({
    orgId: z.string().uuid(),
    projectId: z.string().uuid(),
});
export const ApiKeyParamsSchema = z.object({
    orgId: z.string().uuid(),
    projectId: z.string().uuid(),
    apiKeyId: z.string().uuid(),
});
export const EnvironmentParamsSchema = z.object({
    orgId: z.string().uuid(),
    projectId: z.string().uuid(),
    environment: ProjectEnvironmentSchema,
});
// ─────────────────────────────────────────────────────────────────────────────
// Query schemas
// ─────────────────────────────────────────────────────────────────────────────
export const ListProjectsQuerySchema = z.preprocess(normalizeObjectKeys, z.object({
    status: ProjectStatusSchema.optional(),
    environment: ProjectEnvironmentSchema.optional(),
    search: z.string().min(1).max(100).optional(),
    includeDeleted: z.coerce.boolean().optional(),
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    offset: z.coerce.number().int().min(0).optional(),
    sortBy: z.enum(["created_at", "updated_at", "name"]).default("created_at"),
    sortOrder: z.enum(["asc", "desc"]).default("desc"),
}));
export const ListApiKeysQuerySchema = z.preprocess(normalizeObjectKeys, z.object({
    environment: ProjectEnvironmentSchema.optional(),
    keyType: ApiKeyTypeSchema.optional(),
    status: ApiKeyStatusSchema.optional(),
    isActive: z.coerce.boolean().optional(),
    includeInactive: z.coerce.boolean().optional(),
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    offset: z.coerce.number().int().min(0).optional(),
}));
// ─────────────────────────────────────────────────────────────────────────────
// Project body schemas
// ─────────────────────────────────────────────────────────────────────────────
// Shared optional config fields reused by create + update + environment.
const projectConfigShape = {
    rateLimitPerSecond: z.coerce.number().int().min(1).max(1_000_000).optional(),
    rateLimitPerMinute: z.coerce.number().int().min(1).max(100_000_000).optional(),
    rateLimitPerHour: z.coerce.number().int().min(1).max(1_000_000_000).optional(),
    burstLimit: z.coerce.number().int().min(1).max(1_000_000).optional(),
    allowedEventTypes: z.array(z.string().min(1).max(100)).max(100).optional(),
    blockedEventTypes: z.array(z.string().min(1).max(100)).max(100).optional(),
    maxEventSizeBytes: z.coerce.number().int().min(1).max(67_108_864).optional(),
    maxBatchSize: z.coerce.number().int().min(1).max(10_000).optional(),
    allowedOrigins: z.array(z.string().min(1).max(255)).max(100).optional(),
    requireHttps: z.coerce.boolean().optional(),
    ipAllowlist: z.array(Ipv4OrV6).max(256).nullable().optional(),
    ipBlocklist: z.array(Ipv4OrV6).max(256).nullable().optional(),
    geoRestrictionEnabled: z.coerce.boolean().optional(),
    allowedCountries: z.array(CountryCode).max(250).nullable().optional(),
    alertEmail: z.string().email().max(255).nullable().optional(),
    alertWebhookUrl: z.string().url().max(500).nullable().optional(),
    alertOnErrorRateThreshold: z.coerce.number().min(0).max(100).optional(),
    alertOnLatencyThresholdMs: z.coerce.number().int().min(1).max(600_000).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    settings: z.record(z.string(), z.unknown()).optional(),
};
export const CreateProjectBodySchema = z.preprocess(normalizeObjectKeys, z.object({
    name: z.string().min(1).max(255),
    description: z.string().max(5000).nullable().optional(),
    environment: ProjectEnvironmentSchema.default("development"),
    productionApiPrefix: z.string().max(20).nullable().optional(),
    developmentApiPrefix: z.string().max(20).nullable().optional(),
    stagingApiPrefix: z.string().max(20).nullable().optional(),
    ...projectConfigShape,
}));
export const UpdateProjectBodySchema = z.preprocess(normalizeObjectKeys, z
    .object({
    name: z.string().min(1).max(255).optional(),
    description: z.string().max(5000).nullable().optional(),
    status: ProjectStatusSchema.optional(),
    environment: ProjectEnvironmentSchema.optional(),
    productionApiPrefix: z.string().max(20).nullable().optional(),
    developmentApiPrefix: z.string().max(20).nullable().optional(),
    stagingApiPrefix: z.string().max(20).nullable().optional(),
    ...projectConfigShape,
})
    .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field is required",
}));
// ─────────────────────────────────────────────────────────────────────────────
// Environment body schemas
// ─────────────────────────────────────────────────────────────────────────────
const environmentConfigShape = {
    isActive: z.coerce.boolean().optional(),
    rateLimitPerSecond: z.coerce.number().int().min(1).max(1_000_000).nullable().optional(),
    rateLimitPerMinute: z.coerce.number().int().min(1).max(100_000_000).nullable().optional(),
    rateLimitPerHour: z.coerce.number().int().min(1).max(1_000_000_000).nullable().optional(),
    burstLimit: z.coerce.number().int().min(1).max(1_000_000).nullable().optional(),
    allowedEventTypes: z.array(z.string().min(1).max(100)).max(100).optional(),
    blockedEventTypes: z.array(z.string().min(1).max(100)).max(100).optional(),
    maxEventSizeBytes: z.coerce.number().int().min(1).max(67_108_864).nullable().optional(),
    maxBatchSize: z.coerce.number().int().min(1).max(10_000).nullable().optional(),
    requireHttps: z.coerce.boolean().optional(),
    ipAllowlist: z.array(Ipv4OrV6).max(256).nullable().optional(),
    ipBlocklist: z.array(Ipv4OrV6).max(256).nullable().optional(),
    alertEmail: z.string().email().max(255).nullable().optional(),
    alertWebhookUrl: z.string().url().max(500).nullable().optional(),
};
export const CreateEnvironmentBodySchema = z.preprocess(normalizeObjectKeys, z.object({
    environment: ProjectEnvironmentSchema,
    ...environmentConfigShape,
}));
export const UpdateEnvironmentBodySchema = z.preprocess(normalizeObjectKeys, z
    .object(environmentConfigShape)
    .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field is required",
}));
// ─────────────────────────────────────────────────────────────────────────────
// API key body schemas
// ─────────────────────────────────────────────────────────────────────────────
export const CreateApiKeyBodySchema = z.preprocess(normalizeObjectKeys, z.object({
    environment: ProjectEnvironmentSchema,
    name: z.string().min(1).max(255).nullable().optional(),
    description: z.string().max(2000).nullable().optional(),
    keyType: ApiKeyTypeSchema.default("standard"),
    expiresAt: OptionalDateSchema,
    autoRotateEnabled: z.coerce.boolean().optional(),
    autoRotateDays: z.coerce.number().int().min(1).max(365).optional(),
    permissions: z.array(ApiKeyPermissionSchema).min(1).max(20).optional(),
    allowedEndpoints: z.array(z.string().min(1).max(255)).max(100).optional(),
    blockedEndpoints: z.array(z.string().min(1).max(255)).max(100).optional(),
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
    rateLimitPerSecond: z.coerce.number().int().min(1).max(1_000_000).nullable().optional(),
    rateLimitPerMinute: z.coerce.number().int().min(1).max(100_000_000).nullable().optional(),
    rateLimitPerHour: z.coerce.number().int().min(1).max(1_000_000_000).nullable().optional(),
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
    environment: ProjectEnvironmentSchema.optional(),
    rotationReason: z.string().min(1).max(500).optional(),
    gracePeriodHours: z.coerce.number().int().min(0).max(168).optional(),
}));
export const BulkRevokeBodySchema = z.preprocess(normalizeObjectKeys, z.object({
    environment: ProjectEnvironmentSchema.optional(),
    apiKeyIds: z.array(z.string().uuid()).min(1).max(100).optional(),
    revokedReason: z.string().min(1).max(500).optional(),
}));
//# sourceMappingURL=types.js.map