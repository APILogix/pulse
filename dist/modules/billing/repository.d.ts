import type { Pool, PoolClient } from 'pg';
import { InvoiceStatus, PlanTier, UsageMetricType } from './types.js';
import type { BillingPlan, Coupon, Invoice, OrganizationBilling, PaymentMethod, QuotaRequest, UsageCounter, UsageRecord } from './types.js';
type Db = Pool | PoolClient;
export declare class BillingRepository {
    private readonly db;
    constructor(db?: Pool);
    withTransaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T>;
    getAllPlans(includeHidden?: boolean): Promise<BillingPlan[]>;
    getPlanById(planId: string, db?: Db): Promise<BillingPlan | null>;
    getPlanByTier(tier: PlanTier, db?: Db): Promise<BillingPlan | null>;
    getOrganizationBilling(orgId: string, db?: Db): Promise<OrganizationBilling | null>;
    getOrganizationBillingForUpdate(orgId: string, db: PoolClient): Promise<OrganizationBilling | null>;
    createOrganizationBilling(billing: Partial<OrganizationBilling>, db?: Db): Promise<OrganizationBilling>;
    updateOrganizationBilling(orgId: string, updates: Partial<OrganizationBilling>, db?: Db): Promise<OrganizationBilling>;
    createSubscriptionEvent(event: {
        orgId: string;
        subscriptionId: string;
        eventType: string;
        oldPlanId?: string | null;
        newPlanId?: string | null;
        actor: 'user' | 'system' | 'admin' | 'webhook';
        metadata?: Record<string, unknown>;
    }, db?: Db): Promise<void>;
    listSubscriptionEvents(orgId: string): Promise<Array<Record<string, unknown>>>;
    getInvoices(orgId: string, options?: {
        status?: InvoiceStatus;
        limit?: number;
        offset?: number;
        startDate?: Date;
        endDate?: Date;
    }): Promise<{
        invoices: Invoice[];
        total: number;
    }>;
    getInvoiceById(id: string, orgId: string): Promise<Invoice | null>;
    createInvoice(invoice: Partial<Invoice>, db?: Db): Promise<Invoice>;
    updateInvoiceStatus(id: string, status: InvoiceStatus, paymentDetails?: {
        paidAt: Date;
        paymentIntentId: string;
        amountPaid: number;
    }, db?: Db): Promise<Invoice>;
    getUpcomingInvoice(orgId: string): Promise<Partial<Invoice> | null>;
    getUsageRecords(orgId: string, options?: {
        startDate?: Date;
        endDate?: Date;
        granularity?: 'hourly' | 'daily' | 'monthly';
        metricType?: UsageMetricType;
    }): Promise<UsageRecord[]>;
    getUsageCounter(orgId: string): Promise<UsageCounter | null>;
    getCouponByCode(code: string, db?: Db): Promise<Coupon | null>;
    redeemCoupon(couponId: string, orgId: string, db?: Db): Promise<void>;
    incrementCouponUsage(code: string, db?: Db): Promise<void>;
    createQuotaRequest(request: Partial<QuotaRequest>): Promise<QuotaRequest>;
    getQuotaRequests(orgId: string): Promise<QuotaRequest[]>;
    getPaymentMethods(_orgId: string): Promise<PaymentMethod[]>;
    getPaymentMethodById(_id: string, _orgId: string): Promise<PaymentMethod | null>;
    createPaymentMethod(paymentMethod: Partial<PaymentMethod>): Promise<PaymentMethod>;
    setDefaultPaymentMethod(_orgId: string, _paymentMethodId: string): Promise<void>;
    updatePaymentMethod(_id: string, orgId: string, updates: Partial<PaymentMethod>): Promise<PaymentMethod>;
    deletePaymentMethod(_id: string, _orgId: string): Promise<void>;
}
export {};
//# sourceMappingURL=repository.d.ts.map