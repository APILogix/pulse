import { PlansRepository } from './repository.js';
import { BillingInterval } from '../shared/types.js';
export declare class PlansService {
    private readonly repository;
    constructor(repository: PlansRepository);
    listPlans(includeHidden?: boolean): Promise<{
        success: boolean;
        data: {
            id: string;
            key: string;
            name: string;
            tier: import("../shared/types.js").PlanTier;
            description: string | null;
            trialDays: number;
            sortOrder: number;
            prices: {
                id: string;
                provider: string;
                interval: BillingInterval;
                currency: string;
                amountMinor: number;
                isDefault: boolean;
            }[];
            features: Record<string, any>;
        }[];
    }>;
    getPlan(planId: string): Promise<{
        success: boolean;
        data: {
            id: string;
            key: string;
            name: string;
            tier: import("../shared/types.js").PlanTier;
            description: string | null;
            trialDays: number;
            prices: {
                id: string;
                provider: string;
                interval: BillingInterval;
                currency: string;
                amountMinor: number;
                isDefault: boolean;
            }[];
            features: Record<string, any>;
        };
    }>;
    estimatePricing(planId: string, interval: BillingInterval, couponCode?: string): Promise<{
        success: boolean;
        data: {
            planId: string;
            interval: BillingInterval;
            basePriceMinor: number;
            currency: string;
            discountAmount: number;
            totalMinor: number;
        };
    }>;
}
//# sourceMappingURL=service.d.ts.map