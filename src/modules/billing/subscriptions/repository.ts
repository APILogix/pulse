import { pool } from '../../../config/database.js';
import type { Pool, PoolClient } from 'pg';
import { 
  SubscriptionStatus, 
  BillingProvider, 
  BillingInterval,
  SubscriptionEventType,
  SubscriptionEventActor
} from '../shared/types.js';

type Db = Pool | PoolClient;

export interface SubscriptionRow {
  id: string;
  organization_id: string;
  plan_id: string;
  status: SubscriptionStatus;
  provider: BillingProvider;
  billing_interval: BillingInterval;
  provider_customer_id: string | null;
  provider_subscription_id: string | null;
  current_period_start: Date;
  current_period_end: Date;
  trial_start: Date | null;
  trial_end: Date | null;
  cancel_at_period_end: boolean;
  cancelled_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface SubscriptionEventRow {
  id: string;
  organization_id: string;
  subscription_id: string;
  event_type: SubscriptionEventType;
  actor: SubscriptionEventActor;
  actor_user_id: string | null;
  old_plan_id: string | null;
  new_plan_id: string | null;
  created_at: Date;
}

export class SubscriptionsRepository {
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

  async getActiveSubscription(orgId: string, db: Db = this.db): Promise<SubscriptionRow | null> {
    const result = await db.query(
      `SELECT * FROM organization_subscriptions 
       WHERE organization_id = $1 AND status IN ('trialing','active','past_due') 
       AND deleted_at IS NULL
       ORDER BY created_at DESC LIMIT 1`,
      [orgId]
    );
    return result.rows[0] || null;
  }

  async getSubscriptionForUpdate(orgId: string, db: PoolClient): Promise<SubscriptionRow | null> {
    const result = await db.query(
      `SELECT * FROM organization_subscriptions 
       WHERE organization_id = $1 AND status IN ('trialing','active','past_due') 
       AND deleted_at IS NULL
       ORDER BY created_at DESC LIMIT 1
       FOR UPDATE`,
      [orgId]
    );
    return result.rows[0] || null;
  }

  async createSubscription(sub: Partial<SubscriptionRow>, db: Db = this.db): Promise<SubscriptionRow> {
    const result = await db.query(
      `INSERT INTO organization_subscriptions (
         organization_id, plan_id, status, provider, billing_interval,
         provider_customer_id, provider_subscription_id, current_period_start,
         current_period_end, trial_start, trial_end, cancel_at_period_end
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING *`,
      [
        sub.organization_id, sub.plan_id, sub.status, sub.provider ?? BillingProvider.SYSTEM,
        sub.billing_interval, sub.provider_customer_id, sub.provider_subscription_id,
        sub.current_period_start, sub.current_period_end, sub.trial_start, sub.trial_end,
        sub.cancel_at_period_end ?? false
      ]
    );
    return result.rows[0];
  }

  async updateSubscription(
    id: string, 
    updates: Partial<SubscriptionRow>, 
    db: Db = this.db
  ): Promise<SubscriptionRow> {
    const fields: string[] = [];
    const values: any[] = [];
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
    const result = await db.query(
      `UPDATE organization_subscriptions SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`,
      values
    );
    return result.rows[0];
  }

  async logEvent(
    event: Omit<SubscriptionEventRow, 'id' | 'created_at'>, 
    db: Db = this.db
  ): Promise<void> {
    await db.query(
      `INSERT INTO subscription_events (
         organization_id, subscription_id, event_type, actor, 
         actor_user_id, old_plan_id, new_plan_id
       ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        event.organization_id, event.subscription_id, event.event_type, 
        event.actor, event.actor_user_id, event.old_plan_id, event.new_plan_id
      ]
    );
  }

  async getSubscriptionHistory(orgId: string, db: Db = this.db): Promise<SubscriptionEventRow[]> {
    const result = await db.query(
      `SELECT * FROM subscription_events WHERE organization_id = $1 ORDER BY created_at DESC`,
      [orgId]
    );
    return result.rows;
  }
}
