import { z } from 'zod';
import { BillingProvider, BillingUuidSchema, PaginationSchema } from '../shared/types.js';
export const WebhookEventParamsSchema = z.object({
    eventId: BillingUuidSchema,
});
export const ListWebhookEventsQuerySchema = z.object({
    provider: z.nativeEnum(BillingProvider).optional(),
    status: z.enum(['received', 'processing', 'processed', 'failed', 'ignored', 'dead_letter']).optional(),
}).merge(PaginationSchema);
//# sourceMappingURL=schemas.js.map