import { pool } from '../../../config/database.js';
import { CouponDiscountType } from '../shared/types.js';
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
        const result = await db.query(`SELECT * FROM coupons 
       WHERE code = $1 AND deleted_at IS NULL AND is_active = TRUE`, [code.toUpperCase()]);
        return result.rows[0] || null;
    }
    async getCouponByCodeForUpdate(code, db) {
        const result = await db.query(`SELECT * FROM coupons 
       WHERE code = $1 AND deleted_at IS NULL AND is_active = TRUE
       FOR UPDATE`, [code.toUpperCase()]);
        return result.rows[0] || null;
    }
    async isCouponApplicableToPlan(couponId, planId, db = this.db) {
        const result = await db.query(`SELECT 1 FROM coupon_applicable_plans 
       WHERE coupon_id = $1 AND plan_id = $2`, [couponId, planId]);
        // If the table is empty for this coupon, maybe it applies to all? 
        // Usually yes, let's assume it applies to all if no rows exist in coupon_applicable_plans for this coupon.
        const hasRestrictions = await db.query(`SELECT 1 FROM coupon_applicable_plans WHERE coupon_id = $1 LIMIT 1`, [couponId]);
        if (hasRestrictions.rows.length === 0) {
            return true; // No restrictions
        }
        return result.rows.length > 0;
    }
    async getOrgRedemptionCount(couponId, orgId, db = this.db) {
        const result = await db.query(`SELECT COUNT(*)::int as count FROM coupon_redemptions 
       WHERE coupon_id = $1 AND organization_id = $2`, [couponId, orgId]);
        return result.rows[0]?.count ?? 0;
    }
    async redeemCoupon(couponId, orgId, userId, discountAmount, currency, db = this.db) {
        await db.query(`INSERT INTO coupon_redemptions (
         coupon_id, organization_id, redeemed_by, discount_amount, currency
       ) VALUES ($1, $2, $3, $4, $5)`, [couponId, orgId, userId, discountAmount, currency]);
        await db.query(`UPDATE coupons SET redemption_count = redemption_count + 1 WHERE id = $1`, [couponId]);
    }
}
//# sourceMappingURL=repository.js.map