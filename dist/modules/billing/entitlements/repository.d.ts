import type { Pool, PoolClient } from 'pg';
type Db = Pool | PoolClient;
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
    hasFeature(orgId: string, featureKey: string, db?: Db): Promise<boolean>;
    getEffectiveIntegerFeature(orgId: string, featureKey: string, db?: Db): Promise<number>;
}
export {};
//# sourceMappingURL=repository.d.ts.map