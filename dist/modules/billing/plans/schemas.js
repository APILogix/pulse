import { z } from 'zod';
import { BillingInterval, BillingUuidSchema } from '../shared/types.js';
export const PlanIdParamsSchema = z.object({
    planId: BillingUuidSchema
});
export const EstimatePricingSchema = z.object({
    planId: BillingUuidSchema,
    interval: z.nativeEnum(BillingInterval),
    couponCode: z.string().trim().min(3).max(30).optional()
});
//# sourceMappingURL=schemas.js.map