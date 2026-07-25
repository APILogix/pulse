import { pool } from '../../../config/database.js';
import { BillingProvider } from '../shared/types.js';
export class AddonsRepository {
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
    async listAddons(query, db = this.db) {
        const values = [];
        const where = ['a.is_active = TRUE'];
        if (query.tier) {
            values.push(query.tier);
            where.push(`($${values.length}::billing_plan_tier = ANY(a.available_in_tiers) OR cardinality(a.available_in_tiers) = 0)`);
            where.push(`NOT ($${values.length}::billing_plan_tier = ANY(a.not_available_in_tiers))`);
        }
        const countResult = await db.query(`SELECT COUNT(*)::int AS total FROM addons a WHERE ${where.join(' AND ')}`, values);
        values.push(query.billingInterval ?? null, query.limit, (query.page - 1) * query.limit);
        const result = await db.query(`SELECT a.*,
              COALESCE(
                jsonb_agg(to_jsonb(ap) ORDER BY ap.is_default DESC, ap.amount_minor)
                  FILTER (WHERE ap.id IS NOT NULL),
                '[]'::jsonb
              ) AS prices
         FROM addons a
         LEFT JOIN addon_prices ap
           ON ap.addon_id = a.id
          AND ($${values.length - 2}::billing_interval_type IS NULL OR ap.billing_interval = $${values.length - 2}::billing_interval_type)
          AND (ap.starts_at IS NULL OR ap.starts_at <= NOW())
          AND (ap.ends_at IS NULL OR ap.ends_at > NOW())
        WHERE ${where.join(' AND ')}
        GROUP BY a.id
        ORDER BY a.sort_order, a.name
        LIMIT $${values.length - 1} OFFSET $${values.length}`, values);
        return { data: result.rows, total: countResult.rows[0]?.total ?? 0 };
    }
    async listSubscriptionAddons(orgId, db = this.db) {
        const result = await db.query(`SELECT sa.*
         FROM subscription_addons sa
        WHERE sa.organization_id = $1
          AND sa.status IN ('active','scheduled')
        ORDER BY sa.created_at DESC`, [orgId]);
        return result.rows;
    }
    async getActiveSubscription(orgId, db) {
        const result = await db.query(`SELECT *
         FROM organization_subscriptions
        WHERE organization_id = $1
          AND status IN ('trialing','active')
          AND deleted_at IS NULL
          AND current_period_end > NOW()
        ORDER BY created_at DESC
        LIMIT 1
        FOR UPDATE`, [orgId]);
        return result.rows[0] ?? null;
    }
    async getAddonForUpdate(addonId, db) {
        const result = await db.query(`SELECT *
         FROM addons
        WHERE id = $1 AND is_active = TRUE
        FOR UPDATE`, [addonId]);
        return result.rows[0] ?? null;
    }
    async subscribeAddon(orgId, body, db) {
        const subscription = await this.getActiveSubscription(orgId, db);
        if (!subscription)
            return null;
        const addon = await this.getAddonForUpdate(body.addonId, db);
        if (!addon?.target_feature_id)
            return null;
        const result = await db.query(`INSERT INTO subscription_addons (
         subscription_id, organization_id, feature_id, quantity, provider,
         status, metadata, addon_id, addon_key, module
       ) VALUES ($1,$2,$3,$4,'system','active',$5,$6,$7,$8)
       RETURNING *`, [
            subscription.id,
            orgId,
            addon.target_feature_id,
            body.quantity,
            JSON.stringify(body.metadata),
            addon.id,
            addon.key,
            addon.target_module,
        ]);
        return result.rows[0];
    }
    async cancelSubscriptionAddon(orgId, subscriptionAddonId, db = this.db) {
        const result = await db.query(`UPDATE subscription_addons
          SET status = 'cancelled', updated_at = NOW()
        WHERE id = $1
          AND organization_id = $2
          AND status IN ('active','scheduled')
        RETURNING *`, [subscriptionAddonId, orgId]);
        return result.rows[0] ?? null;
    }
}
//# sourceMappingURL=repository.js.map