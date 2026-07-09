import type { Pool, PoolClient } from 'pg';
import { InvoiceStatus } from '../shared/types.js';
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
export declare class InvoicesRepository {
    private readonly db;
    constructor(db?: Pool);
    listInvoices(orgId: string, options: {
        status?: InvoiceStatus;
        limit: number;
        offset: number;
    }, db?: Db): Promise<{
        data: InvoiceRow[];
        total: number;
    }>;
    getInvoiceById(orgId: string, invoiceId: string, db?: Db): Promise<InvoiceRow | null>;
}
export {};
//# sourceMappingURL=repository.d.ts.map