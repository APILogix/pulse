import { pool } from '../../../config/database.js';
import type { Pool, PoolClient } from 'pg';

type Db = Pool | PoolClient;

export const EFFECTIVE_ENTITLEMENTS_SQL = `
WITH active_subscription AS (
  SELECT *
  FROM organization_subscriptions
  WHERE organization_id = $1
    AND status IN ('trialing','active','past_due')
    AND deleted_at IS NULL
    AND current_period_end > NOW()
  ORDER BY
    CASE status WHEN 'active' THEN 0 WHEN 'trialing' THEN 1 WHEN 'past_due' THEN 2 ELSE 3 END,
    created_at DESC
  LIMIT 1
),
plan_entitlements AS (
  SELECT
    os.organization_id,
    bf.feature_key,
    COALESCE(ofo.boolean_value, pfe.boolean_value) AS boolean_value,
    COALESCE(ofo.integer_value, pfe.integer_value) AS integer_value,
    COALESCE(ofo.decimal_value, pfe.decimal_value) AS decimal_value,
    COALESCE(ofo.string_value, pfe.string_value) AS string_value
  FROM active_subscription os
  JOIN plan_feature_entitlements pfe
    ON pfe.plan_id = os.plan_id
   AND pfe.deleted_at IS NULL
  JOIN billing_features bf
    ON bf.id = pfe.feature_id
   AND bf.deleted_at IS NULL
   AND bf.is_deprecated = FALSE
  LEFT JOIN organization_feature_overrides ofo
    ON ofo.organization_id = os.organization_id
   AND ofo.feature_id = bf.id
   AND ofo.deleted_at IS NULL
   AND (ofo.expires_at IS NULL OR ofo.expires_at > NOW())
),
addon_entitlements AS (
  SELECT
    os.organization_id,
    bf.feature_key,
    CASE WHEN bf.value_type = 'boolean' THEN TRUE ELSE NULL END AS boolean_value,
    CASE WHEN bf.value_type = 'integer' THEN SUM(sa.quantity)::bigint ELSE NULL END AS integer_value,
    CASE WHEN bf.value_type = 'decimal' THEN SUM(sa.quantity)::numeric ELSE NULL END AS decimal_value,
    NULL::text AS string_value
  FROM active_subscription os
  JOIN subscription_addons sa
    ON sa.subscription_id = os.id
   AND sa.organization_id = os.organization_id
   AND sa.status = 'active'
   AND sa.starts_at <= NOW()
   AND (sa.expires_at IS NULL OR sa.expires_at > NOW())
  JOIN billing_features bf
    ON bf.id = sa.feature_id
   AND bf.deleted_at IS NULL
   AND bf.is_deprecated = FALSE
  GROUP BY os.organization_id, bf.feature_key, bf.value_type
),
combined AS (
  SELECT * FROM plan_entitlements
  UNION ALL
  SELECT * FROM addon_entitlements
)
SELECT
  organization_id,
  feature_key,
  CASE WHEN BOOL_OR(COALESCE(boolean_value, FALSE)) THEN TRUE ELSE NULL END AS boolean_value,
  NULLIF(SUM(COALESCE(integer_value, 0)), 0)::bigint AS integer_value,
  NULLIF(SUM(COALESCE(decimal_value, 0)), 0)::numeric AS decimal_value,
  MAX(string_value) FILTER (WHERE string_value IS NOT NULL) AS string_value
FROM combined
GROUP BY organization_id, feature_key
`;

export interface EffectiveEntitlementRow {
  organization_id: string;
  feature_key: string;
  boolean_value: boolean | null;
  integer_value: number | null;
  decimal_value: number | null;
  string_value: string | null;
}

export class EntitlementsRepository {
  constructor(private readonly db: Pool = pool) {}

  async getEffectiveEntitlements(orgId: string, db: Db = this.db): Promise<EffectiveEntitlementRow[]> {
    const result = await db.query(
      `${EFFECTIVE_ENTITLEMENTS_SQL}
       ORDER BY feature_key`,
      [orgId]
    );
    return result.rows;
  }

  async hasFeature(orgId: string, featureKey: string, db: Db = this.db): Promise<boolean> {
    const result = await db.query(
      `SELECT COALESCE(boolean_value, integer_value > 0, decimal_value > 0, string_value IS NOT NULL, FALSE) AS has_access
       FROM (${EFFECTIVE_ENTITLEMENTS_SQL}) entitlements
       WHERE feature_key = $2
       LIMIT 1`,
      [orgId, featureKey]
    );
    return result.rows[0]?.has_access === true;
  }

  async getEffectiveIntegerFeature(orgId: string, featureKey: string, db: Db = this.db): Promise<number> {
    const result = await db.query(
      `SELECT COALESCE(integer_value, 0) AS limit_val
       FROM (${EFFECTIVE_ENTITLEMENTS_SQL}) entitlements
       WHERE feature_key = $2
       LIMIT 1`,
      [orgId, featureKey]
    );
    return parseInt(result.rows[0]?.limit_val ?? '0', 10);
  }
}
