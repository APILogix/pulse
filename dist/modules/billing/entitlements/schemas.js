import { z } from 'zod';
import { BillingUuidSchema } from '../shared/types.js';
export const FeatureKeyParamsSchema = z.object({
    featureKey: z.string().trim().min(1).max(100)
});
export const CheckFeatureAccessSchema = z.object({
    featureKey: z.string().trim().min(1).max(100),
    quantity: z.number().int().min(1).optional()
});
//# sourceMappingURL=schemas.js.map