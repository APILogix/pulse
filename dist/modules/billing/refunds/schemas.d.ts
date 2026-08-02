import { z } from 'zod';
export declare const CreateRefundSchema: z.ZodObject<{
    paymentId: z.ZodString;
    amount: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    reason: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type CreateRefundBody = z.infer<typeof CreateRefundSchema>;
//# sourceMappingURL=schemas.d.ts.map