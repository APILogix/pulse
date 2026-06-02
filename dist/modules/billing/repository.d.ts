/**
 * Billing repository.
 *
 * Flow:
 * 1. Read plan, subscription, payment method, invoice, usage, coupon, and quota
 *    data from PostgreSQL.
 * 2. Use optional PoolClient parameters so services can wrap related writes in
 *    transactions.
 * 3. Build dynamic UPDATE and filter queries from trusted internal field maps.
 * 4. Map database rows into billing module domain objects.
 */
import type { Pool, PoolClient } from 'pg';
import { PlanTier, SubscriptionStatus, InvoiceStatus, UsageMetricType } from './types.js';
import type { BillingPlan, OrganizationBilling, PaymentMethod, Invoice, UsageRecord, UsageCounter, QuotaRequest, Coupon } from "./types.js";
export declare class BillingRepository {
    private pool;
    constructor(poolInstance?: Pool);
    withTransaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T>;
    getAllPlans(includeHidden?: boolean): Promise<BillingPlan[]>;
    getPlanById(planId: string): Promise<BillingPlan | null>;
    getPlanByTier(tier: PlanTier): Promise<BillingPlan | null>;
    getOrganizationById(orgId: string): Promise<{
        id: string;
        name: string;
        slug: string;
        ownerUserId: string;
        billingEmail: string;
        billingName: string | null;
        billingAddress: Record<string, any> | null;
        planId: string;
        status: string;
        deletedAt: Date | null;
        createdAt: Date;
        updatedAt: Date;
    } | null>;
    getOrganizationMembership(orgId: string, userId: string): Promise<{
        role: string;
        permissions: Record<string, boolean> | null;
        isActive: boolean;
        joinedAt: Date | null;
    } | null>;
    updateOrganizationPlan(orgId: string, planId: string, client?: PoolClient): Promise<void>;
    updateOrganizationBillingProfile(orgId: string, updates: {
        billingEmail?: string;
        billingName?: string | null;
        billingAddress?: Record<string, any> | null;
    }, client?: PoolClient): Promise<void>;
    seedDefaultPlans(): Promise<void>;
    assertSchemaReady(): Promise<void>;
    private mapPlanFromDb;
    getOrganizationBilling(orgId: string): Promise<OrganizationBilling | null>;
    createOrganizationBilling(billing: Partial<OrganizationBilling>, client?: PoolClient): Promise<OrganizationBilling>;
    updateOrganizationBilling(orgId: string, updates: Partial<OrganizationBilling>, client?: PoolClient): Promise<OrganizationBilling>;
    updateSubscriptionStatus(orgId: string, status: SubscriptionStatus, client?: PoolClient): Promise<void>;
    private mapBillingFromDb;
    getPaymentMethods(orgId: string): Promise<PaymentMethod[]>;
    getPaymentMethodById(id: string, orgId: string): Promise<PaymentMethod | null>;
    getDefaultPaymentMethod(orgId: string): Promise<PaymentMethod | null>;
    createPaymentMethod(paymentMethod: Partial<PaymentMethod>, client?: PoolClient): Promise<PaymentMethod>;
    setDefaultPaymentMethod(orgId: string, paymentMethodId: string, client?: PoolClient): Promise<void>;
    updatePaymentMethod(id: string, orgId: string, updates: Partial<PaymentMethod>): Promise<PaymentMethod>;
    deletePaymentMethod(id: string, orgId: string): Promise<void>;
    private mapPaymentMethodFromDb;
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
    getInvoiceByNumber(invoiceNumber: string, orgId: string): Promise<Invoice | null>;
    createInvoice(invoice: Partial<Invoice>, client?: PoolClient): Promise<Invoice>;
    updateInvoiceStatus(id: string, status: InvoiceStatus, paymentDetails?: {
        paidAt: Date;
        paymentIntentId: string;
        amountPaid: number;
    }, client?: PoolClient): Promise<Invoice>;
    getUpcomingInvoice(orgId: string): Promise<Partial<Invoice> | null>;
    private mapInvoiceFromDb;
    recordUsage(usage: Partial<UsageRecord>, client?: PoolClient): Promise<UsageRecord>;
    getUsageRecords(orgId: string, options?: {
        metricType?: UsageMetricType | undefined;
        startDate?: Date | undefined;
        endDate?: Date | undefined;
        granularity?: 'hourly' | 'daily' | 'monthly' | undefined;
    }): Promise<UsageRecord[]>;
    getUsageCounter(orgId: string): Promise<UsageCounter | null>;
    incrementUsageCounter(orgId: string, metric: keyof Omit<UsageCounter, 'orgId' | 'currentPeriodStart' | 'lastUpdatedAt' | 'limitWarning80SentAt' | 'limitWarning100SentAt' | 'updatedAt'>, amount?: number, client?: PoolClient): Promise<void>;
    private mapUsageRecordFromDb;
    private mapUsageCounterFromDb;
    getCouponByCode(code: string): Promise<Coupon | null>;
    incrementCouponUsage(code: string, client?: PoolClient): Promise<void>;
    private mapCouponFromDb;
    createQuotaRequest(request: Partial<QuotaRequest>): Promise<QuotaRequest>;
    getQuotaRequests(orgId: string): Promise<QuotaRequest[]>;
    private mapQuotaRequestFromDb;
}
//# sourceMappingURL=repository.d.ts.map