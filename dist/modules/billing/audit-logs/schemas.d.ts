import { z } from 'zod';
export declare const ListBillingAuditLogsQuerySchema: z.ZodObject<{
    action: z.ZodOptional<z.ZodString>;
    subscriptionId: z.ZodOptional<z.ZodString>;
    invoiceId: z.ZodOptional<z.ZodString>;
    paymentId: z.ZodOptional<z.ZodString>;
    startDate: z.ZodOptional<z.ZodString>;
    endDate: z.ZodOptional<z.ZodString>;
    page: z.ZodDefault<z.ZodOptional<z.ZodCoercedNumber<unknown>>>;
    limit: z.ZodDefault<z.ZodOptional<z.ZodCoercedNumber<unknown>>>;
}, z.core.$strip>;
export type ListBillingAuditLogsQuery = z.infer<typeof ListBillingAuditLogsQuerySchema>;
//# sourceMappingURL=schemas.d.ts.map