import { z } from 'zod';
import { BillingUuidSchema, PaginationSchema } from '../shared/types.js';
export const GetUsageRecordsSchema = z.object({
    startDate: z.string().datetime().optional(),
    endDate: z.string().datetime().optional(),
}).merge(PaginationSchema);
export const IncrementUsageSchema = z.object({
    count: z.number().int().min(1).default(1),
});
export const UsageAttributionQuerySchema = z.object({
    startDate: z.string().datetime().optional(),
    endDate: z.string().datetime().optional(),
    bucket: z.enum(['minute', 'hour', 'day']).optional().default('day'),
    projectId: BillingUuidSchema.optional(),
}).merge(PaginationSchema);
export const CurrentUsageDataSchema = z.object({
    eventsUsed: z.number(),
    eventLimit: z.number(),
    remainingEvents: z.number(),
    aiCreditsUsed: z.number(),
    aiCreditLimit: z.number(),
    remainingAiCredits: z.number(),
    projectsUsed: z.number(),
    membersUsed: z.number(),
}).strict();
export const CurrentUsageResponseSchema = z.object({
    success: z.literal(true),
    data: CurrentUsageDataSchema,
}).strict();
export const QuotaSummaryDataSchema = z.object({
    eventsLeft: z.number(),
    totalEvents: z.number(),
    billingCycleEndDate: z.string().datetime(),
    aiCreditsTotal: z.number(),
    aiCreditsLeft: z.number(),
}).strict();
export const QuotaSummaryResponseSchema = z.object({
    success: z.literal(true),
    data: QuotaSummaryDataSchema,
}).strict();
//# sourceMappingURL=schemas.js.map