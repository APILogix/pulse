import { pool } from '../../../config/database.js';
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

export class EntitlementsRepository {
  constructor(private readonly db: Pool = pool) {}

  async getEffectiveEntitlements(orgId: string, db: Db = this.db): Promise<EffectiveEntitlementRow[]> {
    const result = await db.query(
      `SELECT organization_id, feature_key, boolean_value, integer_value, decimal_value, string_value
       FROM v_effective_entitlements
       WHERE organization_id = $1`,
      [orgId]
    );
    return result.rows;
  }

  async hasFeature(orgId: string, featureKey: string, db: Db = this.db): Promise<boolean> {
    const result = await db.query(
      `SELECT has_feature($1, $2) as has_access`,
      [orgId, featureKey]
    );
    return result.rows[0]?.has_access === true;
  }

  async getEffectiveIntegerFeature(orgId: string, featureKey: string, db: Db = this.db): Promise<number> {
    const result = await db.query(
      `SELECT get_effective_integer_feature($1, $2) as limit_val`,
      [orgId, featureKey]
    );
    return parseInt(result.rows[0]?.limit_val ?? '0', 10);
  }
}
