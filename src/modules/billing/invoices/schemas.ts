import { z } from 'zod';
import { InvoiceStatus, PaginationSchema, BillingUuidSchema } from '../shared/types.js';

export const InvoiceParamsSchema = z.object({
  invoiceId: BillingUuidSchema
});

export const ListInvoicesQuerySchema = z.object({
  status: z.nativeEnum(InvoiceStatus).optional(),
}).merge(PaginationSchema);

export const PayInvoiceSchema = z.object({
  paymentMethodId: z.string().trim().min(1).max(200).optional(),
});

export type InvoiceParams = z.infer<typeof InvoiceParamsSchema>;
export type ListInvoicesQuery = z.infer<typeof ListInvoicesQuerySchema>;
export type PayInvoiceBody = z.infer<typeof PayInvoiceSchema>;
