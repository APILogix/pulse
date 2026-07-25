import type { Pool, PoolClient } from 'pg';
import type { AiCreditUsageBody, CouponRedeemBody, CouponValidateBody, EventUsageBody, InvoiceGenerateBody, InvoiceFinalizeBody, PaymentReconcileBody, ResourceUsageBody } from './schemas.js';
type Db = Pool | PoolClient;
export declare class InternalBillingRepository {
    private readonly db;
    constructor(db?: Pool);
    withTransaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T>;
    getResolvedEntitlements(orgId: string, db?: Db): Promise<any[]>;
    getFeatureValue(orgId: string, featureKey: string, db?: Db): Promise<any>;
    getCurrentUsageForUpdate(orgId: string, db: PoolClient): Promise<any>;
    getCurrentUsage(orgId: string, db?: Db): Promise<any>;
    incrementEventUsage(body: EventUsageBody, acceptedCount: number, overageCount: number, db: PoolClient): Promise<void>;
    incrementAiCredits(body: AiCreditUsageBody, db: PoolClient): Promise<void>;
    adjustResourceUsage(body: ResourceUsageBody, direction: 1 | -1, db: PoolClient): Promise<any>;
    getSubscriptionStatus(orgId: string, db?: Db): Promise<any>;
    generateInvoice(body: InvoiceGenerateBody, db: PoolClient): Promise<any>;
    finalizeInvoice(body: InvoiceFinalizeBody, db: PoolClient): Promise<any>;
    reconcilePayments(body: PaymentReconcileBody, db: PoolClient): Promise<{
        reconciled: number;
        paymentIds: any[];
    }>;
    validateCoupon(body: CouponValidateBody, db?: Db): Promise<any>;
    redeemCoupon(body: CouponRedeemBody, discountAmount: number, currency: string | null, db: PoolClient): Promise<{
        alreadyRedeemed: boolean;
        coupon: any;
        redemption?: never;
    } | {
        alreadyRedeemed: boolean;
        coupon: any;
        redemption: any;
    } | null>;
}
export {};
//# sourceMappingURL=repository.d.ts.map