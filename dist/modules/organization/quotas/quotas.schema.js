import { z } from "zod";
export const QuotaRequestStatusSchema = z.enum([
    "pending",
    "approved",
    "rejected",
    "cancelled",
]);
export const QuotaTypeSchema = z.enum([
    "api_requests",
    "events",
    "storage",
    "projects",
    "members",
    "alerts",
]);
export const CreateQuotaRequestSchema = z.object({
    quotaType: z.string().min(1).max(50),
    currentLimit: z.number().int().min(0),
    requestedLimit: z.number().int().min(1),
    reason: z.string().min(1).max(2000),
});
export const ReviewQuotaRequestSchema = z.object({
    notes: z.string().max(2000).optional(),
});
const LimitUsageSchema = z.object({
    used: z.number(),
    limit: z.number().nullable(),
});
const EnabledLimitUsageSchema = LimitUsageSchema.extend({
    enabled: z.boolean(),
});
export const BillingSummaryResponseSchema = z.object({
    orgId: z.string().uuid(),
    subscriptionStatus: z.string(),
    planTier: z.string(),
    eventLimitMonthly: z.number(),
    hardCap: z.boolean(),
    usage: z.object({
        activeMembers: LimitUsageSchema,
        eventsMonthly: LimitUsageSchema.extend({
            remaining: z.number(),
        }),
        aiCredits: LimitUsageSchema.extend({
            remaining: z.number(),
        }),
        ssoProviders: EnabledLimitUsageSchema,
        scimTokens: EnabledLimitUsageSchema,
    }),
}).strict();
export const UsageLimitsResponseSchema = z.object({
    subscriptionStatus: z.string(),
    planKey: z.string(),
    limits: z.object({
        members: LimitUsageSchema.extend({
            pending: z.number(),
        }),
        projects: LimitUsageSchema,
        apiKeys: LimitUsageSchema,
        connectors: LimitUsageSchema,
        alertRules: LimitUsageSchema,
        dashboards: LimitUsageSchema,
        ssoProviders: EnabledLimitUsageSchema,
        scimTokens: EnabledLimitUsageSchema,
        eventsMonthly: LimitUsageSchema.extend({
            remaining: z.number(),
            hardCap: z.boolean(),
        }),
        aiCredits: LimitUsageSchema.extend({
            remaining: z.number(),
        }),
    }),
}).strict();
//# sourceMappingURL=quotas.schema.js.map