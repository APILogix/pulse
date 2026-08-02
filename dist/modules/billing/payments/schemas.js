import { z } from 'zod';
import { BillingUuidSchema, PaymentStatus, PaginationSchema } from '../shared/types.js';
export const ListPaymentsQuerySchema = z.object({
    status: z.nativeEnum(PaymentStatus).optional(),
}).merge(PaginationSchema);
export const RefundPaymentParamsSchema = z.object({
    paymentId: BillingUuidSchema,
});
export const RefundPaymentSchema = z.object({
    amount: z.coerce.number().int().positive().optional(),
    reason: z.string().trim().max(500).optional(),
});
//# sourceMappingURL=schemas.js.map