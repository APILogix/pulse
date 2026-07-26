import { z } from 'zod';
import { BillingUuidSchema } from '../shared/types.js';

export const CreateRefundSchema = z.object({
  paymentId: BillingUuidSchema,
  amount: z.coerce.number().int().positive().optional(),
  reason: z.string().trim().max(500).optional(),
});

export type CreateRefundBody = z.infer<typeof CreateRefundSchema>;
