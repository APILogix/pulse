import { CouponsRepository } from './repository.js';
import { BillingError, BillingErrorCodes } from '../shared/errors.js';
import { CouponDiscountType } from '../shared/types.js';
export class CouponsService {
    repository;
    constructor(repository) {
        this.repository = repository;
    }
    async validateCoupon(code, orgId, planId) {
        const coupon = await this.repository.getCouponByCode(code);
        if (!coupon) {
            throw new BillingError('Invalid coupon code', BillingErrorCodes.COUPON_INVALID, 404);
        }
        if (coupon.valid_until && coupon.valid_until < new Date()) {
            throw new BillingError('Coupon has expired', BillingErrorCodes.COUPON_EXPIRED, 400);
        }
        if (coupon.valid_from > new Date()) {
            throw new BillingError('Coupon is not active yet', BillingErrorCodes.COUPON_INVALID, 400);
        }
        if (coupon.max_redemptions !== null && coupon.redemption_count >= coupon.max_redemptions) {
            throw new BillingError('Coupon redemption limit reached', BillingErrorCodes.COUPON_LIMIT_REACHED, 400);
        }
        const isApplicable = await this.repository.isCouponApplicableToPlan(coupon.id, planId);
        if (!isApplicable) {
            throw new BillingError('Coupon is not applicable to this plan', BillingErrorCodes.COUPON_INVALID, 400);
        }
        const orgRedemptions = await this.repository.getOrgRedemptionCount(coupon.id, orgId);
        if (orgRedemptions >= coupon.max_redemptions_per_org) {
            throw new BillingError('You have already used this coupon', BillingErrorCodes.COUPON_LIMIT_REACHED, 400);
        }
        return { success: true, data: coupon };
    }
    async applyCoupon(code, orgId, userId) {
        return this.repository.withTransaction(async (client) => {
            const coupon = await this.repository.getCouponByCodeForUpdate(code, client);
            if (!coupon) {
                throw new BillingError('Invalid coupon code', BillingErrorCodes.COUPON_INVALID, 404);
            }
            // Re-validate inside transaction
            const now = new Date();
            if (coupon.valid_until && coupon.valid_until < now) {
                throw new BillingError('Coupon has expired', BillingErrorCodes.COUPON_EXPIRED, 400);
            }
            if (coupon.valid_from > now) {
                throw new BillingError('Coupon is not active yet', BillingErrorCodes.COUPON_INVALID, 400);
            }
            if (coupon.max_redemptions !== null && coupon.redemption_count >= coupon.max_redemptions) {
                throw new BillingError('Coupon redemption limit reached', BillingErrorCodes.COUPON_LIMIT_REACHED, 400);
            }
            const orgRedemptions = await this.repository.getOrgRedemptionCount(coupon.id, orgId, client);
            if (orgRedemptions >= coupon.max_redemptions_per_org) {
                throw new BillingError('You have already used this coupon', BillingErrorCodes.COUPON_LIMIT_REACHED, 400);
            }
            if (coupon.first_time_customers_only && orgRedemptions > 0) {
                throw new BillingError('Coupon is only valid for first-time customers', BillingErrorCodes.COUPON_LIMIT_REACHED, 400);
            }
            const subscription = await this.repository.getActiveSubscriptionForCoupon(orgId, client);
            if (!subscription) {
                throw new BillingError('No active subscription found for coupon redemption', BillingErrorCodes.SUBSCRIPTION_NOT_FOUND, 404);
            }
            if (coupon.trial_only && subscription.status !== 'trialing') {
                throw new BillingError('Coupon is only valid during a trial', BillingErrorCodes.COUPON_INVALID, 400);
            }
            const isApplicable = await this.repository.isCouponApplicableToPlan(coupon.id, subscription.plan_id, client);
            if (!isApplicable) {
                throw new BillingError('Coupon is not applicable to this plan', BillingErrorCodes.COUPON_INVALID, 400);
            }
            const price = await this.repository.getCurrentPlanPrice(subscription.plan_id, subscription.billing_interval, coupon.currency, client);
            if (!price) {
                throw new BillingError('Plan price not found for coupon calculation', BillingErrorCodes.PLAN_NOT_FOUND, 404);
            }
            const discountValue = Number(coupon.discount_value);
            const discountAmount = coupon.discount_type === CouponDiscountType.PERCENTAGE
                ? Math.floor(price.amount_minor * (discountValue / 100))
                : Math.min(price.amount_minor, Math.floor(discountValue));
            const currency = price.currency;
            await this.repository.redeemCoupon(coupon.id, orgId, userId, subscription.id, discountAmount, currency, client);
            return {
                success: true,
                data: {
                    coupon,
                    subscriptionId: subscription.id,
                    planId: subscription.plan_id,
                    discountAmount,
                    currency,
                },
            };
        });
    }
}
//# sourceMappingURL=service.js.map