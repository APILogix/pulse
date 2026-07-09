import { z } from 'zod';
import { BillingUuidSchema } from '../shared/types.js';
export const ApplyCouponSchema = z.object({
    code: z.string().trim().min(3).max(50),
});
export const ValidateCouponSchema = z.object({
    code: z.string().trim().min(3).max(50),
    planId: BillingUuidSchema,
});
//# sourceMappingURL=schemas.js.map