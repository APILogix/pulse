import { z } from 'zod';
import { InvoiceStatus } from '../shared/types.js';
export declare const InvoiceParamsSchema: z.ZodObject<{
    invoiceId: z.ZodString;
}, z.core.$strip>;
export declare const ListInvoicesQuerySchema: z.ZodObject<{
    status: z.ZodOptional<z.ZodEnum<typeof InvoiceStatus>>;
    page: z.ZodDefault<z.ZodOptional<z.ZodCoercedNumber<unknown>>>;
    limit: z.ZodDefault<z.ZodOptional<z.ZodCoercedNumber<unknown>>>;
}, z.core.$strip>;
export declare const PayInvoiceSchema: z.ZodObject<{
    paymentMethodId: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type InvoiceParams = z.infer<typeof InvoiceParamsSchema>;
export type ListInvoicesQuery = z.infer<typeof ListInvoicesQuerySchema>;
export type PayInvoiceBody = z.infer<typeof PayInvoiceSchema>;
//# sourceMappingURL=schemas.d.ts.map