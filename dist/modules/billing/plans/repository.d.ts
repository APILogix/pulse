import type { Pool, PoolClient } from 'pg';
import { BillingInterval, PlanTier } from '../shared/types.js';
type Db = Pool | PoolClient;
export interface PlanRow {
    id: string;
    key: string;
    version: number;
    name: string;
    tier: PlanTier;
    description: string | null;
    trial_days: number;
    is_active: boolean;
    is_public: boolean;
    sort_order: number;
    created_at: Date;
    updated_at: Date;
}
export interface PlanPriceRow {
    id: string;
    plan_id: string;
    provider: string;
    billing_interval: BillingInterval;
    currency: string;
    amount_minor: number;
    provider_price_id: string | null;
    is_default: boolean;
    starts_at: Date | null;
    ends_at: Date | null;
}
export interface PlanFeatureEntitlementRow {
    plan_id: string;
    feature_key: string;
    feature_name: string;
    category: string;
    value_type: string;
    boolean_value: boolean | null;
    integer_value: number | null;
    decimal_value: number | null;
    string_value: string | null;
}
export declare class PlansRepository {
    private readonly db;
    constructor(db?: Pool);
    listActivePlans(includeHidden?: boolean, db?: Db): Promise<PlanRow[]>;
    getPlanById(planId: string, db?: Db): Promise<PlanRow | null>;
    getPlanPrices(planId: string, db?: Db): Promise<PlanPriceRow[]>;
    getPlanEntitlements(planId: string, db?: Db): Promise<PlanFeatureEntitlementRow[]>;
    getAllActivePlanPrices(db?: Db): Promise<PlanPriceRow[]>;
}
export {};
//# sourceMappingURL=repository.d.ts.map