import { z } from 'zod';
import { BillingInterval } from '../shared/types.js';
export declare const CheckoutSessionSchema: z.ZodObject<{
    planId: z.ZodString;
    billingInterval: z.ZodEnum<typeof BillingInterval>;
    successUrl: z.ZodOptional<z.ZodString>;
    cancelUrl: z.ZodOptional<z.ZodString>;
    couponCode: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export declare const CreditNoteSchema: z.ZodObject<{
    invoiceId: z.ZodString;
    amount: z.ZodCoercedNumber<unknown>;
    reason: z.ZodString;
}, z.core.$strip>;
export declare const TaxProfileSchema: z.ZodObject<{
    taxId: z.ZodOptional<z.ZodString>;
    billingAddress: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, z.core.$strip>;
export type CheckoutSessionBody = z.infer<typeof CheckoutSessionSchema>;
export type CreditNoteBody = z.infer<typeof CreditNoteSchema>;
export type TaxProfileBody = z.infer<typeof TaxProfileSchema>;
//# sourceMappingURL=schemas.d.ts.map