import { z } from "zod";
import { QuietHoursSchema } from "./quiet-hours.js";
const UuidSchema = z.string().uuid();
const JsonObjectSchema = z.record(z.string(), z.unknown());
const BooleanInputSchema = z.preprocess((value) => {
    if (value === "true" || value === "1")
        return true;
    if (value === "false" || value === "0")
        return false;
    return value;
}, z.boolean());
function normalizeChannelKeys(value) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        return value;
    const source = value;
    const result = { ...source };
    const aliases = {
        connectorId: "connector_id",
        channelType: "channel_type",
        destinationMetadata: "destination_metadata",
        isDefault: "is_default",
        severityThreshold: "severity_threshold",
        digestMode: "digest_mode",
        quietHours: "quiet_hours",
        sortBy: "sort_by",
        sortOrder: "sort_order",
    };
    for (const [camel, snake] of Object.entries(aliases)) {
        if (result[camel] === undefined && source[snake] !== undefined)
            result[camel] = source[snake];
    }
    return result;
}
export const AlertChannelSeveritySchema = z.enum(["info", "warning", "error", "critical"]);
export const AlertChannelDigestModeSchema = z.enum(["immediate", "hourly", "daily", "weekly"]);
export const ProjectAlertChannelParamsSchema = z.object({
    orgId: UuidSchema,
    projectId: UuidSchema,
    channelId: UuidSchema,
});
export const ProjectAlertChannelBaseParamsSchema = ProjectAlertChannelParamsSchema.omit({ channelId: true });
export const ListProjectAlertChannelsQuerySchema = z.preprocess(normalizeChannelKeys, z.object({
    channelType: z.string().trim().min(1).max(50).optional(),
    enabled: BooleanInputSchema.optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    offset: z.coerce.number().int().min(0).optional(),
    sortBy: z.enum(["created_at", "updated_at", "name"]).default("created_at"),
    sortOrder: z.enum(["asc", "desc"]).default("desc"),
}));
export const CreateProjectAlertChannelBodySchema = z.preprocess(normalizeChannelKeys, z.object({
    connectorId: UuidSchema.nullable().optional(),
    channelType: z.string().trim().min(1).max(50),
    name: z.string().trim().min(1).max(150),
    description: z.string().max(5000).nullable().optional(),
    destination: z.string().trim().min(1).max(2048).nullable().optional(),
    destinationMetadata: JsonObjectSchema.default({}),
    isDefault: BooleanInputSchema.default(false),
    enabled: BooleanInputSchema.default(true),
}).superRefine((body, context) => {
    if (!body.connectorId && !body.destination && body.channelType.toLowerCase() !== "email") {
        context.addIssue({
            code: "custom",
            path: ["destination"],
            message: "A connectorId or destination is required",
        });
    }
}));
export const UpdateProjectAlertChannelBodySchema = z.preprocess(normalizeChannelKeys, z.object({
    connectorId: UuidSchema.nullable().optional(),
    channelType: z.string().trim().min(1).max(50).optional(),
    name: z.string().trim().min(1).max(150).optional(),
    description: z.string().max(5000).nullable().optional(),
    destination: z.string().trim().min(1).max(2048).nullable().optional(),
    destinationMetadata: JsonObjectSchema.optional(),
    isDefault: BooleanInputSchema.optional(),
    enabled: BooleanInputSchema.optional(),
    version: z.coerce.number().int().min(1).optional(),
}).refine((body) => Object.keys(body).length > 0, {
    message: "At least one field is required",
}));
export const ToggleProjectAlertChannelBodySchema = z.preprocess(normalizeChannelKeys, z.object({
    enabled: BooleanInputSchema,
    version: z.coerce.number().int().min(1).optional(),
}));
export const UpsertMemberAlertChannelPreferenceBodySchema = z.preprocess(normalizeChannelKeys, z.object({
    category: z.string().trim().min(1).max(100).default("all"),
    severityThreshold: AlertChannelSeveritySchema.default("warning"),
    enabled: BooleanInputSchema.default(true),
    digestMode: AlertChannelDigestModeSchema.default("immediate"),
    quietHours: QuietHoursSchema.default({}),
}));
export const DeleteMemberAlertChannelPreferenceQuerySchema = z.object({
    category: z.string().trim().min(1).max(100).default("all"),
});
//# sourceMappingURL=channel.types.js.map