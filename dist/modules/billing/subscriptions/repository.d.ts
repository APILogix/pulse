import type { Pool, PoolClient } from 'pg';
import { SubscriptionStatus, BillingProvider, BillingInterval, SubscriptionEventType, SubscriptionEventActor } from '../shared/types.js';
type Db = Pool | PoolClient;
export interface SubscriptionRow {
    id: string;
    organization_id: string;
    plan_id: string;
    status: SubscriptionStatus;
    provider: BillingProvider;
    billing_interval: BillingInterval;
    provider_customer_id: string | null;
    provider_subscription_id: string | null;
    current_period_start: Date;
    current_period_end: Date;
    trial_start: Date | null;
    trial_end: Date | null;
    cancel_at_period_end: boolean;
    cancelled_at: Date | null;
    created_at: Date;
    updated_at: Date;
}
export interface SubscriptionEventRow {
    id: string;
    organization_id: string;
    subscription_id: string;
    event_type: SubscriptionEventType;
    actor: SubscriptionEventActor;
    actor_user_id: string | null;
    old_plan_id: string | null;
    new_plan_id: string | null;
    created_at: Date;
}
export declare class SubscriptionsRepository {
    private readonly db;
    constructor(db?: Pool);
    withTransaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T>;
    getActiveSubscription(orgId: string, db?: Db): Promise<SubscriptionRow | null>;
    getSubscriptionForUpdate(orgId: string, db: PoolClient): Promise<SubscriptionRow | null>;
    createSubscription(sub: Partial<SubscriptionRow>, db?: Db): Promise<SubscriptionRow>;
    updateSubscription(id: string, updates: Partial<SubscriptionRow>, db?: Db): Promise<SubscriptionRow>;
    logEvent(event: Omit<SubscriptionEventRow, 'id' | 'created_at'>, db?: Db): Promise<void>;
    getSubscriptionHistory(orgId: string, db?: Db): Promise<SubscriptionEventRow[]>;
}
export {};
//# sourceMappingURL=repository.d.ts.map