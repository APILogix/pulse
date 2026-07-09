import { pool } from '../../../config/database.js';
import { SubscriptionStatus, BillingProvider, BillingInterval, SubscriptionEventType, SubscriptionEventActor } from '../shared/types.js';
export class SubscriptionsRepository {
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
    async getActiveSubscription(orgId, db = this.db) {
        const result = await db.query(`SELECT * FROM organization_subscriptions 
       WHERE organization_id = $1 AND status IN ('trialing','active','past_due') 
       AND deleted_at IS NULL
       ORDER BY created_at DESC LIMIT 1`, [orgId]);
        return result.rows[0] || null;
    }
    async getSubscriptionForUpdate(orgId, db) {
        const result = await db.query(`SELECT * FROM organization_subscriptions 
       WHERE organization_id = $1 AND status IN ('trialing','active','past_due') 
       AND deleted_at IS NULL
       ORDER BY created_at DESC LIMIT 1
       FOR UPDATE`, [orgId]);
        return result.rows[0] || null;
    }
    async createSubscription(sub, db = this.db) {
        const result = await db.query(`INSERT INTO organization_subscriptions (
         organization_id, plan_id, status, provider, billing_interval,
         provider_customer_id, provider_subscription_id, current_period_start,
         current_period_end, trial_start, trial_end, cancel_at_period_end
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING *`, [
            sub.organization_id, sub.plan_id, sub.status, sub.provider ?? BillingProvider.SYSTEM,
            sub.billing_interval, sub.provider_customer_id, sub.provider_subscription_id,
            sub.current_period_start, sub.current_period_end, sub.trial_start, sub.trial_end,
            sub.cancel_at_period_end ?? false
        ]);
        return result.rows[0];
    }
    async updateSubscription(id, updates, db = this.db) {
        const fields = [];
        const values = [];
        let i = 1;
        for (const [key, value] of Object.entries(updates)) {
            if (value !== undefined) {
                fields.push(`${key} = $${i++}`);
                values.push(value);
            }
        }
        if (fields.length === 0) {
            throw new Error('No updates provided');
        }
        values.push(id);
        const result = await db.query(`UPDATE organization_subscriptions SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`, values);
        return result.rows[0];
    }
    async logEvent(event, db = this.db) {
        await db.query(`INSERT INTO subscription_events (
         organization_id, subscription_id, event_type, actor, 
         actor_user_id, old_plan_id, new_plan_id
       ) VALUES ($1, $2, $3, $4, $5, $6, $7)`, [
            event.organization_id, event.subscription_id, event.event_type,
            event.actor, event.actor_user_id, event.old_plan_id, event.new_plan_id
        ]);
    }
    async getSubscriptionHistory(orgId, db = this.db) {
        const result = await db.query(`SELECT * FROM subscription_events WHERE organization_id = $1 ORDER BY created_at DESC`, [orgId]);
        return result.rows;
    }
}
//# sourceMappingURL=repository.js.map