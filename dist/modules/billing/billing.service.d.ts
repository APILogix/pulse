/**
 * Billing business service.
 *
 * Flow:
 * 1. Read pricing plans and billing state from BillingRepository.
 * 2. Enforce subscription lifecycle rules before creating, changing, canceling,
 *    or reactivating subscriptions.
 * 3. Calculate derived billing values such as discounts, proration, MRR, usage
 *    projections, and invoice totals.
 * 4. Return ServiceResponse envelopes that routes can send directly.
 *
 * Payment provider integrations are represented here as placeholders until the
 * provider clients are wired in.
 */
import { BillingRepository } from './repository.js';
import { BillingInterval, InvoiceStatus, UsageMetricType } from './types.js';
import type { BillingPlan, OrganizationBilling, PaymentMethod, Invoice, UsageRecord, UsageSummary, QuotaRequest, ServiceResponse, CreateSubscriptionBody, ChangePlanBody, CancelSubscriptionBody, AddPaymentMethodBody, UpdateBillingSettingsBody, QuotaIncreaseBody } from './types.js';
export declare class BillingService {
    private repository;
    private defaultCurrency;
    constructor(repository: BillingRepository);
    listPlans(): Promise<ServiceResponse<BillingPlan[]>>;
    getPlan(planId: string): Promise<ServiceResponse<BillingPlan>>;
    comparePlans(): Promise<ServiceResponse<any>>;
    estimatePricing(planId: string, interval: BillingInterval, couponCode?: string): Promise<ServiceResponse<any>>;
    getSubscription(orgId: string): Promise<ServiceResponse<OrganizationBilling>>;
    getSubscriptionHistory(orgId: string): Promise<ServiceResponse<Array<Record<string, unknown>>>>;
    createSubscription(orgId: string, body: CreateSubscriptionBody): Promise<ServiceResponse<OrganizationBilling>>;
    changePlan(orgId: string, body: ChangePlanBody): Promise<ServiceResponse<OrganizationBilling>>;
    cancelSubscription(orgId: string, body: CancelSubscriptionBody): Promise<ServiceResponse<OrganizationBilling>>;
    changeInterval(orgId: string, interval: BillingInterval): Promise<ServiceResponse<OrganizationBilling>>;
    reactivateSubscription(orgId: string): Promise<ServiceResponse<OrganizationBilling>>;
    previewProration(orgId: string, newPlanId: string): Promise<ServiceResponse<any>>;
    listPaymentMethods(orgId: string): Promise<ServiceResponse<PaymentMethod[]>>;
    addPaymentMethod(orgId: string, body: AddPaymentMethodBody): Promise<ServiceResponse<PaymentMethod>>;
    setDefaultPaymentMethod(orgId: string, paymentMethodId: string): Promise<ServiceResponse<void>>;
    updatePaymentMethod(id: string, orgId: string, updates: Partial<PaymentMethod>): Promise<ServiceResponse<PaymentMethod>>;
    removePaymentMethod(id: string, orgId: string): Promise<ServiceResponse<void>>;
    verifyPaymentMethod(id: string, orgId: string): Promise<ServiceResponse<void>>;
    listInvoices(orgId: string, options: {
        status?: InvoiceStatus;
        limit?: number;
        offset?: number;
        startDate?: Date;
        endDate?: Date;
    }): Promise<ServiceResponse<{
        invoices: Invoice[];
        total: number;
    }>>;
    getInvoice(id: string, orgId: string): Promise<ServiceResponse<Invoice>>;
    downloadInvoicePdf(id: string, orgId: string): Promise<ServiceResponse<string>>;
    payInvoice(id: string, orgId: string): Promise<ServiceResponse<Invoice>>;
    getUpcomingInvoice(orgId: string): Promise<ServiceResponse<Partial<Invoice>>>;
    getCurrentUsage(orgId: string): Promise<ServiceResponse<UsageSummary>>;
    getDetailedUsage(orgId: string, params: {
        startDate?: string;
        endDate?: string;
        granularity?: 'hourly' | 'daily' | 'monthly';
    }): Promise<ServiceResponse<UsageRecord[]>>;
    getUsageHistory(orgId: string, metricType: UsageMetricType, days?: number): Promise<ServiceResponse<{
        date: Date;
        value: number;
    }[]>>;
    getUsageForecast(orgId: string): Promise<ServiceResponse<any>>;
    exportUsageReport(orgId: string, format?: 'csv' | 'json'): Promise<ServiceResponse<string>>;
    getQuotaStatus(orgId: string): Promise<ServiceResponse<any>>;
    getQuotaDetails(orgId: string, type: UsageMetricType): Promise<ServiceResponse<any>>;
    requestQuotaIncrease(orgId: string, type: UsageMetricType, body: QuotaIncreaseBody): Promise<ServiceResponse<QuotaRequest>>;
    listQuotaRequests(orgId: string): Promise<ServiceResponse<QuotaRequest[]>>;
    getBillingSettings(orgId: string): Promise<ServiceResponse<any>>;
    updateBillingSettings(orgId: string, body: UpdateBillingSettingsBody): Promise<ServiceResponse<any>>;
    updateBillingEmail(orgId: string, email: string): Promise<ServiceResponse<any>>;
    updateBillingAddress(orgId: string, address: any): Promise<ServiceResponse<any>>;
    updateTaxSettings(orgId: string, taxId: string): Promise<ServiceResponse<any>>;
    applyCoupon(orgId: string, code: string): Promise<ServiceResponse<any>>;
    removeCoupon(orgId: string): Promise<ServiceResponse<any>>;
    validateCoupon(code: string): Promise<ServiceResponse<any>>;
    listPromotions(): Promise<ServiceResponse<any>>;
    handleStripeWebhook(payload: any, signature: string): Promise<ServiceResponse<any>>;
    handlePaymentWebhook(provider: string, payload: any): Promise<ServiceResponse<any>>;
    forceSyncBilling(orgId: string): Promise<ServiceResponse<any>>;
    adminOverrideSubscription(orgId: string, updates: Partial<OrganizationBilling>): Promise<ServiceResponse<OrganizationBilling>>;
    grantComplimentaryCredits(orgId: string, amount: number, reason: string): Promise<ServiceResponse<any>>;
    waiveInvoice(id: string, orgId: string, reason: string): Promise<ServiceResponse<Invoice>>;
    getBillingAnalytics(filters: any): Promise<ServiceResponse<any>>;
    createPortalSession(orgId: string): Promise<ServiceResponse<{
        url: string;
    }>>;
    createCheckoutSession(orgId: string, planId: string): Promise<ServiceResponse<{
        sessionId: string;
        url: string;
    }>>;
}
//# sourceMappingURL=billing.service.d.ts.map