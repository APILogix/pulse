import { z } from 'zod';
import { BillingInterval } from '../shared/types.js';
export declare const CreateSubscriptionSchema: z.ZodObject<{
    planId: z.ZodString;
    paymentMethodId: z.ZodOptional<z.ZodString>;
    billingInterval: z.ZodOptional<z.ZodEnum<typeof BillingInterval>>;
    couponCode: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export declare const ChangePlanSchema: z.ZodObject<{
    planId: z.ZodString;
    prorationBehavior: z.ZodOptional<z.ZodEnum<{
        none: "none";
        create_prorations: "create_prorations";
        always_invoice: "always_invoice";
    }>>;
}, z.core.$strip>;
export declare const ChangeIntervalSchema: z.ZodObject<{
    interval: z.ZodEnum<typeof BillingInterval>;
}, z.core.$strip>;
export declare const PreviewChangeSchema: z.ZodObject<{
    newPlanId: z.ZodString;
}, z.core.$strip>;
export declare const CancelSubscriptionSchema: z.ZodObject<{
    reason: z.ZodOptional<z.ZodString>;
    immediate: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>;
export declare const ApplyCouponSchema: z.ZodObject<{
    code: z.ZodString;
}, z.core.$strip>;
export declare const CheckoutSessionSchema: z.ZodObject<{
    planId: z.ZodString;
}, z.core.$strip>;
export type CreateSubscriptionBody = z.infer<typeof CreateSubscriptionSchema>;
export type ChangePlanBody = z.infer<typeof ChangePlanSchema>;
export type CancelSubscriptionBody = z.infer<typeof CancelSubscriptionSchema>;
export type ApplyCouponBody = z.infer<typeof ApplyCouponSchema>;
//# sourceMappingURL=schemas.d.ts.map