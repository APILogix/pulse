import { z } from 'zod';
import { PaginationSchema } from '../shared/types.js';

export const PaymentMethodTypeSchema = z.enum(['card', 'bank_transfer', 'upi', 'wallet']);
export const BillingProviderSchema = z.enum(['stripe', 'razorpay', 'manual', 'system']);

export const ListPaymentMethodsQuerySchema = PaginationSchema.extend({
  includeInactive: z.coerce.boolean().optional().default(false),
});

export const CreatePaymentMethodSchema = z.object({
  provider: BillingProviderSchema,
  providerPaymentMethodId: z.string().trim().min(1).max(150),
  type: PaymentMethodTypeSchema,
  last4: z.string().trim().max(10).optional(),
  brand: z.string().trim().max(50).optional(),
  expiryMonth: z.coerce.number().int().min(1).max(12).optional(),
  expiryYear: z.coerce.number().int().min(2020).max(2200).optional(),
  isDefault: z.coerce.boolean().optional().default(false),
  billingDetails: z.record(z.string(), z.unknown()).optional().default({}),
  metadata: z.record(z.string(), z.unknown()).optional().default({}),
});

export const PaymentMethodParamsSchema = z.object({
  paymentMethodId: z.string().uuid(),
});

export type ListPaymentMethodsQuery = z.infer<typeof ListPaymentMethodsQuerySchema>;
export type CreatePaymentMethodBody = z.infer<typeof CreatePaymentMethodSchema>;
