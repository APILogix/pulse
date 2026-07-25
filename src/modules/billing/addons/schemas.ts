import { z } from 'zod';
import { PaginationSchema } from '../shared/types.js';

export const ListAddonsQuerySchema = PaginationSchema.extend({
  billingInterval: z.enum(['monthly', 'annual']).optional(),
  tier: z.enum(['free', 'starter', 'growth', 'business', 'enterprise']).optional(),
});

export const SubscribeAddonSchema = z.object({
  addonId: z.string().uuid(),
  quantity: z.coerce.number().int().positive().max(100_000).default(1),
  metadata: z.record(z.string(), z.unknown()).optional().default({}),
});

export const SubscriptionAddonParamsSchema = z.object({
  subscriptionAddonId: z.string().uuid(),
});

export type ListAddonsQuery = z.infer<typeof ListAddonsQuerySchema>;
export type SubscribeAddonBody = z.infer<typeof SubscribeAddonSchema>;
