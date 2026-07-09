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
//# sourceMappingURL=quotas.schema.js.map