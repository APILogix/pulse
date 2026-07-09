import { InvoicesRepository } from './repository.js';
import { BillingError, BillingErrorCodes } from '../shared/errors.js';
import { InvoiceStatus } from '../shared/types.js';
export class InvoicesService {
    repository;
    constructor(repository) {
        this.repository = repository;
    }
    async listInvoices(orgId, page = 1, limit = 20, status) {
        const offset = (page - 1) * limit;
        const { data, total } = await this.repository.listInvoices(orgId, { ...(status ? { status } : {}), limit, offset });
        return {
            success: true,
            data,
            meta: {
                page,
                limit,
                total,
                hasMore: offset + data.length < total
            }
        };
    }
    async getInvoice(orgId, invoiceId) {
        const invoice = await this.repository.getInvoiceById(orgId, invoiceId);
        if (!invoice) {
            throw new BillingError('Invoice not found', BillingErrorCodes.INVOICE_NOT_FOUND, 404);
        }
        return { success: true, data: invoice };
    }
    async getUpcomingInvoice(orgId) {
        // In a real system (like Stripe), we would ask Stripe to preview the next invoice.
        // Locally, we would calculate it based on the active subscription, price, and current unbilled usage.
        // For this rewrite, we will stub it to return a payload that matches the old behaviour.
        return {
            success: true,
            data: {
                organization_id: orgId,
                status: InvoiceStatus.DRAFT,
                subtotal_amount: 0,
                total_amount: 0,
                currency: 'USD'
            }
        };
    }
    async payInvoice(orgId, invoiceId, paymentMethodId) {
        const invoice = await this.repository.getInvoiceById(orgId, invoiceId);
        if (!invoice) {
            throw new BillingError('Invoice not found', BillingErrorCodes.INVOICE_NOT_FOUND, 404);
        }
        if (invoice.status !== InvoiceStatus.OPEN && invoice.status !== InvoiceStatus.DRAFT) {
            throw new BillingError('Invoice cannot be paid in its current status', BillingErrorCodes.INTERNAL_ERROR, 400);
        }
        // Ideally this delegates to the Payments Service.
        // For now, return a placeholder success or error.
        return { success: true, data: { status: 'processing' } };
    }
}
//# sourceMappingURL=service.js.map