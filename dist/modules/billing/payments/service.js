import { PaymentsRepository } from './repository.js';
import { PaymentStatus } from '../shared/types.js';
export class PaymentsService {
    repository;
    constructor(repository) {
        this.repository = repository;
    }
    async listPayments(orgId, page = 1, limit = 20, status) {
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
//# sourceMappingURL=service.js.map