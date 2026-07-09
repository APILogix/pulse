import { SubscriptionsRepository } from './repository.js';
import { PlansRepository } from '../plans/repository.js';
import { BillingError, BillingErrorCodes } from '../shared/errors.js';
import { 
  SubscriptionStatus, 
  BillingProvider, 
  SubscriptionEventType,
  SubscriptionEventActor,
  BillingInterval
} from '../shared/types.js';
import { randomUUID } from 'crypto';

export class SubscriptionsService {
  constructor(
    private readonly repository: SubscriptionsRepository,
    private readonly plansRepository: PlansRepository
  ) {}

  async getSubscription(orgId: string) {
    const sub = await this.repository.getActiveSubscription(orgId);
    if (!sub) {
      // Return null or generic free tier fallback depending on product requirements.
      // Usually, there's always a subscription row if the org exists.
      return { success: true, data: null };
    }

    const plan = await this.plansRepository.getPlanById(sub.plan_id);
    return {
      success: true,
      data: {
        id: sub.id,
        organizationId: sub.organization_id,
        plan: plan ? { id: plan.id, name: plan.name, tier: plan.tier } : null,
        status: sub.status,
        interval: sub.billing_interval,
        currentPeriodStart: sub.current_period_start,
        currentPeriodEnd: sub.current_period_end,
        cancelAtPeriodEnd: sub.cancel_at_period_end,
      }
    };
  }

  async getHistory(orgId: string) {
    const history = await this.repository.getSubscriptionHistory(orgId);
    return { success: true, data: history };
  }

  async createSubscription(orgId: string, planId: string, interval: BillingInterval, userId: string) {
    const plan = await this.plansRepository.getPlanById(planId);
    if (!plan) {
      throw new BillingError('Plan not found', BillingErrorCodes.PLAN_NOT_FOUND, 404);
    }

    // In a real system, you'd integrate with Stripe/Razorpay if it's a paid plan.
    // We will just do the local DB logic here.
    return this.repository.withTransaction(async (client) => {
      const active = await this.repository.getSubscriptionForUpdate(orgId, client);
      if (active && active.status !== SubscriptionStatus.CANCELLED && active.status !== SubscriptionStatus.EXPIRED) {
        throw new BillingError('Organization already has an active subscription', BillingErrorCodes.INVALID_SUBSCRIPTION_STATE, 400);
      }

      const now = new Date();
      const periodEnd = new Date(now);
      if (interval === BillingInterval.ANNUAL) {
        periodEnd.setFullYear(periodEnd.getFullYear() + 1);
      } else {
        periodEnd.setMonth(periodEnd.getMonth() + 1);
      }

      const sub = await this.repository.createSubscription({
        organization_id: orgId,
        plan_id: planId,
        status: SubscriptionStatus.ACTIVE,
        provider: BillingProvider.SYSTEM,
        billing_interval: interval,
        current_period_start: now,
        current_period_end: periodEnd,
      }, client);

      await this.repository.logEvent({
        organization_id: orgId,
        subscription_id: sub.id,
        event_type: SubscriptionEventType.CREATED,
        actor: SubscriptionEventActor.USER,
        actor_user_id: userId,
        old_plan_id: null,
        new_plan_id: planId,
      }, client);

      return { success: true, data: sub };
    });
  }

  async changePlan(orgId: string, newPlanId: string, userId: string) {
    const newPlan = await this.plansRepository.getPlanById(newPlanId);
    if (!newPlan) {
      throw new BillingError('New plan not found', BillingErrorCodes.PLAN_NOT_FOUND, 404);
    }

    return this.repository.withTransaction(async (client) => {
      const active = await this.repository.getSubscriptionForUpdate(orgId, client);
      if (!active) {
        throw new BillingError('No active subscription found', BillingErrorCodes.SUBSCRIPTION_NOT_FOUND, 404);
      }

      const oldPlan = await this.plansRepository.getPlanById(active.plan_id);
      
      const isUpgrade = oldPlan && oldPlan.sort_order < newPlan.sort_order;
      const eventType = isUpgrade ? SubscriptionEventType.UPGRADED : SubscriptionEventType.DOWNGRADED;

      const sub = await this.repository.updateSubscription(active.id, {
        plan_id: newPlanId,
      }, client);

      await this.repository.logEvent({
        organization_id: orgId,
        subscription_id: sub.id,
        event_type: eventType,
        actor: SubscriptionEventActor.USER,
        actor_user_id: userId,
        old_plan_id: active.plan_id,
        new_plan_id: newPlanId,
      }, client);

      return { success: true, data: sub };
    });
  }

  async cancelSubscription(orgId: string, userId: string) {
    return this.repository.withTransaction(async (client) => {
      const active = await this.repository.getSubscriptionForUpdate(orgId, client);
      if (!active) {
        throw new BillingError('No active subscription found', BillingErrorCodes.SUBSCRIPTION_NOT_FOUND, 404);
      }

      const sub = await this.repository.updateSubscription(active.id, {
        cancel_at_period_end: true,
      }, client);

      await this.repository.logEvent({
        organization_id: orgId,
        subscription_id: sub.id,
        event_type: SubscriptionEventType.CANCELLED,
        actor: SubscriptionEventActor.USER,
        actor_user_id: userId,
        old_plan_id: active.plan_id,
        new_plan_id: active.plan_id,
      }, client);

      return { success: true, data: sub };
    });
  }
}
