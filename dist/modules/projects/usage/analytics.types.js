/**
 * Project usage analytics types and schemas.
 */
import { z } from "zod";
import { normalizeObjectKeys } from "../shared/schema-utils.js";
import { UuidSchema } from "../../alerting/types.js";
export const UsageGranularitySchema = z.enum(["minute", "hourly", "daily"]);
export const UsageAnalyticsQuerySchema = z.preprocess(normalizeObjectKeys, z.object({
    from: z.coerce.date(),
    to: z.coerce.date(),
    granularity: UsageGranularitySchema.default("hourly"),
    environmentId: z.string().uuid().optional(),
    apiKeyId: z.string().uuid().optional(),
    release: z.string().max(100).optional(),
    sdkVersion: z.string().max(100).optional(),
    service: z.string().max(100).optional(),
    endpoint: z.string().max(255).optional(),
    region: z.string().max(100).optional(),
    eventType: z.string().max(50).optional(),
    severity: z.string().max(20).optional(),
    tag: z.string().max(100).optional(),
    limit: z.coerce.number().int().min(1).max(1000).default(100),
    offset: z.coerce.number().int().min(0).default(0),
    cursor: z.string().max(255).optional(),
}).refine((data) => data.to >= data.from, {
    message: "to must be after from",
    path: ["to"],
}));
export const HeatmapQuerySchema = z.preprocess(normalizeObjectKeys, z.object({
    from: z.coerce.date(),
    to: z.coerce.date(),
    type: z.enum(["calendar", "hourly", "dayOfWeek"]).default("calendar"),
    environmentId: z.string().uuid().optional(),
    apiKeyId: z.string().uuid().optional(),
}));
export const TopListQuerySchema = z.preprocess(normalizeObjectKeys, z.object({
    from: z.coerce.date(),
    to: z.coerce.date(),
    dimension: z.enum([
        "endpoint",
        "service",
        "errorGroup",
        "sdkVersion",
        "country",
        "browser",
        "os",
        "device",
        "release",
    ]),
    environmentId: z.string().uuid().optional(),
    apiKeyId: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(10),
}));
export const ComparisonQuerySchema = z.preprocess(normalizeObjectKeys, z.object({
    from: z.coerce.date(),
    to: z.coerce.date(),
    dimension: z.enum(["environment", "apiKey"]).default("environment"),
    limit: z.coerce.number().int().min(1).max(50).default(10),
}));
//# sourceMappingURL=analytics.types.js.map