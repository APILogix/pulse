import { z } from 'zod';
export declare const FeatureKeyParamsSchema: z.ZodObject<{
    featureKey: z.ZodString;
}, z.core.$strip>;
export declare const CheckFeatureAccessSchema: z.ZodObject<{
    featureKey: z.ZodString;
    quantity: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
export type CheckFeatureAccessBody = z.infer<typeof CheckFeatureAccessSchema>;
//# sourceMappingURL=schemas.d.ts.map