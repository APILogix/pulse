import { z } from 'zod';
import { PaymentStatus } from '../shared/types.js';
export declare const ListPaymentsQuerySchema: z.ZodObject<{
    status: z.ZodOptional<z.ZodEnum<typeof PaymentStatus>>;
    page: z.ZodDefault<z.ZodOptional<z.ZodCoercedNumber<unknown>>>;
    limit: z.ZodDefault<z.ZodOptional<z.ZodCoercedNumber<unknown>>>;
}, z.core.$strip>;
export declare const RefundPaymentParamsSchema: z.ZodObject<{
    paymentId: z.ZodString;
}, z.core.$strip>;
export declare const RefundPaymentSchema: z.ZodObject<{
    amount: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    reason: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type ListPaymentsQuery = z.infer<typeof ListPaymentsQuerySchema>;
export type RefundPaymentParams = z.infer<typeof RefundPaymentParamsSchema>;
export type RefundPaymentBody = z.infer<typeof RefundPaymentSchema>;
//# sourceMappingURL=schemas.d.ts.map