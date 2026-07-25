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

export type GetUsageRecordsQuery = z.infer<typeof GetUsageRecordsSchema>;
export type IncrementUsageBody = z.infer<typeof IncrementUsageSchema>;
export type UsageAttributionQuery = z.infer<typeof UsageAttributionQuerySchema>;
