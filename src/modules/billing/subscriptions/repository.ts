import { pool } from '../../../config/database.js';
import type { Pool, PoolClient } from 'pg';
import {
  AI_CREDIT_LIMIT_FEATURE_KEY,
  EVENT_LIMIT_FEATURE_KEY,
  type BillingEntitlementSnapshotRow,
  buildEntitlementsSnapshot,
  buildModulesSnapshot,
  integerEntitlement,
  usageLimitParameter,
} from '../shared/entitlement-snapshot.js';
import { 
  SubscriptionStatus, 
  BillingProvider, 
  BillingInterval,
  SubscriptionEventType,
  SubscriptionEventActor
} from '../shared/types.js';

type Db = Pool | PoolClient;
const SUBSCRIPTION_UPDATE_COLUMNS = new Set<keyof SubscriptionRow>([
  'plan_id',
  'status',
  'provider',
  'billing_interval',
  'provider_customer_id',
  'provider_subscription_id',
  'current_period_start',
  'current_period_end',
  'trial_start',
  'trial_end',
  'cancel_at_period_end',
  'cancelled_at',
  'modules',
  'addons',
  'metadata',
  'deleted_at',
]);

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
  modules: Record<string, unknown>;
  addons: unknown[];
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
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
  metadata?: Record<string, unknown>;
  created_at: Date;
}

export interface UsageLimitSnapshot {
  eventLimit: number;
  aiCreditLimit: number;
  modules: Record<string, unknown>;
  entitlements: Record<string, unknown>;
}

export const SUBSCRIPTION_COLUMNS = `
  id, organization_id, plan_id, status, provider, billing_interval,
  provider_customer_id, provider_subscription_id, current_period_start,
  current_period_end, trial_start, trial_end, cancel_at_period_end,
  cancelled_at, modules, addons, metadata, created_at, updated_at, deleted_at
`;

export const SUBSCRIPTION_EVENT_COLUMNS = `
  id, organization_id, subscription_id, event_type, actor,
  actor_user_id, old_plan_id, new_plan_id, metadata, created_at
`;

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
      `SELECT ${SUBSCRIPTION_COLUMNS} FROM organization_subscriptions 
       WHERE organization_id = $1 AND status IN ('trialing','active')
       AND deleted_at IS NULL
       AND current_period_end > NOW()
       ORDER BY created_at DESC LIMIT 1`,
      [orgId]
    );
    return result.rows[0] || null;
  }

  async getSubscriptionForUpdate(orgId: string, db: PoolClient): Promise<SubscriptionRow | null> {
    const result = await db.query(
      `SELECT ${SUBSCRIPTION_COLUMNS} FROM organization_subscriptions 
       WHERE organization_id = $1 AND status IN ('trialing','active','past_due') 
       AND deleted_at IS NULL
       AND current_period_end > NOW()
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
         current_period_end, trial_start, trial_end, cancel_at_period_end,
         modules, metadata
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14::jsonb)
       RETURNING ${SUBSCRIPTION_COLUMNS}`,
      [
        sub.organization_id, sub.plan_id, sub.status, sub.provider ?? BillingProvider.SYSTEM,
        sub.billing_interval, sub.provider_customer_id, sub.provider_subscription_id,
        sub.current_period_start, sub.current_period_end, sub.trial_start, sub.trial_end,
        sub.cancel_at_period_end ?? false,
        JSON.stringify(sub.modules ?? {}),
        JSON.stringify(sub.metadata ?? {}),
      ]
    );
    return result.rows[0];
  }

  async getPlanUsageLimitSnapshot(planId: string, db: Db = this.db): Promise<UsageLimitSnapshot> {
    const result = await db.query<BillingEntitlementSnapshotRow>(
      `SELECT
         bf.feature_key,
         bf.module,
         bf.is_module_root,
         bf.value_type,
         pfe.boolean_value,
         pfe.integer_value,
         pfe.decimal_value,
         pfe.string_value
       FROM plan_feature_entitlements pfe
       JOIN billing_features bf ON bf.id = pfe.feature_id
       WHERE pfe.plan_id = $1
         AND pfe.deleted_at IS NULL
         AND bf.deleted_at IS NULL
         AND bf.is_deprecated = FALSE
       ORDER BY bf.sort_order ASC, bf.feature_key ASC`,
      [planId],
    );
    const rows = result.rows;
    return {
      eventLimit: integerEntitlement(rows, EVENT_LIMIT_FEATURE_KEY),
      aiCreditLimit: integerEntitlement(rows, AI_CREDIT_LIMIT_FEATURE_KEY),
      modules: buildModulesSnapshot(rows),
      entitlements: buildEntitlementsSnapshot(rows),
    };
  }

  async upsertUsageCurrentPeriod(
    orgId: string,
    subscription: Pick<SubscriptionRow, 'id' | 'current_period_start' | 'current_period_end'>,
    limits: UsageLimitSnapshot,
    db: Db = this.db,
  ): Promise<void> {
    await db.query(
      `INSERT INTO organization_usage_current_period (
         organization_id, subscription_id, period_start, period_end,
         events_used, ai_credits_used, projects_used, members_used,
         api_keys_used, connectors_used, alert_rules_used, dashboards_used,
         event_limit, ai_credit_limit, overage_events, overage_ai_credits,
         metadata
       ) VALUES (
         $1, $2, $3, $4,
         0, 0, 0, 1,
         0, 0, 0, 0,
         $5, $6, 0, 0,
         $7::jsonb
       )
       ON CONFLICT (organization_id) DO UPDATE
       SET subscription_id = EXCLUDED.subscription_id,
           period_start = EXCLUDED.period_start,
           period_end = EXCLUDED.period_end,
           event_limit = EXCLUDED.event_limit,
           ai_credit_limit = EXCLUDED.ai_credit_limit,
           metadata = organization_usage_current_period.metadata || EXCLUDED.metadata,
           updated_at = NOW()`,
      [
        orgId,
        subscription.id,
        subscription.current_period_start,
        subscription.current_period_end,
        usageLimitParameter(limits.eventLimit),
        usageLimitParameter(limits.aiCreditLimit),
        JSON.stringify({
          source: 'subscription_plan_change',
          entitlements: limits.entitlements,
          modules: limits.modules,
        }),
      ],
    );
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
        if (!SUBSCRIPTION_UPDATE_COLUMNS.has(key as keyof SubscriptionRow)) {
          throw new Error(`Unsupported subscription update column: ${key}`);
        }
        fields.push(`${key} = $${i++}`);
        values.push(value);
      }
    }

    if (fields.length === 0) {
      throw new Error('No updates provided');
    }

    values.push(id);
    const result = await db.query(
      `UPDATE organization_subscriptions SET ${fields.join(', ')} WHERE id = $${i} RETURNING ${SUBSCRIPTION_COLUMNS}`,
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
         actor_user_id, old_plan_id, new_plan_id, metadata
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
      [
        event.organization_id, event.subscription_id, event.event_type, 
        event.actor, event.actor_user_id, event.old_plan_id, event.new_plan_id,
        JSON.stringify(event.metadata ?? {}),
      ]
    );
  }

  async getSubscriptionHistory(orgId: string, limit = 100, db: Db = this.db): Promise<SubscriptionEventRow[]> {
    const result = await db.query(
      `SELECT ${SUBSCRIPTION_EVENT_COLUMNS} FROM subscription_events WHERE organization_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [orgId, limit]
    );
    return result.rows;
  }

  async getSubscriptionSummary(orgId: string, db: Db = this.db): Promise<Record<string, unknown>> {
    const result = await db.query(
      `WITH subscription_summary AS (
         SELECT
           os.id,
           os.organization_id,
           os.plan_id,
           p.name AS plan_name,
           p.key AS plan_key,
           p.tier,
           os.status,
           os.billing_interval,
           os.current_period_start,
           os.current_period_end,
           os.cancel_at_period_end,
           os.cancelled_at,
           os.modules,
           os.addons
         FROM organization_subscriptions os
         JOIN plans p ON p.id = os.plan_id
         WHERE os.organization_id = $1
           AND os.deleted_at IS NULL
         ORDER BY
           CASE os.status WHEN 'active' THEN 0 WHEN 'trialing' THEN 1 WHEN 'past_due' THEN 2 ELSE 3 END,
           os.created_at DESC
         LIMIT 1
       ),
       usage_summary AS (
         SELECT
           organization_id,
           period_start,
           period_end,
           events_used,
           event_limit,
           GREATEST(event_limit - events_used, 0) AS remaining_events,
           ai_credits_used,
           ai_credit_limit,
           GREATEST(ai_credit_limit - ai_credits_used, 0) AS remaining_ai_credits,
           projects_used,
           members_used,
           api_keys_used,
           connectors_used,
           alert_rules_used,
           dashboards_used
         FROM organization_usage_current_period
         WHERE organization_id = $1
       ),
       invoice_summary AS (
         SELECT
           COUNT(*)::int AS invoice_count,
           COUNT(*) FILTER (WHERE status = 'open')::int AS open_invoice_count,
           COALESCE(SUM(total_amount - amount_paid) FILTER (WHERE status = 'open'), 0)::bigint AS open_balance,
           MAX(created_at) AS last_invoice_at
         FROM invoices
         WHERE organization_id = $1
           AND deleted_at IS NULL
       ),
       payment_summary AS (
         SELECT
           COUNT(*)::int AS payment_count,
           COALESCE(SUM(amount) FILTER (WHERE status = 'succeeded'), 0)::bigint AS total_paid,
           MAX(captured_at) FILTER (WHERE status = 'succeeded') AS last_paid_at
         FROM payments
         WHERE organization_id = $1
           AND deleted_at IS NULL
       )
       SELECT jsonb_build_object(
         'subscription', COALESCE(to_jsonb(subscription_summary), 'null'::jsonb),
         'usage', COALESCE(to_jsonb(usage_summary), 'null'::jsonb),
         'invoices', to_jsonb(invoice_summary),
         'payments', to_jsonb(payment_summary)
       ) AS summary
       FROM invoice_summary
       CROSS JOIN payment_summary
       LEFT JOIN subscription_summary ON TRUE
       LEFT JOIN usage_summary ON TRUE`,
      [orgId]
    );
    return result.rows[0]?.summary ?? {};
  }
}
