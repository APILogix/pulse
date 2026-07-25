import { z } from 'zod';
import { BillingUuidSchema, PaginationSchema } from '../shared/types.js';

export const ListBillingAuditLogsQuerySchema = z.object({
  action: z.string().trim().min(1).max(120).optional(),
  subscriptionId: BillingUuidSchema.optional(),
  invoiceId: BillingUuidSchema.optional(),
  paymentId: BillingUuidSchema.optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
}).merge(PaginationSchema);

export type ListBillingAuditLogsQuery = z.infer<typeof ListBillingAuditLogsQuerySchema>;
