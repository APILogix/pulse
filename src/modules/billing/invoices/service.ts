import { InvoicesRepository } from './repository.js';
import { BillingError, BillingErrorCodes } from '../shared/errors.js';
import { InvoiceStatus } from '../shared/types.js';

export class InvoicesService {
  constructor(private readonly repository: InvoicesRepository) {}

  async listInvoices(orgId: string, page: number = 1, limit: number = 20, status?: InvoiceStatus) {
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

  async getInvoice(orgId: string, invoiceId: string) {
    const invoice = await this.repository.getInvoiceById(orgId, invoiceId);
    if (!invoice) {
      throw new BillingError('Invoice not found', BillingErrorCodes.INVOICE_NOT_FOUND, 404);
    }
    return { success: true, data: invoice };
  }

  async getUpcomingInvoice(orgId: string) {
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

  async payInvoice(orgId: string, invoiceId: string, paymentMethodId?: string) {
    return this.repository.withTransaction(async (client) => {
      const invoice = await this.repository.getInvoiceByIdForUpdate(orgId, invoiceId, client);
      if (!invoice) {
        throw new BillingError('Invoice not found', BillingErrorCodes.INVOICE_NOT_FOUND, 404);
      }

      if (invoice.status === InvoiceStatus.PAID) {
        return { success: true, data: { invoice, payment: null, status: 'paid' } };
      }

      if (invoice.status !== InvoiceStatus.OPEN && invoice.status !== InvoiceStatus.DRAFT) {
        throw new BillingError('Invoice cannot be paid in its current status', BillingErrorCodes.INTERNAL_ERROR, 400);
      }

      const amountDue = Math.max(0, Number(invoice.total_amount) - Number(invoice.amount_paid));
      if (amountDue === 0) {
        return { success: true, data: { invoice, payment: null, status: 'paid' } };
      }

      const paymentMethod = await this.repository.getPaymentMethod(orgId, paymentMethodId, client);
      if (!paymentMethod) {
        throw new BillingError('Payment method not found', BillingErrorCodes.PAYMENT_METHOD_NOT_FOUND, 404);
      }

      const result = await this.repository.collectInvoicePayment(invoice, paymentMethod, amountDue, client);
      return { success: true, data: { ...result, status: 'paid' } };
    });
  }
}
