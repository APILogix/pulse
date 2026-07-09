import { pool } from '../../../config/database.js';
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

export class PlansRepository {
  constructor(private readonly db: Pool = pool) {}

  async listActivePlans(includeHidden = false, db: Db = this.db): Promise<PlanRow[]> {
    const query = includeHidden
      ? `SELECT * FROM plans WHERE is_active = TRUE AND deleted_at IS NULL ORDER BY sort_order ASC, key ASC, version DESC`
      : `SELECT * FROM plans WHERE is_active = TRUE AND is_public = TRUE AND deleted_at IS NULL ORDER BY sort_order ASC, key ASC, version DESC`;
    
    const result = await db.query(query);
    return result.rows;
  }

  async getPlanById(planId: string, db: Db = this.db): Promise<PlanRow | null> {
    const result = await db.query(
      `SELECT * FROM plans WHERE id = $1 AND deleted_at IS NULL`,
      [planId]
    );
    return result.rows[0] || null;
  }

  async getPlanPrices(planId: string, db: Db = this.db): Promise<PlanPriceRow[]> {
    const result = await db.query(
      `SELECT id, plan_id, provider, billing_interval, currency, amount_minor, provider_price_id, is_default, starts_at, ends_at 
       FROM plan_prices 
       WHERE plan_id = $1 AND deleted_at IS NULL`,
      [planId]
    );
    return result.rows;
  }

  async getPlanEntitlements(planId: string, db: Db = this.db): Promise<PlanFeatureEntitlementRow[]> {
    const result = await db.query(
      `SELECT e.plan_id, f.feature_key, f.feature_name, f.category, f.value_type,
              e.boolean_value, e.integer_value, e.decimal_value, e.string_value
       FROM plan_feature_entitlements e
       JOIN billing_features f ON e.feature_id = f.id
       WHERE e.plan_id = $1 AND e.deleted_at IS NULL AND f.deleted_at IS NULL`,
      [planId]
    );
    return result.rows;
  }

  async getAllActivePlanPrices(db: Db = this.db): Promise<PlanPriceRow[]> {
    const result = await db.query(
      `SELECT pp.id, pp.plan_id, pp.provider, pp.billing_interval, pp.currency, pp.amount_minor, pp.provider_price_id, pp.is_default, pp.starts_at, pp.ends_at 
       FROM plan_prices pp
       JOIN plans p ON p.id = pp.plan_id
       WHERE pp.deleted_at IS NULL AND p.is_active = TRUE AND p.deleted_at IS NULL`
    );
    return result.rows;
  }
}
