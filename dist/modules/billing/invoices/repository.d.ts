import type { Pool, PoolClient } from 'pg';
import { BillingProvider, InvoiceStatus, PaymentStatus } from '../shared/types.js';
type Db = Pool | PoolClient;
export interface InvoiceRow {
    id: string;
    organization_id: string;
    subscription_id: string | null;
    provider: string;
    provider_invoice_id: string | null;
    invoice_number: string;
    status: InvoiceStatus;
    currency: string;
    subtotal_amount: number;
    tax_amount: number;
    discount_amount: number;
    total_amount: number;
    amount_paid: number;
    period_start: Date;
    period_end: Date;
    due_at: Date | null;
    paid_at: Date | null;
    pdf_url: string | null;
    created_at: Date;
}
export interface PaymentMethodRow {
    id: string;
    provider: BillingProvider;
    type: string;
    last4: string | null;
    brand: string | null;
    is_default: boolean;
}
export interface InvoicePaymentResult {
    invoice: InvoiceRow;
    payment: {
        id: string;
        status: PaymentStatus;
        amount: number;
        currency: string;
        payment_method: string | null;
        payment_method_last4: string | null;
    };
}
export declare const INVOICE_COLUMNS = "\n  id, organization_id, subscription_id, provider, provider_invoice_id, invoice_number,\n  status, currency, subtotal_amount, tax_amount, discount_amount, total_amount,\n  amount_paid, period_start, period_end, due_at, paid_at, pdf_url, created_at\n";
export declare class InvoicesRepository {
    private readonly db;
    constructor(db?: Pool);
    withTransaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T>;
    listInvoices(orgId: string, options: {
        status?: InvoiceStatus;
        limit: number;
        offset: number;
    }, db?: Db): Promise<{
        data: InvoiceRow[];
        total: number;
    }>;
    getInvoiceById(orgId: string, invoiceId: string, db?: Db): Promise<InvoiceRow | null>;
    getUpcomingInvoicePreview(orgId: string, db?: Db): Promise<Record<string, unknown> | null>;
    getInvoiceByIdForUpdate(orgId: string, invoiceId: string, db: PoolClient): Promise<InvoiceRow | null>;
    getPaymentMethod(orgId: string, paymentMethodId: string | undefined, db?: Db): Promise<PaymentMethodRow | null>;
    collectInvoicePayment(invoice: InvoiceRow, paymentMethod: PaymentMethodRow, amountDue: number, db: PoolClient): Promise<InvoicePaymentResult>;
}
export {};
//# sourceMappingURL=repository.d.ts.map