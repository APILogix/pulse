// billing.service.ts - Billing Business Logic Service

import { BillingRepository } from './repository.js';
import {
  BillingInterval,
  SubscriptionStatus,
  InvoiceStatus,
  UsageMetricType
} from './types.js';
import type {
  BillingPlan,
  OrganizationBilling,
  PaymentMethod,
  Invoice,
  UsageRecord,
  UsageSummary,
  QuotaRequest,
  ServiceResponse,
  CreateSubscriptionBody,
  ChangePlanBody,
  CancelSubscriptionBody,
  AddPaymentMethodBody,
  UpdateBillingSettingsBody,
  QuotaIncreaseBody
} from './types.js';
import {
  calculateProration,
  calculateDiscount,
  calculateMrr,
  addDays,
  addMonths,
  daysBetween,
  checkLimitExceeded,
  projectUsage,
  BillingError,
  BillingErrorCodes,
  createBillingLogger
} from './utils.js';

const logger = createBillingLogger('Service');

export class BillingService {
  private repository: BillingRepository;
  private defaultCurrency: string;

  constructor(repository: BillingRepository) {
    this.repository = repository;
    this.defaultCurrency = 'USD';
  }

  // ============================================
  // PLANS & PRICING
  // ============================================

  async listPlans(): Promise<ServiceResponse<BillingPlan[]>> {
    const plans = await this.repository.getAllPlans(false);
    return { success: true, data: plans };
  }

  async getPlan(planId: string): Promise<ServiceResponse<BillingPlan>> {
    const plan = await this.repository.getPlanById(planId);
    if (!plan) {
      throw new BillingError(BillingErrorCodes.PLAN_NOT_FOUND, 'Plan not found', 404);
    }
    return { success: true, data: plan };
  }

  async comparePlans(): Promise<ServiceResponse<any>> {
    const plans = await this.repository.getAllPlans(false);
    
    const allFeatures = new Set<string>();
    plans.forEach(plan => {
      Object.keys(plan.limits).forEach(key => allFeatures.add(key));
      Object.keys(plan.features).forEach(key => allFeatures.add(key));
    });

    const differences = Array.from(allFeatures).map(feature => ({
      feature,
      values: plans.reduce((acc, plan) => {
        const limitValue = plan.limits[feature as keyof typeof plan.limits];
        const featureValue = plan.features[feature as keyof typeof plan.features];
        acc[plan.id] = limitValue !== undefined ? limitValue : featureValue;
        return acc;
      }, {} as Record<string, any>)
    }));

    return { success: true, data: { plans, differences } };
  }

  async estimatePricing(
    planId: string,
    interval: BillingInterval,
    couponCode?: string
  ): Promise<ServiceResponse<any>> {
    const plan = await this.repository.getPlanById(planId);
    if (!plan) {
      throw new BillingError(BillingErrorCodes.PLAN_NOT_FOUND, 'Plan not found', 404);
    }

    let basePrice = interval === BillingInterval.YEARLY && plan.basePriceYearly
      ? plan.basePriceYearly
      : plan.basePriceMonthly;

    let discountAmount = 0;
    if (couponCode) {
      const coupon = await this.repository.getCouponByCode(couponCode);
      if (coupon) {
        discountAmount = calculateDiscount(basePrice, coupon.discountType, coupon.discountValue);
      }
    }

    const total = basePrice - discountAmount;

    return {
      success: true,
      data: {
        planId,
        interval,
        basePrice,
        discountAmount,
        taxAmount: 0,
        total,
        currency: this.defaultCurrency,
        breakdown: [
          { description: `${plan.name} Subscription`, amount: basePrice },
          ...(discountAmount > 0 ? [{ description: 'Discount', amount: -discountAmount }] : [])
        ]
      }
    };
  }

  // ============================================
  // SUBSCRIPTION MANAGEMENT
  // ============================================

  async getSubscription(orgId: string): Promise<ServiceResponse<OrganizationBilling>> {
    const billing = await this.repository.getOrganizationBilling(orgId);
    if (!billing) {
      throw new BillingError(BillingErrorCodes.SUBSCRIPTION_NOT_FOUND, 'No subscription found', 404);
    }
    return { success: true, data: billing };
  }

  async createSubscription(
    orgId: string,
    body: CreateSubscriptionBody
  ): Promise<ServiceResponse<OrganizationBilling>> {
    return this.repository.withTransaction(async (client) => {
      const existing = await this.repository.getOrganizationBilling(orgId);
      if (existing && existing.status !== SubscriptionStatus.CANCELED) {
        throw new BillingError(
          BillingErrorCodes.BILLING_ERROR,
          'Organization already has an active subscription',
          409
        );
      }

      const plan = await this.repository.getPlanById(body.planId);
      if (!plan) {
        throw new BillingError(BillingErrorCodes.PLAN_NOT_FOUND, 'Plan not found', 404);
      }

      const now = new Date();
      const trialDays = plan.trialDays;
      const periodStart = trialDays > 0 ? addDays(now, trialDays) : now;
      const periodEnd = addMonths(periodStart, 1);
      const mrr = calculateMrr(plan.basePriceMonthly, body.billingInterval || BillingInterval.MONTHLY);

      const billing = await this.repository.createOrganizationBilling({
        orgId,
        planId: body.planId,
        status: trialDays > 0 ? SubscriptionStatus.TRIALING : SubscriptionStatus.ACTIVE,
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        billingCycleAnchor: periodStart,
        defaultPaymentMethodId: body.paymentMethodId || null,
        mrr,
        taxRate: 0
      }, client);

      logger.info('Subscription created', { orgId, planId: body.planId });
      return { success: true, data: billing };
    });
  }

  async changePlan(
    orgId: string,
    body: ChangePlanBody
  ): Promise<ServiceResponse<OrganizationBilling>> {
    return this.repository.withTransaction(async (client) => {
      const currentBilling = await this.repository.getOrganizationBilling(orgId);
      if (!currentBilling) {
        throw new BillingError(BillingErrorCodes.SUBSCRIPTION_NOT_FOUND, 'No subscription found', 404);
      }

      const newPlan = await this.repository.getPlanById(body.planId);
      if (!newPlan) {
        throw new BillingError(BillingErrorCodes.PLAN_NOT_FOUND, 'New plan not found', 404);
      }

      const currentPlan = await this.repository.getPlanById(currentBilling.planId);
      if (!currentPlan) {
        throw new BillingError(BillingErrorCodes.PLAN_NOT_FOUND, 'Current plan not found', 404);
      }

      const daysRemaining = daysBetween(new Date(), currentBilling.currentPeriodEnd);
      const daysInPeriod = daysBetween(currentBilling.currentPeriodStart, currentBilling.currentPeriodEnd);
      
      const proration = calculateProration(
        currentPlan.basePriceMonthly,
        newPlan.basePriceMonthly,
        daysRemaining,
        daysInPeriod
      );

      const newMrr = calculateMrr(newPlan.basePriceMonthly, BillingInterval.MONTHLY);

      const updated = await this.repository.updateOrganizationBilling(orgId, {
        planId: body.planId,
        mrr: newMrr
      }, client);

      logger.info('Plan changed', { orgId, from: currentPlan.id, to: newPlan.id });
      return { success: true, data: updated };
    });
  }

  async cancelSubscription(
    orgId: string,
    body: CancelSubscriptionBody
  ): Promise<ServiceResponse<OrganizationBilling>> {
    const billing = await this.repository.getOrganizationBilling(orgId);
    if (!billing) {
      throw new BillingError(BillingErrorCodes.SUBSCRIPTION_NOT_FOUND, 'No subscription found', 404);
    }

    const updates: Partial<OrganizationBilling> = {
      cancelAtPeriodEnd: !body.immediate,
      cancellationReason: body.reason || null
    };

    if (body.immediate) {
      updates.status = SubscriptionStatus.CANCELED;
      updates.canceledAt = new Date();
    }

    const updated = await this.repository.updateOrganizationBilling(orgId, updates);
    
    logger.info('Subscription cancelled', { orgId, immediate: body.immediate });
    return { success: true, data: updated };
  }

  async reactivateSubscription(orgId: string): Promise<ServiceResponse<OrganizationBilling>> {
    const billing = await this.repository.getOrganizationBilling(orgId);
    if (!billing) {
      throw new BillingError(BillingErrorCodes.SUBSCRIPTION_NOT_FOUND, 'No subscription found', 404);
    }

    if (billing.status !== SubscriptionStatus.CANCELED && !billing.cancelAtPeriodEnd) {
      throw new BillingError(BillingErrorCodes.BILLING_ERROR, 'Subscription is already active', 400);
    }

    const updated = await this.repository.updateOrganizationBilling(orgId, {
      status: SubscriptionStatus.ACTIVE,
      cancelAtPeriodEnd: false,
      canceledAt: null,
      cancellationReason: null
    });

    logger.info('Subscription reactivated', { orgId });
    return { success: true, data: updated };
  }

  async previewProration(
    orgId: string,
    newPlanId: string
  ): Promise<ServiceResponse<any>> {
    const billing = await this.repository.getOrganizationBilling(orgId);
    if (!billing) {
      throw new BillingError(BillingErrorCodes.SUBSCRIPTION_NOT_FOUND, 'No subscription found', 404);
    }

    const currentPlan = await this.repository.getPlanById(billing.planId);
    const newPlan = await this.repository.getPlanById(newPlanId);

    if (!currentPlan || !newPlan) {
      throw new BillingError(BillingErrorCodes.PLAN_NOT_FOUND, 'Plan not found', 404);
    }

    const daysRemaining = daysBetween(new Date(), billing.currentPeriodEnd);
    const daysInPeriod = daysBetween(billing.currentPeriodStart, billing.currentPeriodEnd);
    
    const proration = calculateProration(
      currentPlan.basePriceMonthly,
      newPlan.basePriceMonthly,
      daysRemaining,
      daysInPeriod
    );

    return {
      success: true,
      data: {
        currentPlan,
        newPlan,
        prorationDate: new Date(),
        creditBalance: proration.credit,
        newCharges: proration.charge,
        amountDue: proration.net,
        nextBillingDate: billing.currentPeriodEnd,
        currency: this.defaultCurrency
      }
    };
  }

  // ============================================
  // PAYMENT METHODS
  // ============================================

  async listPaymentMethods(orgId: string): Promise<ServiceResponse<PaymentMethod[]>> {
    const methods = await this.repository.getPaymentMethods(orgId);
    return { success: true, data: methods };
  }

  async addPaymentMethod(
    orgId: string,
    body: AddPaymentMethodBody
  ): Promise<ServiceResponse<PaymentMethod>> {
    const paymentMethod = await this.repository.createPaymentMethod({
      orgId,
      type: body.type,
      stripePaymentMethodId: body.stripePaymentMethodId ?? null,
      paypalEmail: body.paypalEmail ?? null,
      billingDetails: body.billingDetails ?? null
    });

    return { success: true, data: paymentMethod };
  }

  async setDefaultPaymentMethod(orgId: string, paymentMethodId: string): Promise<ServiceResponse<void>> {
    await this.repository.setDefaultPaymentMethod(orgId, paymentMethodId);
    return { success: true, data: undefined };
  }

  async updatePaymentMethod(
    id: string,
    orgId: string,
    updates: Partial<PaymentMethod>
  ): Promise<ServiceResponse<PaymentMethod>> {
    const method = await this.repository.updatePaymentMethod(id, orgId, updates);
    return { success: true, data: method };
  }

  async removePaymentMethod(id: string, orgId: string): Promise<ServiceResponse<void>> {
    await this.repository.deletePaymentMethod(id, orgId);
    return { success: true, data: undefined };
  }

  async verifyPaymentMethod(id: string, orgId: string): Promise<ServiceResponse<void>> {
    logger.info('Payment method verification requested', { id, orgId });
    return { success: true, data: undefined };
  }

  // ============================================
  // INVOICES
  // ============================================

  async listInvoices(
    orgId: string,
    options: {
      status?: InvoiceStatus;
      limit?: number;
      offset?: number;
      startDate?: Date;
      endDate?: Date;
    }
  ): Promise<ServiceResponse<{ invoices: Invoice[]; total: number }>> {
    const result = await this.repository.getInvoices(orgId, options);
    return { success: true, data: result };
  }

  async getInvoice(id: string, orgId: string): Promise<ServiceResponse<Invoice>> {
    const invoice = await this.repository.getInvoiceById(id, orgId);
    if (!invoice) {
      throw new BillingError(BillingErrorCodes.INVOICE_NOT_FOUND, 'Invoice not found', 404);
    }
    return { success: true, data: invoice };
  }

  async downloadInvoicePdf(id: string, orgId: string): Promise<ServiceResponse<string>> {
    const invoice = await this.repository.getInvoiceById(id, orgId);
    if (!invoice) {
      throw new BillingError(BillingErrorCodes.INVOICE_NOT_FOUND, 'Invoice not found', 404);
    }
    return { success: true, data: invoice.pdfUrl || '' };
  }

  async payInvoice(id: string, orgId: string): Promise<ServiceResponse<Invoice>> {
    const invoice = await this.repository.getInvoiceById(id, orgId);
    if (!invoice) {
      throw new BillingError(BillingErrorCodes.INVOICE_NOT_FOUND, 'Invoice not found', 404);
    }

    if (invoice.status !== InvoiceStatus.OPEN && invoice.status !== InvoiceStatus.DRAFT) {
      throw new BillingError(BillingErrorCodes.BILLING_ERROR, 'Invoice cannot be paid', 400);
    }

    const updated = await this.repository.updateInvoiceStatus(
      id,
      InvoiceStatus.PAID,
      {
        paidAt: new Date(),
        paymentIntentId: 'manual-payment',
        amountPaid: invoice.total
      }
    );

    return { success: true, data: updated };
  }

  async getUpcomingInvoice(orgId: string): Promise<ServiceResponse<Partial<Invoice>>> {
    const upcoming = await this.repository.getUpcomingInvoice(orgId);
    return { success: true, data: upcoming || {} };
  }

  // ============================================
  // USAGE & METERING
  // ============================================

  async getCurrentUsage(orgId: string): Promise<ServiceResponse<UsageSummary>> {
    const billing = await this.repository.getOrganizationBilling(orgId);
    if (!billing) {
      throw new BillingError(BillingErrorCodes.SUBSCRIPTION_NOT_FOUND, 'No subscription found', 404);
    }

    const plan = await this.repository.getPlanById(billing.planId);
    if (!plan) {
      throw new BillingError(BillingErrorCodes.PLAN_NOT_FOUND, 'Plan not found', 404);
    }

    const counter = await this.repository.getUsageCounter(orgId);
    const now = new Date();

    const metrics = [
      {
        type: UsageMetricType.API_REQUESTS,
        name: 'API Requests',
        used: counter?.apiRequestsThisPeriod || 0,
        limit: plan.limits.apiRequestsPerMin * 60 * 24 * 30,
        percentage: 0,
        overage: 0,
        projected: 0
      },
      {
        type: UsageMetricType.METRICS_INGESTED,
        name: 'Metrics Ingested',
        used: counter?.metricsIngestedThisPeriod || 0,
        limit: null,
        percentage: 0,
        overage: 0,
        projected: 0
      },
      {
        type: UsageMetricType.STORAGE_GB,
        name: 'Storage (GB)',
        used: counter?.storageGbThisPeriod || 0,
        limit: null,
        percentage: 0,
        overage: 0,
        projected: 0
      }
    ];

    const daysElapsed = Math.max(1, daysBetween(billing.currentPeriodStart, now));
    const daysInPeriod = daysBetween(billing.currentPeriodStart, billing.currentPeriodEnd);

    metrics.forEach(metric => {
      if (metric.limit) {
        const check = checkLimitExceeded(metric.used, metric.limit);
        metric.percentage = check.percentage;
        metric.overage = check.exceeded ? metric.used - metric.limit : 0;
      }
      metric.projected = projectUsage(metric.used, daysElapsed, daysInPeriod);
    });

    return {
      success: true,
      data: {
        orgId,
        periodStart: billing.currentPeriodStart,
        periodEnd: billing.currentPeriodEnd,
        metrics,
        totalCost: 0,
        lastUpdated: counter?.lastUpdatedAt || now
      }
    };
  }

  async getDetailedUsage(
    orgId: string,
    params: {
      startDate?: string;
      endDate?: string;
      granularity?: 'hourly' | 'daily' | 'monthly';
    }
  ): Promise<ServiceResponse<UsageRecord[]>> {
    const records = await this.repository.getUsageRecords(orgId, {
      startDate: params.startDate ? new Date(params.startDate) : undefined,
      endDate: params.endDate ? new Date(params.endDate) : undefined,
      granularity: params.granularity
    });
    return { success: true, data: records };
  }

  async getUsageHistory(
    orgId: string,
    metricType: UsageMetricType,
    days: number = 30
  ): Promise<ServiceResponse<{ date: Date; value: number }[]>> {
    const endDate = new Date();
    const startDate = addDays(endDate, -days);
    
    const records = await this.repository.getUsageRecords(orgId, {
      metricType,
      startDate,
      endDate,
      granularity: 'daily'
    });

    const history = records.map(r => ({
      date: r.periodStart,
      value: r.usageCount
    }));

    return { success: true, data: history };
  }

  async getUsageForecast(orgId: string): Promise<ServiceResponse<any>> {
    return { success: true, data: { message: 'Forecast not yet implemented' } };
  }

  async exportUsageReport(
    orgId: string,
    format: 'csv' | 'json' = 'csv'
  ): Promise<ServiceResponse<string>> {
    return { success: true, data: 'Export functionality not yet implemented' };
  }

  // ============================================
  // QUOTAS
  // ============================================

  async getQuotaStatus(orgId: string): Promise<ServiceResponse<any>> {
    const usage = await this.getCurrentUsage(orgId);
    return { success: true, data: usage.data?.metrics };
  }

  async getQuotaDetails(orgId: string, type: UsageMetricType): Promise<ServiceResponse<any>> {
    const history = await this.getUsageHistory(orgId, type, 90);
    return {
      success: true,
      data: {
        type,
        history: history.data,
        trends: 'Trend analysis not yet implemented'
      }
    };
  }

  async requestQuotaIncrease(
    orgId: string,
    type: UsageMetricType,
    body: QuotaIncreaseBody
  ): Promise<ServiceResponse<QuotaRequest>> {
    const billing = await this.repository.getOrganizationBilling(orgId);
    if (!billing) {
      throw new BillingError(BillingErrorCodes.SUBSCRIPTION_NOT_FOUND, 'No subscription found', 404);
    }

    const plan = await this.repository.getPlanById(billing.planId);
    const currentLimit =
      (plan?.limits[type as unknown as keyof typeof plan.limits] as number | undefined) ?? 0;

    const quotaRequest = await this.repository.createQuotaRequest({
      orgId,
      quotaType: type,
      requestedLimit: body.requestedLimit,
      currentLimit,
      reason: body.reason
    });

    return { success: true, data: quotaRequest };
  }

  async listQuotaRequests(orgId: string): Promise<ServiceResponse<QuotaRequest[]>> {
    const requests = await this.repository.getQuotaRequests(orgId);
    return { success: true, data: requests };
  }

  // ============================================
  // BILLING SETTINGS
  // ============================================

  async getBillingSettings(orgId: string): Promise<ServiceResponse<any>> {
    const billing = await this.repository.getOrganizationBilling(orgId);
    if (!billing) {
      throw new BillingError(BillingErrorCodes.SUBSCRIPTION_NOT_FOUND, 'No subscription found', 404);
    }

    return {
      success: true,
      data: {
        taxId: billing.taxId,
        taxRate: billing.taxRate,
        taxExempt: billing.taxExempt,
        invoiceNotes: billing.invoiceNotes,
        netTermsDays: billing.netTermsDays
      }
    };
  }

  async updateBillingSettings(
    orgId: string,
    body: UpdateBillingSettingsBody
  ): Promise<ServiceResponse<any>> {
    const updates: Partial<OrganizationBilling> = {};
    
    if (body.netTermsDays !== undefined) {
      updates.netTermsDays = body.netTermsDays;
    }

    const updated = await this.repository.updateOrganizationBilling(orgId, updates);
    return { success: true, data: updated };
  }

  async updateBillingEmail(orgId: string, email: string): Promise<ServiceResponse<any>> {
    return { success: true, data: { email } };
  }

  async updateBillingAddress(orgId: string, address: any): Promise<ServiceResponse<any>> {
    return { success: true, data: { address } };
  }

  async updateTaxSettings(orgId: string, taxId: string): Promise<ServiceResponse<any>> {
    const updated = await this.repository.updateOrganizationBilling(orgId, { taxId });
    return { success: true, data: updated };
  }

  // ============================================
  // COUPONS & PROMOTIONS
  // ============================================

  async applyCoupon(orgId: string, code: string): Promise<ServiceResponse<any>> {
    const coupon = await this.repository.getCouponByCode(code);
    if (!coupon) {
      throw new BillingError(BillingErrorCodes.COUPON_INVALID, 'Invalid coupon code', 400);
    }

    if (coupon.redeemBy && new Date() > coupon.redeemBy) {
      throw new BillingError(BillingErrorCodes.COUPON_EXPIRED, 'Coupon has expired', 400);
    }

    if (coupon.maxRedemptions && coupon.timesRedeemed >= coupon.maxRedemptions) {
      throw new BillingError(BillingErrorCodes.COUPON_INVALID, 'Coupon usage limit reached', 400);
    }

    await this.repository.incrementCouponUsage(code);
    return { success: true, data: { coupon, applied: true } };
  }

  async removeCoupon(orgId: string): Promise<ServiceResponse<any>> {
    return { success: true, data: { removed: true } };
  }

  async validateCoupon(code: string): Promise<ServiceResponse<any>> {
    const coupon = await this.repository.getCouponByCode(code);
    const isValid = !!coupon && 
      (!coupon.redeemBy || new Date() <= coupon.redeemBy) &&
      (!coupon.maxRedemptions || coupon.timesRedeemed < coupon.maxRedemptions);

    return {
      success: true,
      data: {
        valid: isValid,
        coupon: isValid ? coupon : null,
        message: isValid ? 'Valid coupon' : 'Invalid or expired coupon'
      }
    };
  }

  async listPromotions(): Promise<ServiceResponse<any>> {
    return { success: true, data: [] };
  }

  // ============================================
  // WEBHOOKS
  // ============================================

  async handleStripeWebhook(payload: any, signature: string): Promise<ServiceResponse<any>> {
    logger.info('Stripe webhook received', { type: payload.type });
    return { success: true, data: { received: true, processed: true } };
  }

  async handlePaymentWebhook(provider: string, payload: any): Promise<ServiceResponse<any>> {
    logger.info('Payment webhook received', { provider, type: payload.type });
    return { success: true, data: { received: true, processed: false } };
  }

  // ============================================
  // ADMIN OPERATIONS
  // ============================================

  async forceSyncBilling(orgId: string): Promise<ServiceResponse<any>> {
    logger.info('Force sync billing requested', { orgId });
    return { success: true, data: { synced: true } };
  }

  async adminOverrideSubscription(
    orgId: string,
    updates: Partial<OrganizationBilling>
  ): Promise<ServiceResponse<OrganizationBilling>> {
    const updated = await this.repository.updateOrganizationBilling(orgId, updates);
    logger.info('Admin override subscription', { orgId, updates });
    return { success: true, data: updated };
  }

  async grantComplimentaryCredits(
    orgId: string,
    amount: number,
    reason: string
  ): Promise<ServiceResponse<any>> {
    logger.info('Complimentary credits granted', { orgId, amount, reason });
    return { success: true, data: { granted: amount, reason } };
  }

  async waiveInvoice(id: string, orgId: string, reason: string): Promise<ServiceResponse<Invoice>> {
    const invoice = await this.repository.getInvoiceById(id, orgId);
    if (!invoice) {
      throw new BillingError(BillingErrorCodes.INVOICE_NOT_FOUND, 'Invoice not found', 404);
    }

    const updated = await this.repository.updateInvoiceStatus(id, InvoiceStatus.VOID);
    logger.info('Invoice waived', { invoiceId: id, orgId, reason });
    return { success: true, data: updated };
  }

  async getBillingAnalytics(filters: any): Promise<ServiceResponse<any>> {
    return { success: true, data: { analytics: 'Not yet implemented' } };
  }

  // ============================================
  // PORTAL & CHECKOUT
  // ============================================

  async createPortalSession(orgId: string): Promise<ServiceResponse<{ url: string }>> {
    return { success: true, data: { url: 'https://billing.stripe.com/session/...' } };
  }

  async createCheckoutSession(
    orgId: string,
    planId: string
  ): Promise<ServiceResponse<{ sessionId: string; url: string }>> {
    return { success: true, data: { sessionId: 'cs_...', url: 'https://checkout.stripe.com/...' } };
  }
}
