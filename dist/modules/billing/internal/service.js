import { BillingError } from '../shared/errors.js';
import { InternalBillingRepository } from './repository.js';
const ERROR_CODES = {
    QUOTA_HARD_LIMIT: 'BILLING_004',
    QUOTA_OVERAGE_ALLOWED: 'BILLING_005',
    INVALID_COUPON: 'BILLING_006',
    COUPON_ALREADY_REDEEMED: 'BILLING_007',
    INVOICE_NOT_FOUND: 'BILLING_009',
    SUBSCRIPTION_NOT_FOUND: 'BILLING_010',
};
function getResolvedValue(row) {
    if (!row)
        return null;
    return row.boolean_value ?? row.integer_value ?? row.decimal_value ?? row.string_value ?? null;
}
const RESOURCE_FEATURE_KEYS = {
    projects: { canonical: 'quota.projects', legacy: 'projects' },
    members: { canonical: 'quota.members', legacy: 'organization_members' },
    apiKeys: { canonical: 'quota.api_keys', legacy: 'api_keys' },
    connectors: { canonical: 'quota.connectors', legacy: 'connectors' },
    alertRules: { canonical: 'quota.alert_rules', legacy: 'alert_rules' },
    dashboards: { canonical: 'quota.dashboards', legacy: 'dashboards' },
};
function numericLimit(row) {
    const value = Number(row?.integer_value ?? 0);
    return Number.isFinite(value) ? value : 0;
}
function isUnlimited(limit) {
    return limit === -1;
}
function allowsUsageBeyondLimit(usageBehavior) {
    return usageBehavior === 'soft_limit' || usageBehavior === 'overage';
}
export class InternalBillingService {
    repository;
    constructor(repository) {
        this.repository = repository;
    }
    async getQuotaFeature(orgId, canonicalKey, legacyKey, db) {
        const canonical = await this.repository.getFeatureValue(orgId, canonicalKey, db);
        return canonical ?? this.repository.getFeatureValue(orgId, legacyKey, db);
    }
    async getEntitlements(orgId) {
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
        }, {});
    }
    async getFeature(orgId, featureKey) {
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
    async getLimit(orgId, featureKey) {
        const row = await this.repository.getFeatureValue(orgId, featureKey);
        return { featureKey, limit: Number(row?.integer_value ?? 0) };
    }
    async consumeEvents(body) {
        return this.repository.withTransaction(async (db) => {
            if (body.requestId) {
                await this.repository.lockIdempotencyKey('event-usage', body.organizationId, body.requestId, db);
                const existing = await this.repository.getProcessedEventUsage(body.organizationId, body.requestId, db);
                if (existing?.new_state) {
                    return { ...existing.new_state, idempotent: true };
                }
            }
            const usage = await this.repository.getCurrentUsageForUpdate(body.organizationId, db);
            if (!usage)
                throw new BillingError('Subscription not found', ERROR_CODES.SUBSCRIPTION_NOT_FOUND, 404);
            const eventEntitlement = await this.getQuotaFeature(body.organizationId, 'quota.monthly_events', 'monthly_events', db);
            const eventLimit = numericLimit(eventEntitlement);
            const used = Number(usage.events_used ?? 0);
            const remainingBefore = isUnlimited(eventLimit) ? Number.POSITIVE_INFINITY : Math.max(eventLimit - used, 0);
            const requested = body.count;
            const overageRequested = Math.max(requested - remainingBefore, 0);
            const canExceedLimit = overageRequested > 0 && allowsUsageBeyondLimit(eventEntitlement?.usage_behavior);
            if (overageRequested > 0 && !canExceedLimit) {
                const result = {
                    accepted: false,
                    remaining: remainingBefore,
                    overage: false,
                    code: ERROR_CODES.QUOTA_HARD_LIMIT,
                };
                if (body.requestId) {
                    await this.repository.recordProcessedEventUsage(body.organizationId, body.requestId, result, db);
                }
                return result;
            }
            await this.repository.incrementEventUsage(body, requested, overageRequested, db);
            const result = {
                accepted: true,
                remaining: Number.isFinite(remainingBefore) ? Math.max(remainingBefore - requested, 0) : null,
                overage: overageRequested > 0,
                overageEvents: overageRequested,
                code: overageRequested > 0 && eventEntitlement?.usage_behavior === 'overage'
                    ? ERROR_CODES.QUOTA_OVERAGE_ALLOWED
                    : undefined,
            };
            if (body.requestId) {
                await this.repository.recordProcessedEventUsage(body.organizationId, body.requestId, result, db);
            }
            return result;
        });
    }
    async consumeAiCredits(body) {
        return this.repository.withTransaction(async (db) => {
            if (body.requestId) {
                await this.repository.lockIdempotencyKey('ai-credits', body.organizationId, body.requestId, db);
                const existing = await this.repository.getAiUsageByRequestId(body.organizationId, body.requestId, db);
                if (existing) {
                    return {
                        accepted: true,
                        remaining: null,
                        creditsUsed: Number(existing.credits_used),
                        idempotent: true,
                    };
                }
            }
            const usage = await this.repository.getCurrentUsageForUpdate(body.organizationId, db);
            if (!usage)
                throw new BillingError('Subscription not found', ERROR_CODES.SUBSCRIPTION_NOT_FOUND, 404);
            const creditEntitlement = await this.getQuotaFeature(body.organizationId, 'quota.ai_credits', 'ai_credits', db);
            const creditLimit = numericLimit(creditEntitlement);
            const remainingBefore = isUnlimited(creditLimit)
                ? Number.POSITIVE_INFINITY
                : Math.max(creditLimit - Number(usage.ai_credits_used ?? 0), 0);
            if (body.credits > remainingBefore && !allowsUsageBeyondLimit(creditEntitlement?.usage_behavior)) {
                return {
                    accepted: false,
                    remaining: remainingBefore,
                    code: ERROR_CODES.QUOTA_HARD_LIMIT,
                };
            }
            await this.repository.incrementAiCredits(body, db);
            return {
                accepted: true,
                remaining: Number.isFinite(remainingBefore) ? Math.max(remainingBefore - body.credits, 0) : null,
                creditsUsed: body.credits,
                idempotent: false,
            };
        });
    }
    async adjustResource(body, direction) {
        return this.repository.withTransaction(async (db) => {
            const featureKey = RESOURCE_FEATURE_KEYS[body.resourceType];
            const entitlement = await this.getQuotaFeature(body.organizationId, featureKey.canonical, featureKey.legacy, db);
            const entitlementLimit = numericLimit(entitlement);
            const row = await this.repository.adjustResourceUsage(body, direction, db);
            if (!row)
                throw new BillingError('Subscription not found', ERROR_CODES.SUBSCRIPTION_NOT_FOUND, 404);
            const used = Number(row.used ?? 0);
            if (direction > 0
                && !isUnlimited(entitlementLimit)
                && used > entitlementLimit
                && !allowsUsageBeyondLimit(entitlement?.usage_behavior)) {
                throw new BillingError('Quota exceeded', ERROR_CODES.QUOTA_HARD_LIMIT, 409, {
                    resourceType: body.resourceType,
                    used,
                    limit: entitlementLimit,
                });
            }
            return {
                resourceType: body.resourceType,
                used,
                limit: entitlementLimit,
                remaining: isUnlimited(entitlementLimit) ? null : Math.max(entitlementLimit - used, 0),
            };
        });
    }
    async getEventQuota(orgId) {
        const usage = await this.repository.getCurrentUsage(orgId);
        if (!usage)
            throw new BillingError('Subscription not found', ERROR_CODES.SUBSCRIPTION_NOT_FOUND, 404);
        const entitlement = await this.getQuotaFeature(orgId, 'quota.monthly_events', 'monthly_events');
        const limit = numericLimit(entitlement);
        const used = Number(usage.events_used ?? 0);
        return {
            limit,
            used,
            remaining: isUnlimited(limit) ? null : Math.max(limit - used, 0),
            usageBehavior: entitlement?.usage_behavior ?? 'hard_limit',
            overageEvents: Number(usage.overage_events ?? 0),
        };
    }
    async getAiCreditQuota(orgId) {
        const usage = await this.repository.getCurrentUsage(orgId);
        if (!usage)
            throw new BillingError('Subscription not found', ERROR_CODES.SUBSCRIPTION_NOT_FOUND, 404);
        const entitlement = await this.getQuotaFeature(orgId, 'quota.ai_credits', 'ai_credits');
        const limit = numericLimit(entitlement);
        const used = Number(usage.ai_credits_used ?? 0);
        return {
            limit,
            used,
            remaining: isUnlimited(limit) ? null : Math.max(limit - used, 0),
            overageAiCredits: Number(usage.overage_ai_credits ?? 0),
        };
    }
    async checkEventQuota(orgId, requestedCount) {
        const quota = await this.getEventQuota(orgId);
        const wouldExceedLimit = quota.remaining !== null && requestedCount > quota.remaining;
        return {
            allowed: !wouldExceedLimit || allowsUsageBeyondLimit(quota.usageBehavior),
            remaining: quota.remaining,
            wouldOverage: wouldExceedLimit,
            usageBehavior: quota.usageBehavior,
        };
    }
    async syncSubscription(orgId) {
        const status = await this.repository.getSubscriptionStatus(orgId);
        if (!status)
            throw new BillingError('Subscription not found', ERROR_CODES.SUBSCRIPTION_NOT_FOUND, 404);
        return { synced: false, reason: 'provider_sync_not_configured', status };
    }
    async getSubscriptionStatus(orgId) {
        const status = await this.repository.getSubscriptionStatus(orgId);
        if (!status)
            throw new BillingError('Subscription not found', ERROR_CODES.SUBSCRIPTION_NOT_FOUND, 404);
        return {
            status: status.status,
            planKey: status.plan_key,
            trial: status.trial_start !== null || status.trial_end !== null,
            trialStart: status.trial_start,
            trialEnd: status.trial_end,
            cancelAtPeriodEnd: status.cancel_at_period_end,
        };
    }
    async generateInvoice(body) {
        return this.repository.withTransaction(async (db) => {
            const invoice = await this.repository.generateInvoice(body, db);
            if (!invoice)
                throw new BillingError('Subscription not found', ERROR_CODES.SUBSCRIPTION_NOT_FOUND, 404);
            return invoice;
        });
    }
    async finalizeInvoice(body) {
        return this.repository.withTransaction(async (db) => {
            const invoice = await this.repository.finalizeInvoice(body, db);
            if (!invoice)
                throw new BillingError('Invoice not found', ERROR_CODES.INVOICE_NOT_FOUND, 404);
            return invoice;
        });
    }
    async reconcilePayments(body) {
        return this.repository.withTransaction((db) => this.repository.reconcilePayments(body, db));
    }
    async validateCoupon(body) {
        const coupon = await this.repository.validateCoupon(body);
        if (!coupon)
            throw new BillingError('Invalid coupon', ERROR_CODES.INVALID_COUPON, 404);
        return {
            valid: true,
            couponId: coupon.id,
            code: coupon.code,
            discountType: coupon.discount_type,
            discountValue: coupon.discount_value,
            currency: coupon.currency,
        };
    }
    async redeemCoupon(body) {
        return this.repository.withTransaction(async (db) => {
            const result = await this.repository.redeemCoupon(body, 0, null, db);
            if (!result)
                throw new BillingError('Invalid coupon', ERROR_CODES.INVALID_COUPON, 404);
            if (result.alreadyRedeemed) {
                throw new BillingError('Coupon already redeemed', ERROR_CODES.COUPON_ALREADY_REDEEMED, 409);
            }
            return result.redemption;
        });
    }
}
//# sourceMappingURL=service.js.map