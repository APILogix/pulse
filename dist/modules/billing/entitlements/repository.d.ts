import type { Pool, PoolClient } from 'pg';
type Db = Pool | PoolClient;
export declare function buildEffectiveEntitlementsSql(featureFilter?: {
    paramIndex: number;
    isArray?: boolean;
}): string;
export declare const EFFECTIVE_ENTITLEMENTS_SQL: string;
export interface EffectiveEntitlementRow {
    organization_id: string;
    feature_key: string;
    boolean_value: boolean | null;
    integer_value: number | null;
    decimal_value: number | null;
    string_value: string | null;
}
export declare class EntitlementsRepository {
    private readonly db;
    constructor(db?: Pool);
    getEffectiveEntitlements(orgId: string, db?: Db): Promise<EffectiveEntitlementRow[]>;
    /**
     * Resolve multiple feature entitlements in a single database query, avoiding repeated 6-table CTE scans (BIL-Q011).
     */
    getFeaturesMap(orgId: string, featureKeys?: string[], db?: Db): Promise<Map<string, EffectiveEntitlementRow>>;
    hasFeature(orgId: string, featureKey: string, db?: Db): Promise<boolean>;
    getEffectiveIntegerFeature(orgId: string, featureKey: string, db?: Db): Promise<number>;
    getEffectiveFeatureRow(orgId: string, featureKey: string, db?: Db): Promise<EffectiveEntitlementRow | null>;
    getSubscriptionState(orgId: string, db?: Db): Promise<{
        subscriptionId: string;
        planId: string;
        planKey: string;
        planTier: string;
        status: string;
        currentPeriodStart: Date;
        currentPeriodEnd: Date;
        cancelAtPeriodEnd: boolean;
    } | null>;
}
export {};
//# sourceMappingURL=repository.d.ts.map