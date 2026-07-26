import { PaymentsRepository } from './repository.js';
import { PaymentStatus } from '../shared/types.js';
import { BillingError, BillingErrorCodes } from '../shared/errors.js';

export class PaymentsService {
  constructor(private readonly repository: PaymentsRepository) {}

  async listPayments(orgId: string, page: number = 1, limit: number = 20, status?: PaymentStatus) {
    const offset = (page - 1) * limit;
    const { data, total } = await this.repository.listPayments(orgId, { ...(status ? { status } : {}), limit, offset });
    
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

  async refundPayment(orgId: string, paymentId: string, amount?: number, reason?: string) {
    return this.repository.withTransaction(async (client) => {
      const payment = await this.repository.getPaymentForUpdate(orgId, paymentId, client);
      if (!payment) {
        throw new BillingError('Payment not found', BillingErrorCodes.PROVIDER_ERROR, 404);
      }
      if (payment.status !== PaymentStatus.SUCCEEDED && payment.status !== PaymentStatus.REFUNDED) {
        throw new BillingError('Payment cannot be refunded in its current status', BillingErrorCodes.PROVIDER_ERROR, 400);
      }

      const remainingRefundable = Number(payment.amount) - Number(payment.refunded_amount);
      if (remainingRefundable <= 0) {
        return { success: true, data: payment };
      }

      const refundAmount = amount ?? remainingRefundable;
      if (refundAmount > remainingRefundable) {
        throw new BillingError('Refund amount exceeds remaining refundable amount', BillingErrorCodes.PROVIDER_ERROR, 400, {
          remainingRefundable,
        });
      }

      const refunded = await this.repository.refundPayment(payment, refundAmount, reason, client);
      return { success: true, data: refunded };
    });
  }
}
