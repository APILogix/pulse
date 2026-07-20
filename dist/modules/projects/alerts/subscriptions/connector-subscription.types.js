import { z } from "zod";
import { UuidSchema } from "../../../alerting/types.js";
import { AlertSeveritySchema } from "../../../alerting/common.js";
import { normalizeObjectKeys } from "../../shared/schema-utils.js";
export const AlertCategorySchema = z.enum([
    "error",
    "performance",
    "deployment",
    "cron",
    "release",
    "usage",
    "billing",
    "security",
    "ai",
]);
export const ProjectConnectorSubscriptionParamsSchema = z.object({
    orgId: UuidSchema,
    projectId: UuidSchema,
    subscriptionId: UuidSchema,
});
export const CreateProjectConnectorSubscriptionBodySchema = z.preprocess(normalizeObjectKeys, z.object({
    connectorId: UuidSchema,
    enabled: z.coerce.boolean().default(true),
    alertCategories: z.array(AlertCategorySchema).default(["error", "performance", "security"]),
    severityThreshold: AlertSeveritySchema.default("error"),
    memberIds: z.array(UuidSchema).default([]),
    channelOverrides: z.record(z.string(), z.unknown()).default({}),
    quietHours: z.record(z.string(), z.unknown()).nullable().optional(),
    digestMode: z.record(z.string(), z.unknown()).nullable().optional(),
}));
export const UpdateProjectConnectorSubscriptionBodySchema = z.preprocess(normalizeObjectKeys, z.object({
    enabled: z.coerce.boolean().optional(),
    alertCategories: z.array(AlertCategorySchema).optional(),
    severityThreshold: AlertSeveritySchema.optional(),
    memberIds: z.array(UuidSchema).optional(),
    channelOverrides: z.record(z.string(), z.unknown()).optional(),
    quietHours: z.record(z.string(), z.unknown()).nullable().optional(),
    digestMode: z.record(z.string(), z.unknown()).nullable().optional(),
}).refine((value) => Object.keys(value).length > 0, {
    message: "At least one field is required",
}));
export const ListProjectConnectorSubscriptionsQuerySchema = z.preprocess(normalizeObjectKeys, z.object({
    enabled: z.coerce.boolean().optional(),
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    offset: z.coerce.number().int().min(0).optional(),
    sortBy: z.enum(["created_at", "updated_at"]).default("created_at"),
    sortOrder: z.enum(["asc", "desc"]).default("desc"),
}));
//# sourceMappingURL=connector-subscription.types.js.map