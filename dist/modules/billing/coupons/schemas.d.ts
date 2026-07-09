import { z } from 'zod';
export declare const ApplyCouponSchema: z.ZodObject<{
    code: z.ZodString;
}, z.core.$strip>;
export declare const ValidateCouponSchema: z.ZodObject<{
    code: z.ZodString;
    planId: z.ZodString;
}, z.core.$strip>;
export type ApplyCouponBody = z.infer<typeof ApplyCouponSchema>;
export type ValidateCouponQuery = z.infer<typeof ValidateCouponSchema>;
//# sourceMappingURL=schemas.d.ts.map