import type { Pool, PoolClient } from 'pg';
import { CouponDiscountType } from '../shared/types.js';
type Db = Pool | PoolClient;
export interface CouponRow {
    id: string;
    code: string;
    name: string;
    description: string | null;
    discount_type: CouponDiscountType;
    discount_value: number;
    currency: string | null;
    max_redemptions: number | null;
    redemption_count: number;
    max_redemptions_per_org: number;
    first_time_customers_only: boolean;
    trial_only: boolean;
    valid_from: Date;
    valid_until: Date | null;
    is_active: boolean;
    is_public: boolean;
}
export declare class CouponsRepository {
    private readonly db;
    constructor(db?: Pool);
    withTransaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T>;
    getCouponByCode(code: string, db?: Db): Promise<CouponRow | null>;
    getCouponByCodeForUpdate(code: string, db: PoolClient): Promise<CouponRow | null>;
    isCouponApplicableToPlan(couponId: string, planId: string, db?: Db): Promise<boolean>;
    getOrgRedemptionCount(couponId: string, orgId: string, db?: Db): Promise<number>;
    redeemCoupon(couponId: string, orgId: string, userId: string, discountAmount: number, currency: string, db?: Db): Promise<void>;
}
export {};
//# sourceMappingURL=repository.d.ts.map