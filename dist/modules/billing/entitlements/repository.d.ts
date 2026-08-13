import type { Pool, PoolClient } from 'pg';
type Db = Pool | PoolClient;
export declare const EFFECTIVE_ENTITLEMENTS_SQL = "\nWITH active_subscription AS (\n  SELECT *\n  FROM organization_subscriptions\n  WHERE organization_id = $1\n    AND status IN ('trialing','active','past_due')\n    AND deleted_at IS NULL\n    AND current_period_end > NOW()\n  ORDER BY\n    CASE status WHEN 'active' THEN 0 WHEN 'trialing' THEN 1 WHEN 'past_due' THEN 2 ELSE 3 END,\n    created_at DESC\n  LIMIT 1\n),\nplan_entitlements AS (\n  SELECT\n    os.organization_id,\n    bf.feature_key,\n    COALESCE(ofo.boolean_value, pfe.boolean_value) AS boolean_value,\n    COALESCE(ofo.integer_value, pfe.integer_value) AS integer_value,\n    COALESCE(ofo.decimal_value, pfe.decimal_value) AS decimal_value,\n    COALESCE(ofo.string_value, pfe.string_value) AS string_value\n  FROM active_subscription os\n  JOIN plan_feature_entitlements pfe\n    ON pfe.plan_id = os.plan_id\n   AND pfe.deleted_at IS NULL\n  JOIN billing_features bf\n    ON bf.id = pfe.feature_id\n   AND bf.deleted_at IS NULL\n   AND bf.is_deprecated = FALSE\n  LEFT JOIN organization_feature_overrides ofo\n    ON ofo.organization_id = os.organization_id\n   AND ofo.feature_id = bf.id\n   AND ofo.deleted_at IS NULL\n   AND (ofo.expires_at IS NULL OR ofo.expires_at > NOW())\n),\naddon_entitlements AS (\n  SELECT\n    os.organization_id,\n    bf.feature_key,\n    CASE WHEN bf.value_type = 'boolean' THEN TRUE ELSE NULL END AS boolean_value,\n    CASE WHEN bf.value_type = 'integer' THEN SUM(sa.quantity)::bigint ELSE NULL END AS integer_value,\n    CASE WHEN bf.value_type = 'decimal' THEN SUM(sa.quantity)::numeric ELSE NULL END AS decimal_value,\n    NULL::text AS string_value\n  FROM active_subscription os\n  JOIN subscription_addons sa\n    ON sa.subscription_id = os.id\n   AND sa.organization_id = os.organization_id\n   AND sa.status = 'active'\n   AND sa.starts_at <= NOW()\n   AND (sa.expires_at IS NULL OR sa.expires_at > NOW())\n  JOIN billing_features bf\n    ON bf.id = sa.feature_id\n   AND bf.deleted_at IS NULL\n   AND bf.is_deprecated = FALSE\n  GROUP BY os.organization_id, bf.feature_key, bf.value_type\n),\ncombined AS (\n  SELECT * FROM plan_entitlements\n  UNION ALL\n  SELECT * FROM addon_entitlements\n)\nSELECT\n  organization_id,\n  feature_key,\n  CASE WHEN BOOL_OR(COALESCE(boolean_value, FALSE)) THEN TRUE ELSE NULL END AS boolean_value,\n  NULLIF(SUM(COALESCE(integer_value, 0)), 0)::bigint AS integer_value,\n  NULLIF(SUM(COALESCE(decimal_value, 0)), 0)::numeric AS decimal_value,\n  MAX(string_value) FILTER (WHERE string_value IS NOT NULL) AS string_value\nFROM combined\nGROUP BY organization_id, feature_key\n";
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