import { PaymentMethodsRepository } from './repository.js';
import type { CreatePaymentMethodBody } from './schemas.js';
export declare class PaymentMethodsService {
    private readonly repository;
    constructor(repository: PaymentMethodsRepository);
    listPaymentMethods(orgId: string, page?: number, limit?: number, includeInactive?: boolean): Promise<{
        success: boolean;
        data: import("./repository.js").PaymentMethodRow[];
        meta: {
            page: number;
            limit: number;
            total: number;
            hasMore: boolean;
        };
    }>;
    createPaymentMethod(orgId: string, body: CreatePaymentMethodBody): Promise<{
        success: boolean;
        data: import("./repository.js").PaymentMethodRow;
    }>;
    setDefaultPaymentMethod(orgId: string, paymentMethodId: string): Promise<{
        success: boolean;
        data: import("./repository.js").PaymentMethodRow;
    }>;
    deactivatePaymentMethod(orgId: string, paymentMethodId: string): Promise<{
        success: boolean;
        data: import("./repository.js").PaymentMethodRow;
    }>;
}
//# sourceMappingURL=service.d.ts.map