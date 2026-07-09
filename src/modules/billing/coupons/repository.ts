import { pool } from '../../../config/database.js';
import type { Pool, PoolClient } from 'pg';
import { CouponDiscountType } from '../shared/types.js';

type Db = Pool | PoolClient;

export interface CouponRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  discount_type: CouponDiscountType;
  discount_value: number;
  currency: string | null;
  max_redemptions: number | null;
  redemption_count: number;
  max_redemptions_per_org: number;
  first_time_customers_only: boolean;
  trial_only: boolean;
  valid_from: Date;
  valid_until: Date | null;
  is_active: boolean;
  is_public: boolean;
}

export class CouponsRepository {
  constructor(private readonly db: Pool = pool) {}

  async withTransaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async getCouponByCode(code: string, db: Db = this.db): Promise<CouponRow | null> {
    const result = await db.query(
      `SELECT * FROM coupons 
       WHERE code = $1 AND deleted_at IS NULL AND is_active = TRUE`,
      [code.toUpperCase()]
    );
    return result.rows[0] || null;
  }

  async getCouponByCodeForUpdate(code: string, db: PoolClient): Promise<CouponRow | null> {
    const result = await db.query(
      `SELECT * FROM coupons 
       WHERE code = $1 AND deleted_at IS NULL AND is_active = TRUE
       FOR UPDATE`,
      [code.toUpperCase()]
    );
    return result.rows[0] || null;
  }

  async isCouponApplicableToPlan(couponId: string, planId: string, db: Db = this.db): Promise<boolean> {
    const result = await db.query(
      `SELECT 1 FROM coupon_applicable_plans 
       WHERE coupon_id = $1 AND plan_id = $2`,
      [couponId, planId]
    );
    // If the table is empty for this coupon, maybe it applies to all? 
    // Usually yes, let's assume it applies to all if no rows exist in coupon_applicable_plans for this coupon.
    const hasRestrictions = await db.query(
      `SELECT 1 FROM coupon_applicable_plans WHERE coupon_id = $1 LIMIT 1`,
      [couponId]
    );

    if (hasRestrictions.rows.length === 0) {
      return true; // No restrictions
    }

    return result.rows.length > 0;
  }

  async getOrgRedemptionCount(couponId: string, orgId: string, db: Db = this.db): Promise<number> {
    const result = await db.query(
      `SELECT COUNT(*)::int as count FROM coupon_redemptions 
       WHERE coupon_id = $1 AND organization_id = $2`,
      [couponId, orgId]
    );
    return result.rows[0]?.count ?? 0;
  }

  async redeemCoupon(
    couponId: string, 
    orgId: string, 
    userId: string, 
    discountAmount: number, 
    currency: string, 
    db: Db = this.db
  ): Promise<void> {
    await db.query(
      `INSERT INTO coupon_redemptions (
         coupon_id, organization_id, redeemed_by, discount_amount, currency
       ) VALUES ($1, $2, $3, $4, $5)`,
      [couponId, orgId, userId, discountAmount, currency]
    );

    await db.query(
      `UPDATE coupons SET redemption_count = redemption_count + 1 WHERE id = $1`,
      [couponId]
    );
  }
}
