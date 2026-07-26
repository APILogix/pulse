import { z } from 'zod';
import { InvoiceStatus, PaginationSchema, BillingUuidSchema } from '../shared/types.js';
export const InvoiceParamsSchema = z.object({
    invoiceId: BillingUuidSchema
});
export const ListInvoicesQuerySchema = z.object({
    status: z.nativeEnum(InvoiceStatus).optional(),
}).merge(PaginationSchema);
export const PayInvoiceSchema = z.object({
    paymentMethodId: BillingUuidSchema.optional(),
});
//# sourceMappingURL=schemas.js.map