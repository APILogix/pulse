import { z } from 'zod';
import { BillingInterval, BillingUuidSchema } from '../shared/types.js';
export const CheckoutSessionSchema = z.object({
    planId: BillingUuidSchema,
    billingInterval: z.nativeEnum(BillingInterval),
    successUrl: z.string().url().optional(),
    cancelUrl: z.string().url().optional(),
    couponCode: z.string().trim().min(3).max(50).optional(),
});
export const CreditNoteSchema = z.object({
    invoiceId: BillingUuidSchema,
    amount: z.coerce.number().int().positive(),
    reason: z.string().trim().min(1).max(500),
});
export const TaxProfileSchema = z.object({
    taxId: z.string().trim().min(1).max(100).optional(),
    billingAddress: z.record(z.string(), z.unknown()).optional(),
});
//# sourceMappingURL=schemas.js.map