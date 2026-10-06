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
export interface CouponSubscriptionRow {
    id: string;
    plan_id: string;
    billing_interval: string;
    status: string;
}
export interface PlanPriceRow {
    amount_minor: number;
    currency: string;
}
export declare const COUPON_COLUMNS = "\n  id, code, name, description, discount_type, discount_value, currency,\n  max_redemptions, redemption_count, max_redemptions_per_org,\n  first_time_customers_only, trial_only, valid_from, valid_until,\n  is_active, is_public\n";
export declare class CouponsRepository {
    private readonly db;
    constructor(db?: Pool);
    withTransaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T>;
    getCouponByCode(code: string, db?: Db): Promise<CouponRow | null>;
    getCouponByCodeForUpdate(code: string, db: PoolClient): Promise<CouponRow | null>;
    isCouponApplicableToPlan(couponId: string, planId: string, db?: Db): Promise<boolean>;
    getActiveSubscriptionForCoupon(orgId: string, db?: Db): Promise<CouponSubscriptionRow | null>;
    getCurrentPlanPrice(planId: string, billingInterval: string, currency?: string | null, db?: Db): Promise<PlanPriceRow | null>;
    getOrgRedemptionCount(couponId: string, orgId: string, db?: Db): Promise<number>;
    redeemCoupon(couponId: string, orgId: string, userId: string, subscriptionId: string, discountAmount: number, currency: string, db?: Db): Promise<void>;
}
export {};
//# sourceMappingURL=repository.d.ts.map