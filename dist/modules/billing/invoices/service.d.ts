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
        data: {
            organization_id: string;
            status: InvoiceStatus;
            subtotal_amount: number;
            total_amount: number;
            currency: string;
        };
    }>;
    payInvoice(orgId: string, invoiceId: string, paymentMethodId?: string): Promise<{
        success: boolean;
        data: {
            status: string;
        };
    }>;
}
//# sourceMappingURL=service.d.ts.map