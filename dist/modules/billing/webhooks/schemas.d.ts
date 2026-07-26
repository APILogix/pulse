import { z } from 'zod';
import { BillingProvider } from '../shared/types.js';
export declare const WebhookEventParamsSchema: z.ZodObject<{
    eventId: z.ZodString;
}, z.core.$strip>;
export declare const ListWebhookEventsQuerySchema: z.ZodObject<{
    provider: z.ZodOptional<z.ZodEnum<typeof BillingProvider>>;
    status: z.ZodOptional<z.ZodEnum<{
        processing: "processing";
        failed: "failed";
        received: "received";
        processed: "processed";
        ignored: "ignored";
        dead_letter: "dead_letter";
    }>>;
    page: z.ZodDefault<z.ZodOptional<z.ZodCoercedNumber<unknown>>>;
    limit: z.ZodDefault<z.ZodOptional<z.ZodCoercedNumber<unknown>>>;
}, z.core.$strip>;
export type WebhookEventParams = z.infer<typeof WebhookEventParamsSchema>;
export type ListWebhookEventsQuery = z.infer<typeof ListWebhookEventsQuerySchema>;
//# sourceMappingURL=schemas.d.ts.map