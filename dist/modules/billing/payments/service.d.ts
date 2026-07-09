import { PaymentsRepository } from './repository.js';
import { PaymentStatus } from '../shared/types.js';
export declare class PaymentsService {
    private readonly repository;
    constructor(repository: PaymentsRepository);
    listPayments(orgId: string, page?: number, limit?: number, status?: PaymentStatus): Promise<{
        success: boolean;
        data: import("./repository.js").PaymentRow[];
        meta: {
            page: number;
            limit: number;
            total: number;
            hasMore: boolean;
        };
    }>;
}
//# sourceMappingURL=service.d.ts.map