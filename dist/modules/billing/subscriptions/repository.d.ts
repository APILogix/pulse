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
    modules: Record<string, unknown>;
    addons: unknown[];
    metadata: Record<string, unknown>;
    created_at: Date;
    updated_at: Date;
    deleted_at: Date | null;
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
    metadata?: Record<string, unknown>;
    created_at: Date;
}
export interface UsageLimitSnapshot {
    eventLimit: number;
    aiCreditLimit: number;
    modules: Record<string, unknown>;
    entitlements: Record<string, unknown>;
}
export declare class SubscriptionsRepository {
    private readonly db;
    constructor(db?: Pool);
    withTransaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T>;
    getActiveSubscription(orgId: string, db?: Db): Promise<SubscriptionRow | null>;
    getSubscriptionForUpdate(orgId: string, db: PoolClient): Promise<SubscriptionRow | null>;
    createSubscription(sub: Partial<SubscriptionRow>, db?: Db): Promise<SubscriptionRow>;
    getPlanUsageLimitSnapshot(planId: string, db?: Db): Promise<UsageLimitSnapshot>;
    upsertUsageCurrentPeriod(orgId: string, subscription: Pick<SubscriptionRow, 'id' | 'current_period_start' | 'current_period_end'>, limits: UsageLimitSnapshot, db?: Db): Promise<void>;
    updateSubscription(id: string, updates: Partial<SubscriptionRow>, db?: Db): Promise<SubscriptionRow>;
    logEvent(event: Omit<SubscriptionEventRow, 'id' | 'created_at'>, db?: Db): Promise<void>;
    getSubscriptionHistory(orgId: string, db?: Db): Promise<SubscriptionEventRow[]>;
    getSubscriptionSummary(orgId: string, db?: Db): Promise<Record<string, unknown>>;
}
export {};
//# sourceMappingURL=repository.d.ts.map