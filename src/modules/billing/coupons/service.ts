import { CouponsRepository } from './repository.js';
import { BillingError, BillingErrorCodes } from '../shared/errors.js';

export class CouponsService {
  constructor(private readonly repository: CouponsRepository) {}

  async validateCoupon(code: string, orgId: string, planId: string) {
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

  async applyCoupon(code: string, orgId: string, planId: string, userId: string) {
    return this.repository.withTransaction(async (client) => {
      const coupon = await this.repository.getCouponByCodeForUpdate(code, client);
      if (!coupon) {
        throw new BillingError('Invalid coupon code', BillingErrorCodes.COUPON_INVALID, 404);
      }

      // Re-validate inside transaction
      if (coupon.max_redemptions !== null && coupon.redemption_count >= coupon.max_redemptions) {
        throw new BillingError('Coupon redemption limit reached', BillingErrorCodes.COUPON_LIMIT_REACHED, 400);
      }

      const orgRedemptions = await this.repository.getOrgRedemptionCount(coupon.id, orgId, client);
      if (orgRedemptions >= coupon.max_redemptions_per_org) {
        throw new BillingError('You have already used this coupon', BillingErrorCodes.COUPON_LIMIT_REACHED, 400);
      }

      // The discount amount calculation depends on the plan price, we stub it here as 0
      // In a real flow, this is calculated before generating the invoice.
      const discountAmount = 0; 
      const currency = coupon.currency || 'USD';

      await this.repository.redeemCoupon(coupon.id, orgId, userId, discountAmount, currency, client);

      return { success: true, data: coupon };
    });
  }
}
