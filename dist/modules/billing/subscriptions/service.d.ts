import { SubscriptionsRepository } from './repository.js';
import { PlansRepository } from '../plans/repository.js';
import { SubscriptionStatus, BillingInterval } from '../shared/types.js';
export declare class SubscriptionsService {
    private readonly repository;
    private readonly plansRepository;
    constructor(repository: SubscriptionsRepository, plansRepository: PlansRepository);
    getSubscription(orgId: string): Promise<{
        success: boolean;
        data: null;
    } | {
        success: boolean;
        data: {
            id: string;
            organizationId: string;
            plan: {
                id: string;
                name: string;
                tier: import("../shared/types.js").PlanTier;
            } | null;
            status: SubscriptionStatus;
            interval: BillingInterval;
            currentPeriodStart: Date;
            currentPeriodEnd: Date;
            cancelAtPeriodEnd: boolean;
        };
    }>;
    getHistory(orgId: string): Promise<{
        success: boolean;
        data: import("./repository.js").SubscriptionEventRow[];
    }>;
    createSubscription(orgId: string, planId: string, interval: BillingInterval, userId: string): Promise<{
        success: boolean;
        data: import("./repository.js").SubscriptionRow;
    }>;
    changePlan(orgId: string, newPlanId: string, userId: string): Promise<{
        success: boolean;
        data: import("./repository.js").SubscriptionRow;
    }>;
    cancelSubscription(orgId: string, userId: string): Promise<{
        success: boolean;
        data: import("./repository.js").SubscriptionRow;
    }>;
}
//# sourceMappingURL=service.d.ts.map