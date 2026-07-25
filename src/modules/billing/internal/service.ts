import { BillingError } from '../shared/errors.js';
import { InternalBillingRepository } from './repository.js';
import type {
  AiCreditUsageBody,
  CouponRedeemBody,
  CouponValidateBody,
  EventUsageBody,
  InvoiceFinalizeBody,
  InvoiceGenerateBody,
  PaymentReconcileBody,
  ResourceUsageBody,
} from './schemas.js';

const ERROR_CODES = {
  QUOTA_HARD_LIMIT: 'BILLING_004',
  QUOTA_OVERAGE_ALLOWED: 'BILLING_005',
  INVALID_COUPON: 'BILLING_006',
  COUPON_ALREADY_REDEEMED: 'BILLING_007',
  INVOICE_NOT_FOUND: 'BILLING_009',
  SUBSCRIPTION_NOT_FOUND: 'BILLING_010',
} as const;

function getResolvedValue(row: any) {
  if (!row) return null;
  return row.boolean_value ?? row.integer_value ?? row.decimal_value ?? row.string_value ?? null;
}

function allowsOverage(entitlements: any[]): boolean {
  return entitlements.some((row) => {
    const key = String(row.feature_key ?? '').toLowerCase();
    return key.includes('overage') && row.boolean_value === true;
  });
}

export class InternalBillingService {
  constructor(private readonly repository: InternalBillingRepository) {}

  async getEntitlements(orgId: string) {
    const rows = await this.repository.getResolvedEntitlements(orgId);
    return rows.reduce((acc, row) => {
      acc[row.feature_key] = {
        value: getResolvedValue(row),
        booleanValue: row.boolean_value,
        integerValue: row.integer_value,
        decimalValue: row.decimal_value,
        stringValue: row.string_value,
        module: row.module,
        isModuleRoot: row.is_module_root,
        valueType: row.value_type,
      };
      return acc;
    }, {} as Record<string, any>);
  }

  async getFeature(orgId: string, featureKey: string) {
    const row = await this.repository.getFeatureValue(orgId, featureKey);
    if (!row) {
      return { featureKey, value: null, enabled: false };
    }
    return {
      featureKey,
      value: getResolvedValue(row),
      enabled: row.boolean_value === true || Number(row.integer_value ?? 0) > 0 || row.string_value !== null,
      module: row.module,
      valueType: row.value_type,
    };
  }

  async getLimit(orgId: string, featureKey: string) {
    const row = await this.repository.getFeatureValue(orgId, featureKey);
    return { featureKey, limit: Number(row?.integer_value ?? 0) };
  }

  async consumeEvents(body: EventUsageBody) {
    return this.repository.withTransaction(async (db) => {
      const usage = await this.repository.getCurrentUsageForUpdate(body.organizationId, db);
      if (!usage) throw new BillingError('Subscription not found', ERROR_CODES.SUBSCRIPTION_NOT_FOUND, 404);

      const entitlements = await this.repository.getResolvedEntitlements(body.organizationId, db);
      const eventLimit = Number(usage.event_limit ?? 0);
      const used = Number(usage.events_used ?? 0);
      const remainingBefore = Math.max(eventLimit - used, 0);
      const requested = body.count;
      const overageRequested = Math.max(requested - remainingBefore, 0);
      const canOverage = overageRequested > 0 && allowsOverage(entitlements);

      if (overageRequested > 0 && !canOverage) {
        return {
          accepted: false,
          remaining: remainingBefore,
          overage: false,
          code: ERROR_CODES.QUOTA_HARD_LIMIT,
        };
      }

      await this.repository.incrementEventUsage(body, requested, overageRequested, db);
      return {
        accepted: true,
        remaining: Math.max(remainingBefore - requested, 0),
        overage: overageRequested > 0,
        overageEvents: overageRequested,
        code: overageRequested > 0 ? ERROR_CODES.QUOTA_OVERAGE_ALLOWED : undefined,
      };
    });
  }

  async consumeAiCredits(body: AiCreditUsageBody) {
    return this.repository.withTransaction(async (db) => {
      const usage = await this.repository.getCurrentUsageForUpdate(body.organizationId, db);
      if (!usage) throw new BillingError('Subscription not found', ERROR_CODES.SUBSCRIPTION_NOT_FOUND, 404);

      const remainingBefore = Math.max(Number(usage.ai_credit_limit ?? 0) - Number(usage.ai_credits_used ?? 0), 0);
      if (body.credits > remainingBefore) {
        return {
          accepted: false,
          remaining: remainingBefore,
          code: ERROR_CODES.QUOTA_HARD_LIMIT,
        };
      }

      await this.repository.incrementAiCredits(body, db);
      return {
        accepted: true,
        remaining: Math.max(remainingBefore - body.credits, 0),
      };
    });
  }

  async adjustResource(body: ResourceUsageBody, direction: 1 | -1) {
    return this.repository.withTransaction(async (db) => {
      const row = await this.repository.adjustResourceUsage(body, direction, db);
      if (!row) throw new BillingError('Subscription not found', ERROR_CODES.SUBSCRIPTION_NOT_FOUND, 404);

      const used = Number(row.used ?? 0);
      const limit = Number(row.limit ?? 0);
      if (direction > 0 && limit > 0 && used > limit) {
        throw new BillingError('Quota exceeded', ERROR_CODES.QUOTA_HARD_LIMIT, 409, {
          resourceType: body.resourceType,
          used,
          limit,
        });
      }
      return { resourceType: body.resourceType, used, limit, remaining: Math.max(limit - used, 0) };
    });
  }

  async getEventQuota(orgId: string) {
    const usage = await this.repository.getCurrentUsage(orgId);
    if (!usage) throw new BillingError('Subscription not found', ERROR_CODES.SUBSCRIPTION_NOT_FOUND, 404);
    const limit = Number(usage.event_limit ?? 0);
    const used = Number(usage.events_used ?? 0);
    return { limit, used, remaining: Math.max(limit - used, 0), overageEvents: Number(usage.overage_events ?? 0) };
  }

  async getAiCreditQuota(orgId: string) {
    const usage = await this.repository.getCurrentUsage(orgId);
    if (!usage) throw new BillingError('Subscription not found', ERROR_CODES.SUBSCRIPTION_NOT_FOUND, 404);
    const limit = Number(usage.ai_credit_limit ?? 0);
    const used = Number(usage.ai_credits_used ?? 0);
    return { limit, used, remaining: Math.max(limit - used, 0), overageAiCredits: Number(usage.overage_ai_credits ?? 0) };
  }

  async checkEventQuota(orgId: string, requestedCount: number) {
    const quota = await this.getEventQuota(orgId);
    return {
      allowed: requestedCount <= quota.remaining,
      remaining: quota.remaining,
      wouldOverage: requestedCount > quota.remaining,
    };
  }

  async syncSubscription(orgId: string) {
    const status = await this.repository.getSubscriptionStatus(orgId);
    if (!status) throw new BillingError('Subscription not found', ERROR_CODES.SUBSCRIPTION_NOT_FOUND, 404);
    return { synced: false, reason: 'provider_sync_not_configured', status };
  }

  async getSubscriptionStatus(orgId: string) {
    const status = await this.repository.getSubscriptionStatus(orgId);
    if (!status) throw new BillingError('Subscription not found', ERROR_CODES.SUBSCRIPTION_NOT_FOUND, 404);
    return {
      status: status.status,
      planKey: status.plan_key,
      trial: status.trial_start !== null || status.trial_end !== null,
      trialStart: status.trial_start,
      trialEnd: status.trial_end,
      cancelAtPeriodEnd: status.cancel_at_period_end,
    };
  }

  async generateInvoice(body: InvoiceGenerateBody) {
    return this.repository.withTransaction(async (db) => {
      const invoice = await this.repository.generateInvoice(body, db);
      if (!invoice) throw new BillingError('Subscription not found', ERROR_CODES.SUBSCRIPTION_NOT_FOUND, 404);
      return invoice;
    });
  }

  async finalizeInvoice(body: InvoiceFinalizeBody) {
    return this.repository.withTransaction(async (db) => {
      const invoice = await this.repository.finalizeInvoice(body, db);
      if (!invoice) throw new BillingError('Invoice not found', ERROR_CODES.INVOICE_NOT_FOUND, 404);
      return invoice;
    });
  }

  async reconcilePayments(body: PaymentReconcileBody) {
    return this.repository.withTransaction((db) => this.repository.reconcilePayments(body, db));
  }

  async validateCoupon(body: CouponValidateBody) {
    const coupon = await this.repository.validateCoupon(body);
    if (!coupon) throw new BillingError('Invalid coupon', ERROR_CODES.INVALID_COUPON, 404);
    return {
      valid: true,
      couponId: coupon.id,
      code: coupon.code,
      discountType: coupon.discount_type,
      discountValue: coupon.discount_value,
      currency: coupon.currency,
    };
  }

  async redeemCoupon(body: CouponRedeemBody) {
    return this.repository.withTransaction(async (db) => {
      const result = await this.repository.redeemCoupon(body, 0, null, db);
      if (!result) throw new BillingError('Invalid coupon', ERROR_CODES.INVALID_COUPON, 404);
      if (result.alreadyRedeemed) {
        throw new BillingError('Coupon already redeemed', ERROR_CODES.COUPON_ALREADY_REDEEMED, 409);
      }
      return result.redemption;
    });
  }
}
