import { SubscriptionsRepository } from './repository.js';
import { PlansRepository } from '../plans/repository.js';
import { BillingError, BillingErrorCodes } from '../shared/errors.js';
import { SubscriptionStatus, BillingProvider, SubscriptionEventType, SubscriptionEventActor, BillingInterval } from '../shared/types.js';
import { syncOrganizationLookupToLogDbBestEffort } from '../../../shared/logdb/lookup-sync.js';
import { entitlementsService } from '../entitlements/service.js';
export class SubscriptionsService {
    repository;
    plansRepository;
    constructor(repository, plansRepository) {
        this.repository = repository;
        this.plansRepository = plansRepository;
    }
    async getSubscription(orgId) {
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
    async getHistory(orgId) {
        const history = await this.repository.getSubscriptionHistory(orgId);
        return { success: true, data: history };
    }
    async getSummary(orgId) {
        const summary = await this.repository.getSubscriptionSummary(orgId);
        return { success: true, data: summary };
    }
    async createSubscription(orgId, planId, interval, userId) {
        const plan = await this.plansRepository.getPlanById(planId);
        if (!plan) {
            throw new BillingError('Plan not found', BillingErrorCodes.PLAN_NOT_FOUND, 404);
        }
        // In a real system, you'd integrate with Stripe/Razorpay if it's a paid plan.
        // We will just do the local DB logic here.
        const result = await this.repository.withTransaction(async (client) => {
            const active = await this.repository.getSubscriptionForUpdate(orgId, client);
            if (active && active.status !== SubscriptionStatus.CANCELLED && active.status !== SubscriptionStatus.EXPIRED) {
                throw new BillingError('Organization already has an active subscription', BillingErrorCodes.INVALID_SUBSCRIPTION_STATE, 400);
            }
            const limits = await this.repository.getPlanUsageLimitSnapshot(planId, client);
            const now = new Date();
            const periodEnd = new Date(now);
            if (interval === BillingInterval.ANNUAL) {
                periodEnd.setFullYear(periodEnd.getFullYear() + 1);
            }
            else {
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
                modules: limits.modules,
                metadata: {
                    source: 'subscription.create',
                    entitlements: limits.entitlements,
                },
            }, client);
            await this.repository.upsertUsageCurrentPeriod(orgId, sub, limits, client);
            await this.repository.logEvent({
                organization_id: orgId,
                subscription_id: sub.id,
                event_type: SubscriptionEventType.CREATED,
                actor: SubscriptionEventActor.USER,
                actor_user_id: userId,
                old_plan_id: null,
                new_plan_id: planId,
                metadata: {
                    eventLimit: limits.eventLimit,
                    aiCreditLimit: limits.aiCreditLimit,
                },
            }, client);
            return { success: true, data: sub };
        });
        syncOrganizationLookupToLogDbBestEffort(orgId, 'subscription.created');
        entitlementsService.invalidateOrgCache(orgId);
        return result;
    }
    async changePlan(orgId, newPlanId, userId) {
        const newPlan = await this.plansRepository.getPlanById(newPlanId);
        if (!newPlan) {
            throw new BillingError('New plan not found', BillingErrorCodes.PLAN_NOT_FOUND, 404);
        }
        const result = await this.repository.withTransaction(async (client) => {
            const active = await this.repository.getSubscriptionForUpdate(orgId, client);
            if (!active) {
                throw new BillingError('No active subscription found', BillingErrorCodes.SUBSCRIPTION_NOT_FOUND, 404);
            }
            const oldPlan = await this.plansRepository.getPlanById(active.plan_id);
            const limits = await this.repository.getPlanUsageLimitSnapshot(newPlanId, client);
            const isUpgrade = oldPlan && oldPlan.sort_order < newPlan.sort_order;
            const eventType = isUpgrade ? SubscriptionEventType.UPGRADED : SubscriptionEventType.DOWNGRADED;
            const sub = await this.repository.updateSubscription(active.id, {
                plan_id: newPlanId,
                modules: limits.modules,
                metadata: {
                    ...(active.metadata ?? {}),
                    lastPlanChange: {
                        fromPlanId: active.plan_id,
                        toPlanId: newPlanId,
                        changedByUserId: userId,
                        changedAt: new Date().toISOString(),
                        entitlements: limits.entitlements,
                    },
                },
            }, client);
            await this.repository.upsertUsageCurrentPeriod(orgId, sub, limits, client);
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
        syncOrganizationLookupToLogDbBestEffort(orgId, 'subscription.plan_changed');
        entitlementsService.invalidateOrgCache(orgId);
        return result;
    }
    async previewChange(orgId, newPlanId) {
        const newPlan = await this.plansRepository.getPlanById(newPlanId);
        if (!newPlan) {
            throw new BillingError('New plan not found', BillingErrorCodes.PLAN_NOT_FOUND, 404);
        }
        return this.repository.withTransaction(async (client) => {
            const active = await this.repository.getSubscriptionForUpdate(orgId, client);
            if (!active) {
                throw new BillingError('No active subscription found', BillingErrorCodes.SUBSCRIPTION_NOT_FOUND, 404);
            }
            const [currentPrices, newPrices] = await Promise.all([
                this.plansRepository.getPlanPrices(active.plan_id, client),
                this.plansRepository.getPlanPrices(newPlanId, client),
            ]);
            const now = Date.now();
            const currentPrice = currentPrices
                .filter((price) => price.billing_interval === active.billing_interval)
                .filter((price) => (!price.starts_at || price.starts_at.getTime() <= now) && (!price.ends_at || price.ends_at.getTime() > now))
                .sort((a, b) => Number(b.is_default) - Number(a.is_default) || Number(a.amount_minor) - Number(b.amount_minor))[0] ?? null;
            const newPrice = newPrices
                .filter((price) => price.billing_interval === active.billing_interval)
                .filter((price) => (!price.starts_at || price.starts_at.getTime() <= now) && (!price.ends_at || price.ends_at.getTime() > now))
                .sort((a, b) => Number(b.is_default) - Number(a.is_default) || Number(a.amount_minor) - Number(b.amount_minor))[0] ?? null;
            if (!newPrice) {
                throw new BillingError('New plan price not found', BillingErrorCodes.PLAN_NOT_FOUND, 404);
            }
            const periodStart = new Date(active.current_period_start).getTime();
            const periodEnd = new Date(active.current_period_end).getTime();
            const remainingRatio = periodEnd > periodStart
                ? Math.max(0, Math.min(1, (periodEnd - now) / (periodEnd - periodStart)))
                : 0;
            const currentAmount = Number(currentPrice?.amount_minor ?? 0);
            const newAmount = Number(newPrice.amount_minor);
            const proratedAmount = Math.round((newAmount - currentAmount) * remainingRatio);
            return {
                success: true,
                data: {
                    subscriptionId: active.id,
                    currentPlanId: active.plan_id,
                    newPlanId,
                    billingInterval: active.billing_interval,
                    currency: newPrice.currency,
                    currentAmount,
                    newAmount,
                    proratedAmount,
                    effectiveAt: active.current_period_end,
                },
            };
        });
    }
    async scheduleChange(orgId, newPlanId, userId, effectiveAt, prorationBehavior) {
        const newPlan = await this.plansRepository.getPlanById(newPlanId);
        if (!newPlan) {
            throw new BillingError('New plan not found', BillingErrorCodes.PLAN_NOT_FOUND, 404);
        }
        const result = await this.repository.withTransaction(async (client) => {
            const active = await this.repository.getSubscriptionForUpdate(orgId, client);
            if (!active) {
                throw new BillingError('No active subscription found', BillingErrorCodes.SUBSCRIPTION_NOT_FOUND, 404);
            }
            const limits = await this.repository.getPlanUsageLimitSnapshot(newPlanId, client);
            const scheduledChange = {
                planId: newPlanId,
                effectiveAt: (effectiveAt ?? active.current_period_end).toISOString(),
                prorationBehavior: prorationBehavior ?? 'none',
                requestedByUserId: userId,
                requestedAt: new Date().toISOString(),
            };
            const sub = await this.repository.updateSubscription(active.id, {
                metadata: {
                    ...(active.metadata ?? {}),
                    scheduledChange,
                },
            }, client);
            await this.repository.logEvent({
                organization_id: orgId,
                subscription_id: sub.id,
                event_type: SubscriptionEventType.UPGRADED,
                actor: SubscriptionEventActor.USER,
                actor_user_id: userId,
                old_plan_id: active.plan_id,
                new_plan_id: newPlanId,
                metadata: {
                    eventLimit: limits.eventLimit,
                    aiCreditLimit: limits.aiCreditLimit,
                },
            }, client);
            return { success: true, data: sub };
        });
        syncOrganizationLookupToLogDbBestEffort(orgId, 'subscription.change_scheduled');
        return result;
    }
    async cancelSubscription(orgId, userId) {
        const result = await this.repository.withTransaction(async (client) => {
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
        syncOrganizationLookupToLogDbBestEffort(orgId, 'subscription.cancelled');
        entitlementsService.invalidateOrgCache(orgId);
        return result;
    }
}
//# sourceMappingURL=service.js.map