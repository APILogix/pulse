import { z } from 'zod';
import { BillingInterval, BillingUuidSchema } from '../shared/types.js';

export const CreateSubscriptionSchema = z.object({
  planId: BillingUuidSchema,
  paymentMethodId: z.string().trim().min(1).max(200).optional(),
  billingInterval: z.nativeEnum(BillingInterval).optional(),
  couponCode: z.string().trim().min(3).max(30).optional(),
});

export const ChangePlanSchema = z.object({
  planId: BillingUuidSchema,
  prorationBehavior: z.enum(['create_prorations', 'none', 'always_invoice']).optional(),
});

export const ChangeIntervalSchema = z.object({
  interval: z.nativeEnum(BillingInterval),
});

export const PreviewChangeSchema = z.object({
  newPlanId: BillingUuidSchema,
});

export const CancelSubscriptionSchema = z.object({
  reason: z.string().trim().max(500).optional(),
  immediate: z.boolean().optional(),
});

export const ApplyCouponSchema = z.object({
  code: z.string().trim().min(3).max(30),
});

export const CheckoutSessionSchema = z.object({
  planId: BillingUuidSchema,
});

export type CreateSubscriptionBody = z.infer<typeof CreateSubscriptionSchema>;
export type ChangePlanBody = z.infer<typeof ChangePlanSchema>;
export type CancelSubscriptionBody = z.infer<typeof CancelSubscriptionSchema>;
export type ApplyCouponBody = z.infer<typeof ApplyCouponSchema>;
