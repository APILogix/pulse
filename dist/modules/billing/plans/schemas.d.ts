import { z } from 'zod';
import { BillingInterval } from '../shared/types.js';
export declare const PlanIdParamsSchema: z.ZodObject<{
    planId: z.ZodString;
}, z.core.$strip>;
export declare const EstimatePricingSchema: z.ZodObject<{
    planId: z.ZodString;
    interval: z.ZodEnum<typeof BillingInterval>;
    couponCode: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type EstimatePricingBody = z.infer<typeof EstimatePricingSchema>;
//# sourceMappingURL=schemas.d.ts.map