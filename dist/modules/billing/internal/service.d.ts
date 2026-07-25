import { InternalBillingRepository } from './repository.js';
import type { AiCreditUsageBody, CouponRedeemBody, CouponValidateBody, EventUsageBody, InvoiceFinalizeBody, InvoiceGenerateBody, PaymentReconcileBody, ResourceUsageBody } from './schemas.js';
export declare class InternalBillingService {
    private readonly repository;
    constructor(repository: InternalBillingRepository);
    getEntitlements(orgId: string): Promise<any>;
    getFeature(orgId: string, featureKey: string): Promise<{
        featureKey: string;
        value: null;
        enabled: boolean;
        module?: never;
        valueType?: never;
    } | {
        featureKey: string;
        value: any;
        enabled: boolean;
        module: any;
        valueType: any;
    }>;
    getLimit(orgId: string, featureKey: string): Promise<{
        featureKey: string;
        limit: number;
    }>;
    consumeEvents(body: EventUsageBody): Promise<{
        accepted: boolean;
        remaining: number;
        overage: boolean;
        code: "BILLING_004";
        overageEvents?: never;
    } | {
        accepted: boolean;
        remaining: number;
        overage: boolean;
        overageEvents: number;
        code: "BILLING_005" | undefined;
    }>;
    consumeAiCredits(body: AiCreditUsageBody): Promise<{
        accepted: boolean;
        remaining: number;
        code: "BILLING_004";
    } | {
        accepted: boolean;
        remaining: number;
        code?: never;
    }>;
    adjustResource(body: ResourceUsageBody, direction: 1 | -1): Promise<{
        resourceType: "projects" | "members" | "apiKeys" | "connectors" | "alertRules" | "dashboards";
        used: number;
        limit: number;
        remaining: number;
    }>;
    getEventQuota(orgId: string): Promise<{
        limit: number;
        used: number;
        remaining: number;
        overageEvents: number;
    }>;
    getAiCreditQuota(orgId: string): Promise<{
        limit: number;
        used: number;
        remaining: number;
        overageAiCredits: number;
    }>;
    checkEventQuota(orgId: string, requestedCount: number): Promise<{
        allowed: boolean;
        remaining: number;
        wouldOverage: boolean;
    }>;
    syncSubscription(orgId: string): Promise<{
        synced: boolean;
        reason: string;
        status: any;
    }>;
    getSubscriptionStatus(orgId: string): Promise<{
        status: any;
        planKey: any;
        trial: boolean;
        trialStart: any;
        trialEnd: any;
        cancelAtPeriodEnd: any;
    }>;
    generateInvoice(body: InvoiceGenerateBody): Promise<any>;
    finalizeInvoice(body: InvoiceFinalizeBody): Promise<any>;
    reconcilePayments(body: PaymentReconcileBody): Promise<{
        reconciled: number;
        paymentIds: any[];
    }>;
    validateCoupon(body: CouponValidateBody): Promise<{
        valid: boolean;
        couponId: any;
        code: any;
        discountType: any;
        discountValue: any;
        currency: any;
    }>;
    redeemCoupon(body: CouponRedeemBody): Promise<any>;
}
//# sourceMappingURL=service.d.ts.map