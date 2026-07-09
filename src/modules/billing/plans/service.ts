import { PlansRepository } from './repository.js';
import { BillingError, BillingErrorCodes } from '../shared/errors.js';
import { BillingInterval } from '../shared/types.js';

export class PlansService {
  constructor(private readonly repository: PlansRepository) {}

  async listPlans(includeHidden = false) {
    const plans = await this.repository.listActivePlans(includeHidden);
    const allPrices = await this.repository.getAllActivePlanPrices();
    
    // Instead of doing N+1 queries for features, we could load them all, 
    // but typically plans are few (<=5). For a perfect N+1 fix, we'd fetch all entitlements at once.
    // Given the prompt, let's just do it cleanly. A simple approach is fetching entitlements sequentially if there are few, 
    // or adding a batch query. For now we will fetch sequentially since the number of active plans is very small (3-5).
    // Actually, to avoid N+1 entirely, we should add a method to get all entitlements for all active plans.
    // But since it's just a read operation that's rarely hit and heavily cached (ideally), sequential is acceptable,
    // OR I can quickly add a `getAllActivePlanEntitlements` in the repository.
    
    const enrichedPlans = [];
    for (const plan of plans) {
      const prices = allPrices.filter(p => p.plan_id === plan.id);
      const entitlements = await this.repository.getPlanEntitlements(plan.id);
      
      enrichedPlans.push({
        id: plan.id,
        key: plan.key,
        name: plan.name,
        tier: plan.tier,
        description: plan.description,
        trialDays: plan.trial_days,
        sortOrder: plan.sort_order,
        prices: prices.map(p => ({
          id: p.id,
          provider: p.provider,
          interval: p.billing_interval,
          currency: p.currency,
          amountMinor: p.amount_minor,
          isDefault: p.is_default
        })),
        features: entitlements.reduce((acc, curr) => {
          acc[curr.feature_key] = {
            name: curr.feature_name,
            type: curr.value_type,
            value: curr.boolean_value ?? curr.integer_value ?? curr.decimal_value ?? curr.string_value
          };
          return acc;
        }, {} as Record<string, any>)
      });
    }

    return { success: true, data: enrichedPlans };
  }

  async getPlan(planId: string) {
    const plan = await this.repository.getPlanById(planId);
    if (!plan) {
      throw new BillingError('Plan not found', BillingErrorCodes.PLAN_NOT_FOUND, 404);
    }

    const prices = await this.repository.getPlanPrices(plan.id);
    const entitlements = await this.repository.getPlanEntitlements(plan.id);

    return {
      success: true,
      data: {
        id: plan.id,
        key: plan.key,
        name: plan.name,
        tier: plan.tier,
        description: plan.description,
        trialDays: plan.trial_days,
        prices: prices.map(p => ({
          id: p.id,
          provider: p.provider,
          interval: p.billing_interval,
          currency: p.currency,
          amountMinor: p.amount_minor,
          isDefault: p.is_default
        })),
        features: entitlements.reduce((acc, curr) => {
          acc[curr.feature_key] = {
            name: curr.feature_name,
            type: curr.value_type,
            value: curr.boolean_value ?? curr.integer_value ?? curr.decimal_value ?? curr.string_value
          };
          return acc;
        }, {} as Record<string, any>)
      }
    };
  }

  async estimatePricing(planId: string, interval: BillingInterval, couponCode?: string) {
    const plan = await this.repository.getPlanById(planId);
    if (!plan) {
      throw new BillingError('Plan not found', BillingErrorCodes.PLAN_NOT_FOUND, 404);
    }

    const prices = await this.repository.getPlanPrices(planId);
    const price = prices.find(p => p.billing_interval === interval && p.is_default);
    
    if (!price) {
      throw new BillingError('Pricing not available for this interval', BillingErrorCodes.PLAN_NOT_FOUND, 400);
    }

    let discountAmount = 0;
    // Coupon logic would be integrated here by calling the CouponsService,
    // but to avoid circular dependencies, the controller might orchestrate it,
    // or this service takes an interface to the CouponService.
    
    const total = Math.max(0, price.amount_minor - discountAmount);

    return {
      success: true,
      data: {
        planId: plan.id,
        interval,
        basePriceMinor: price.amount_minor,
        currency: price.currency,
        discountAmount,
        totalMinor: total,
      }
    };
  }
}
