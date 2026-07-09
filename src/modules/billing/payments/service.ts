import { PaymentsRepository } from './repository.js';
import { PaymentStatus } from '../shared/types.js';

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
}
