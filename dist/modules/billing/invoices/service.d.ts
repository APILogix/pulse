import { InvoicesRepository } from './repository.js';
import { InvoiceStatus } from '../shared/types.js';
export declare class InvoicesService {
    private readonly repository;
    constructor(repository: InvoicesRepository);
    listInvoices(orgId: string, page?: number, limit?: number, status?: InvoiceStatus): Promise<{
        success: boolean;
        data: import("./repository.js").InvoiceRow[];
        meta: {
            page: number;
            limit: number;
            total: number;
            hasMore: boolean;
        };
    }>;
    getInvoice(orgId: string, invoiceId: string): Promise<{
        success: boolean;
        data: import("./repository.js").InvoiceRow;
    }>;
    getUpcomingInvoice(orgId: string): Promise<{
        success: boolean;
        data: Record<string, unknown>;
    }>;
    payInvoice(orgId: string, invoiceId: string, paymentMethodId?: string): Promise<{
        success: boolean;
        data: {
            invoice: import("./repository.js").InvoiceRow;
            payment: null;
            status: string;
        };
    } | {
        success: boolean;
        data: {
            status: string;
            invoice: import("./repository.js").InvoiceRow;
            payment: {
                id: string;
                status: import("../shared/types.js").PaymentStatus;
                amount: number;
                currency: string;
                payment_method: string | null;
                payment_method_last4: string | null;
            };
        };
    }>;
}
//# sourceMappingURL=service.d.ts.map