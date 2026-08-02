export declare const EVENT_LIMIT_FEATURE_KEY = "monthly_events";
export declare const AI_CREDIT_LIMIT_FEATURE_KEY = "module_ai_insights_monthly_credits";
export declare const POSTGRES_BIGINT_MAX = "9223372036854775807";
export interface BillingEntitlementSnapshotRow {
    feature_key: string;
    module: string | null;
    is_module_root: boolean;
    value_type: string;
    boolean_value: boolean | null;
    integer_value: number | string | null;
    decimal_value: number | string | null;
    string_value: string | null;
}
export declare function entitlementValue(row: BillingEntitlementSnapshotRow): boolean | number | string | null;
export declare function integerEntitlement(rows: BillingEntitlementSnapshotRow[], featureKey: string): number;
export declare function usageLimitParameter(limit: number): number | string;
export declare function buildModulesSnapshot(rows: BillingEntitlementSnapshotRow[]): Record<string, unknown>;
export declare function buildEntitlementsSnapshot(rows: BillingEntitlementSnapshotRow[]): Record<string, unknown>;
//# sourceMappingURL=entitlement-snapshot.d.ts.map