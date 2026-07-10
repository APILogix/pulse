import { z } from "zod";
export const normalizeObjectKeys = (value) => {
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
export const OptionalDateSchema = z.preprocess((value) => {
    if (value === undefined || value === null || value instanceof Date) {
        return value;
    }
    if (typeof value === "string") {
        const parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? value : parsed;
    }
    return value;
}, z.date().nullable().optional());
export const Ipv4OrV6 = z
    .string()
    .min(1)
    .max(64)
    .regex(/^(?:\d{1,3}(?:\.\d{1,3}){3}(?:\/\d{1,2})?|[0-9a-fA-F:]+(?:\/\d{1,3})?)$/, "must be a valid IPv4/IPv6 address or CIDR");
export const CountryCode = z
    .string()
    .length(2)
    .regex(/^[A-Za-z]{2}$/, "must be a 2-letter ISO country code")
    .transform((v) => v.toUpperCase());
export const OrgRoleSchema = z.enum([
    "owner",
    "admin",
    "developer",
    "billing",
    "security",
    "member",
    "viewer",
]);
export const OrgIdParamsSchema = z.object({
    orgId: z.string().uuid(),
});
//# sourceMappingURL=schema-utils.js.map