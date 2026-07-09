import { CouponsRepository } from './repository.js';
export declare class CouponsService {
    private readonly repository;
    constructor(repository: CouponsRepository);
    validateCoupon(code: string, orgId: string, planId: string): Promise<{
        success: boolean;
        data: import("./repository.js").CouponRow;
    }>;
    applyCoupon(code: string, orgId: string, planId: string, userId: string): Promise<{
        success: boolean;
        data: import("./repository.js").CouponRow;
    }>;
}
//# sourceMappingURL=service.d.ts.map