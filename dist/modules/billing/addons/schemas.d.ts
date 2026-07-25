import { z } from 'zod';
export declare const ListAddonsQuerySchema: z.ZodObject<{
    page: z.ZodDefault<z.ZodOptional<z.ZodCoercedNumber<unknown>>>;
    limit: z.ZodDefault<z.ZodOptional<z.ZodCoercedNumber<unknown>>>;
    billingInterval: z.ZodOptional<z.ZodEnum<{
        monthly: "monthly";
        annual: "annual";
    }>>;
    tier: z.ZodOptional<z.ZodEnum<{
        enterprise: "enterprise";
        free: "free";
        starter: "starter";
        growth: "growth";
        business: "business";
    }>>;
}, z.core.$strip>;
export declare const SubscribeAddonSchema: z.ZodObject<{
    addonId: z.ZodString;
    quantity: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    metadata: z.ZodDefault<z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>>;
}, z.core.$strip>;
export declare const SubscriptionAddonParamsSchema: z.ZodObject<{
    subscriptionAddonId: z.ZodString;
}, z.core.$strip>;
export type ListAddonsQuery = z.infer<typeof ListAddonsQuerySchema>;
export type SubscribeAddonBody = z.infer<typeof SubscribeAddonSchema>;
//# sourceMappingURL=schemas.d.ts.map