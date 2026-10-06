import { pool } from '../../../config/database.js';
import { CouponDiscountType } from '../shared/types.js';
export const COUPON_COLUMNS = `
  id, code, name, description, discount_type, discount_value, currency,
  max_redemptions, redemption_count, max_redemptions_per_org,
  first_time_customers_only, trial_only, valid_from, valid_until,
  is_active, is_public
`;
export class CouponsRepository {
    db;
    constructor(db = pool) {
        this.db = db;
    }
    async withTransaction(callback) {
        const client = await this.db.connect();
        try {
            await client.query('BEGIN');
            const result = await callback(client);
            await client.query('COMMIT');
            return result;
        }
        catch (error) {
            await client.query('ROLLBACK');
            throw error;
        }
        finally {
            client.release();
        }
    }
    async getCouponByCode(code, db = this.db) {
        const result = await db.query(`SELECT ${COUPON_COLUMNS} FROM coupons 
       WHERE code = $1 AND deleted_at IS NULL AND is_active = TRUE`, [code.toUpperCase()]);
        return result.rows[0] || null;
    }
    async getCouponByCodeForUpdate(code, db) {
        const result = await db.query(`SELECT ${COUPON_COLUMNS} FROM coupons 
       WHERE code = $1 AND deleted_at IS NULL AND is_active = TRUE
       FOR UPDATE`, [code.toUpperCase()]);
        return result.rows[0] || null;
    }
    async isCouponApplicableToPlan(couponId, planId, db = this.db) {
        const result = await db.query(`SELECT 
         EXISTS(SELECT 1 FROM coupon_applicable_plans WHERE coupon_id = $1) AS has_restrictions,
         EXISTS(SELECT 1 FROM coupon_applicable_plans WHERE coupon_id = $1 AND plan_id = $2) AS is_applicable`, [couponId, planId]);
        const row = result.rows[0];
        if (!row || !row.has_restrictions) {
            return true; // No restrictions
        }
        return Boolean(row.is_applicable);
    }
    async getActiveSubscriptionForCoupon(orgId, db = this.db) {
        const result = await db.query(`SELECT id, plan_id, billing_interval, status
       FROM organization_subscriptions
       WHERE organization_id = $1
         AND status IN ('trialing', 'active')
         AND deleted_at IS NULL
         AND current_period_end > NOW()
       ORDER BY
         CASE status WHEN 'active' THEN 0 WHEN 'trialing' THEN 1 ELSE 2 END,
         created_at DESC
       LIMIT 1
       FOR UPDATE`, [orgId]);
        return result.rows[0] || null;
    }
    async getCurrentPlanPrice(planId, billingInterval, currency, db = this.db) {
        const values = [planId, billingInterval];
        const currencyClause = currency ? `AND currency = $3` : '';
        if (currency)
            values.push(currency);
        const result = await db.query(`SELECT amount_minor, currency
       FROM plan_prices
       WHERE plan_id = $1
         AND billing_interval = $2
         AND deleted_at IS NULL
         AND (starts_at IS NULL OR starts_at <= NOW())
         AND (ends_at IS NULL OR ends_at > NOW())
         ${currencyClause}
       ORDER BY is_default DESC, starts_at DESC NULLS LAST, created_at DESC
       LIMIT 1`, values);
        return result.rows[0] || null;
    }
    async getOrgRedemptionCount(couponId, orgId, db = this.db) {
        const result = await db.query(`SELECT COUNT(*)::int as count FROM coupon_redemptions 
       WHERE coupon_id = $1 AND organization_id = $2`, [couponId, orgId]);
        return result.rows[0]?.count ?? 0;
    }
    async redeemCoupon(couponId, orgId, userId, subscriptionId, discountAmount, currency, db = this.db) {
        await db.query(`INSERT INTO coupon_redemptions (
         coupon_id, organization_id, subscription_id, redeemed_by, discount_amount, currency, redemption_source
       ) VALUES ($1, $2, $3, $4, $5, $6, 'api')`, [couponId, orgId, subscriptionId, userId, discountAmount, currency]);
        await db.query(`UPDATE coupons SET redemption_count = redemption_count + 1 WHERE id = $1`, [couponId]);
    }
}
//# sourceMappingURL=repository.js.map