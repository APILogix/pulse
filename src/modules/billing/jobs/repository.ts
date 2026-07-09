import type { Pool, PoolClient, QueryResult } from 'pg';
import { pool } from '../../../config/database.js';
import type { BillingBatchResult, BillingJobConfig } from './types.js';

type DbClient = Pool | PoolClient;
type TxWork<T> = (client: PoolClient) => Promise<T>;

interface CountRow {
  count: string;
}

function rowCount(result: QueryResult): number {
  return result.rowCount ?? 0;
}

function firstCount(result: QueryResult<CountRow>): number {
  return Number.parseInt(result.rows[0]?.count ?? '0', 10);
}

function nextPeriodEndSql(): string {
  return `
    CASE
      WHEN billing_interval = 'annual' THEN current_period_end + INTERVAL '1 year'
      ELSE current_period_end + INTERVAL '1 month'
    END
  `;
}

function dateLiteral(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function quoteIdent(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

export class BillingJobsRepository {
  constructor(private readonly db: Pool = pool) {}

  async withTransaction<T>(work: TxWork<T>): Promise<T> {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async renewSubscriptions(batchSize: number): Promise<BillingBatchResult> {
    return this.withTransaction(async (client) => {
      const invoiceResult = await client.query(
        `
        WITH due AS (
          SELECT os.id, os.organization_id, os.provider, os.billing_interval,
                 os.current_period_start, os.current_period_end, os.plan_id
          FROM organization_subscriptions os
          WHERE os.status = 'active'
            AND os.current_period_end <= NOW()
            AND os.deleted_at IS NULL
          ORDER BY os.current_period_end, os.id
          LIMIT $1
          FOR UPDATE SKIP LOCKED
        ),
        priced AS (
          SELECT d.*,
                 COALESCE(pp.currency, 'USD') AS currency,
                 COALESCE(pp.amount_minor, 0) AS base_amount,
                 COALESCE(u.overage_events, 0) AS overage_events
          FROM due d
          LEFT JOIN plan_prices pp
            ON pp.plan_id = d.plan_id
           AND pp.billing_interval = d.billing_interval
           AND pp.is_default = TRUE
           AND pp.deleted_at IS NULL
          LEFT JOIN organization_usage_current_period u
            ON u.organization_id = d.organization_id
        ),
        inserted AS (
          INSERT INTO invoices (
            organization_id, subscription_id, provider, provider_invoice_id,
            invoice_number, status, currency, subtotal_amount, tax_amount,
            discount_amount, total_amount, amount_paid, period_start, period_end,
            due_at, overage_events, overage_amount, metadata
          )
          SELECT organization_id, id, provider, NULL,
                 'INV-' || upper(substr(md5(id::text || current_period_start::text || current_period_end::text), 1, 18)),
                 CASE WHEN base_amount = 0 THEN 'paid'::billing_invoice_status ELSE 'open'::billing_invoice_status END,
                 currency, base_amount, 0, 0, base_amount, CASE WHEN base_amount = 0 THEN 0 ELSE 0 END,
                 current_period_start, current_period_end, NOW() + INTERVAL '7 days',
                 overage_events, 0,
                 jsonb_build_object('source','subscription-renewal')
          FROM priced
          ON CONFLICT (invoice_number) DO NOTHING
          RETURNING subscription_id
        )
        SELECT COUNT(*)::text AS count FROM inserted
        `,
        [batchSize],
      );

      const renewResult = await client.query(
        `
        WITH due AS (
          SELECT id, organization_id, plan_id, current_period_start, current_period_end, billing_interval
          FROM organization_subscriptions
          WHERE status = 'active'
            AND current_period_end <= NOW()
            AND deleted_at IS NULL
          ORDER BY current_period_end, id
          LIMIT $1
          FOR UPDATE SKIP LOCKED
        ),
        renewed AS (
          UPDATE organization_subscriptions os
          SET current_period_start = d.current_period_end,
              current_period_end = ${nextPeriodEndSql()},
              updated_at = NOW()
          FROM due d
          WHERE os.id = d.id
          RETURNING os.id, os.organization_id, os.plan_id, d.current_period_start AS old_start, d.current_period_end AS old_end
        ),
        usage_reset AS (
          UPDATE organization_usage_current_period u
          SET subscription_id = r.id,
              period_start = r.old_end,
              period_end = os.current_period_end,
              events_used = 0,
              ai_credits_used = 0,
              overage_events = 0,
              overage_ai_credits = 0,
              updated_at = NOW()
          FROM renewed r
          JOIN organization_subscriptions os ON os.id = r.id
          WHERE u.organization_id = r.organization_id
          RETURNING u.organization_id
        ),
        events AS (
          INSERT INTO subscription_events (organization_id, subscription_id, event_type, actor, old_plan_id, new_plan_id, metadata)
          SELECT organization_id, id, 'renewed', 'system', plan_id, plan_id,
                 jsonb_build_object('source','subscription-renewal')
          FROM renewed
          RETURNING id
        ),
        audits AS (
          INSERT INTO billing_audit_logs (organization_id, subscription_id, actor_type, action, metadata)
          SELECT organization_id, id, 'system', 'subscription.renewed',
                 jsonb_build_object('source','subscription-renewal')
          FROM renewed
          RETURNING id
        )
        SELECT COUNT(*)::text AS count FROM renewed
        `,
        [batchSize],
      );

      return { processed: firstCount(renewResult), failed: 0, retried: 0 };
    });
  }

  async expireTrials(batchSize: number): Promise<BillingBatchResult> {
    return this.withTransaction(async (client) => {
      const result = await client.query(
        `
        WITH due AS (
          SELECT os.id, os.organization_id, os.plan_id,
                 EXISTS (
                   SELECT 1 FROM payments p
                   WHERE p.subscription_id = os.id
                     AND p.status = 'succeeded'
                     AND p.deleted_at IS NULL
                 ) AS has_payment
          FROM organization_subscriptions os
          WHERE os.status = 'trialing'
            AND os.trial_end <= NOW()
            AND os.deleted_at IS NULL
          ORDER BY os.trial_end, os.id
          LIMIT $1
          FOR UPDATE SKIP LOCKED
        ),
        changed AS (
          UPDATE organization_subscriptions os
          SET status = CASE WHEN d.has_payment THEN 'active'::billing_subscription_status ELSE 'paused'::billing_subscription_status END,
              updated_at = NOW()
          FROM due d
          WHERE os.id = d.id
          RETURNING os.id, os.organization_id, os.plan_id, os.status
        ),
        events AS (
          INSERT INTO subscription_events (organization_id, subscription_id, event_type, actor, old_plan_id, new_plan_id, metadata)
          SELECT organization_id, id, 'trial_ended', 'system', plan_id, plan_id,
                 jsonb_build_object('new_status', status, 'source', 'trial-expiration')
          FROM changed
          RETURNING id
        ),
        audits AS (
          INSERT INTO billing_audit_logs (organization_id, subscription_id, actor_type, action, new_state, metadata)
          SELECT organization_id, id, 'system', 'subscription.trial_expired',
                 jsonb_build_object('status', status), jsonb_build_object('source','trial-expiration')
          FROM changed
          RETURNING id
        )
        SELECT COUNT(*)::text AS count FROM changed
        `,
        [batchSize],
      );
      return { processed: firstCount(result), failed: 0, retried: 0 };
    });
  }

  async generateInvoices(batchSize: number): Promise<BillingBatchResult> {
    return this.withTransaction(async (client) => {
      const result = await client.query(
        `
        WITH candidates AS (
          SELECT os.id, os.organization_id, os.plan_id, os.provider, os.billing_interval,
                 os.current_period_start, os.current_period_end
          FROM organization_subscriptions os
          WHERE os.status IN ('active','past_due')
            AND os.deleted_at IS NULL
            AND NOT EXISTS (
              SELECT 1 FROM invoices i
              WHERE i.subscription_id = os.id
                AND i.period_start = os.current_period_start
                AND i.period_end = os.current_period_end
                AND i.deleted_at IS NULL
            )
          ORDER BY os.current_period_end, os.id
          LIMIT $1
          FOR UPDATE SKIP LOCKED
        ),
        priced AS (
          SELECT c.*,
                 COALESCE(pp.currency, 'USD') AS currency,
                 COALESCE(pp.amount_minor, 0) AS subtotal_amount,
                 COALESCE(u.overage_events, 0) AS overage_events,
                 COALESCE(u.overage_events, 0) * 0 AS overage_amount
          FROM candidates c
          LEFT JOIN plan_prices pp
            ON pp.plan_id = c.plan_id
           AND pp.billing_interval = c.billing_interval
           AND pp.is_default = TRUE
           AND pp.deleted_at IS NULL
          LEFT JOIN organization_usage_current_period u
            ON u.organization_id = c.organization_id
        ),
        discounted AS (
          SELECT p.*,
                 LEAST(
                   p.subtotal_amount + p.overage_amount,
                   COALESCE((
                     SELECT CASE
                       WHEN c.discount_type = 'percentage' THEN ((p.subtotal_amount + p.overage_amount) * c.discount_value / 100)::bigint
                       ELSE c.discount_value::bigint
                     END
                     FROM coupon_redemptions cr
                     JOIN coupons c ON c.id = cr.coupon_id
                     WHERE cr.organization_id = p.organization_id
                       AND c.is_active = TRUE
                       AND c.deleted_at IS NULL
                       AND (c.valid_until IS NULL OR c.valid_until > NOW())
                     ORDER BY cr.redeemed_at DESC
                     LIMIT 1
                   ), 0)
                 ) AS discount_amount
          FROM priced p
        ),
        inserted AS (
          INSERT INTO invoices (
            organization_id, subscription_id, provider, provider_invoice_id,
            invoice_number, status, currency, subtotal_amount, tax_amount,
            discount_amount, total_amount, amount_paid, period_start, period_end,
            due_at, overage_events, overage_amount, metadata
          )
          SELECT organization_id, id, provider, NULL,
                 'INV-' || upper(substr(md5(id::text || current_period_start::text || current_period_end::text), 1, 18)),
                 CASE WHEN (subtotal_amount + overage_amount - discount_amount) = 0
                   THEN 'paid'::billing_invoice_status ELSE 'open'::billing_invoice_status END,
                 currency, subtotal_amount + overage_amount, 0, discount_amount,
                 subtotal_amount + overage_amount - discount_amount, 0,
                 current_period_start, current_period_end, NOW() + INTERVAL '7 days',
                 overage_events, overage_amount,
                 jsonb_build_object('source','invoice-generation')
          FROM discounted
          ON CONFLICT (invoice_number) DO NOTHING
          RETURNING id, organization_id, subscription_id
        ),
        audits AS (
          INSERT INTO billing_audit_logs (organization_id, subscription_id, invoice_id, actor_type, action, metadata)
          SELECT organization_id, subscription_id, id, 'system', 'invoice.generated',
                 jsonb_build_object('source','invoice-generation')
          FROM inserted
          RETURNING id
        )
        SELECT COUNT(*)::text AS count FROM inserted
        `,
        [batchSize],
      );
      return { processed: firstCount(result), failed: 0, retried: 0 };
    });
  }

  async syncPayments(batchSize: number): Promise<BillingBatchResult> {
    return this.withTransaction(async (client) => {
      const result = await client.query(
        `
        WITH due AS (
          SELECT i.id, i.organization_id, i.subscription_id, i.provider, i.currency, i.total_amount, i.amount_paid
          FROM invoices i
          WHERE i.status = 'open'
            AND i.provider_invoice_id IS NOT NULL
            AND i.deleted_at IS NULL
            AND NOT EXISTS (
              SELECT 1 FROM billing_webhook_events bwe
              WHERE bwe.provider = i.provider
                AND bwe.processing_status = 'processed'
                AND bwe.received_at >= i.created_at
            )
          ORDER BY i.created_at, i.id
          LIMIT $1
          FOR UPDATE SKIP LOCKED
        ),
        marked AS (
          UPDATE invoices i
          SET metadata = i.metadata || jsonb_build_object('payment_sync_requested_at', NOW()),
              updated_at = NOW()
          FROM due d
          WHERE i.id = d.id
          RETURNING i.id, i.organization_id, i.subscription_id
        ),
        audits AS (
          INSERT INTO billing_audit_logs (organization_id, subscription_id, invoice_id, actor_type, action, metadata)
          SELECT organization_id, subscription_id, id, 'system', 'payment.sync_requested',
                 jsonb_build_object('source','payment-sync')
          FROM marked
          RETURNING id
        )
        SELECT COUNT(*)::text AS count FROM marked
        `,
        [batchSize],
      );
      return { processed: firstCount(result), failed: 0, retried: 0 };
    });
  }

  async reconcilePayments(batchSize: number): Promise<BillingBatchResult> {
    return this.withTransaction(async (client) => {
      const paidResult = await client.query(
        `
        WITH totals AS (
          SELECT i.id, i.organization_id, i.subscription_id, COALESCE(SUM(p.amount - p.refunded_amount), 0) AS paid
          FROM invoices i
          JOIN payments p ON p.invoice_id = i.id
          WHERE i.status IN ('open','uncollectible')
            AND p.status = 'succeeded'
            AND i.deleted_at IS NULL
            AND p.deleted_at IS NULL
          GROUP BY i.id, i.organization_id, i.subscription_id, i.total_amount
          HAVING COALESCE(SUM(p.amount - p.refunded_amount), 0) >= i.total_amount
          ORDER BY i.id
          LIMIT $1
          FOR UPDATE OF i SKIP LOCKED
        ),
        fixed AS (
          UPDATE invoices i
          SET status = 'paid',
              amount_paid = t.paid,
              paid_at = COALESCE(i.paid_at, NOW()),
              updated_at = NOW()
          FROM totals t
          WHERE i.id = t.id
          RETURNING i.id, i.organization_id, i.subscription_id
        ),
        sub_fixed AS (
          UPDATE organization_subscriptions os
          SET status = 'active',
              updated_at = NOW()
          FROM fixed f
          WHERE os.id = f.subscription_id
            AND os.status = 'past_due'
          RETURNING os.id
        ),
        audits AS (
          INSERT INTO billing_audit_logs (organization_id, subscription_id, invoice_id, actor_type, action, metadata)
          SELECT organization_id, subscription_id, id, 'system', 'payment.reconciled',
                 jsonb_build_object('source','payment-reconciliation')
          FROM fixed
          RETURNING id
        )
        SELECT COUNT(*)::text AS count FROM fixed
        `,
        [batchSize],
      );
      return { processed: firstCount(paidResult), failed: 0, retried: 0 };
    });
  }

  async retryWebhooks(batchSize: number, maxRetries: number): Promise<BillingBatchResult> {
    return this.withTransaction(async (client) => {
      const result = await client.query(
        `
        WITH due AS (
          SELECT id
          FROM billing_webhook_events
          WHERE processing_status IN ('received','failed')
            AND retry_count < $2
            AND (next_retry_at IS NULL OR next_retry_at <= NOW())
          ORDER BY COALESCE(next_retry_at, received_at), id
          LIMIT $1
          FOR UPDATE SKIP LOCKED
        ),
        marked AS (
          UPDATE billing_webhook_events bwe
          SET processing_status = 'received',
              retry_count = retry_count + 1,
              next_retry_at = NOW() + (POWER(2, LEAST(retry_count + 1, 10))::int * INTERVAL '1 minute'),
              processing_started_at = NULL,
              metadata = metadata || jsonb_build_object('last_retry_scheduled_at', NOW())
          FROM due
          WHERE bwe.id = due.id
          RETURNING bwe.id
        )
        SELECT COUNT(*)::text AS count FROM marked
        `,
        [batchSize, maxRetries],
      );
      return { processed: 0, failed: 0, retried: firstCount(result) };
    });
  }

  async deadLetterWebhooks(batchSize: number, maxRetries: number): Promise<BillingBatchResult> {
    return this.withTransaction(async (client) => {
      const result = await client.query(
        `
        WITH due AS (
          SELECT id, organization_id
          FROM billing_webhook_events
          WHERE processing_status = 'failed'
            AND retry_count >= $2
          ORDER BY received_at, id
          LIMIT $1
          FOR UPDATE SKIP LOCKED
        ),
        moved AS (
          UPDATE billing_webhook_events bwe
          SET processing_status = 'dead_letter',
              next_retry_at = NULL,
              metadata = metadata || jsonb_build_object('dead_lettered_at', NOW(), 'notify_admins', true)
          FROM due
          WHERE bwe.id = due.id
          RETURNING bwe.id, bwe.organization_id
        ),
        audits AS (
          INSERT INTO billing_audit_logs (organization_id, actor_type, action, metadata)
          SELECT organization_id, 'system', 'webhook.dead_lettered',
                 jsonb_build_object('webhook_event_id', id, 'source','webhook-dead-letter')
          FROM moved
          WHERE organization_id IS NOT NULL
          RETURNING id
        )
        SELECT COUNT(*)::text AS count FROM moved
        `,
        [batchSize, maxRetries],
      );
      return { processed: firstCount(result), failed: 0, retried: 0 };
    });
  }

  async rollOverUsage(batchSize: number): Promise<BillingBatchResult> {
    return this.withTransaction(async (client) => {
      const result = await client.query(
        `
        WITH due AS (
          SELECT organization_id, subscription_id, period_start, period_end, events_used, ai_credits_used
          FROM organization_usage_current_period
          WHERE period_end <= NOW()
          ORDER BY period_end, organization_id
          LIMIT $1
          FOR UPDATE SKIP LOCKED
        ),
        archive AS (
          INSERT INTO usage_daily_counters (
            organization_id, project_id, usage_date, events_count, ai_credits_used
          )
          SELECT organization_id, NULL, (period_end - INTERVAL '1 day')::date, events_used, ai_credits_used
          FROM due
          ON CONFLICT (organization_id, project_id, usage_date) DO UPDATE
          SET events_count = usage_daily_counters.events_count + EXCLUDED.events_count,
              ai_credits_used = usage_daily_counters.ai_credits_used + EXCLUDED.ai_credits_used,
              updated_at = NOW()
          RETURNING organization_id
        ),
        reset AS (
          UPDATE organization_usage_current_period u
          SET period_start = os.current_period_start,
              period_end = os.current_period_end,
              events_used = 0,
              ai_credits_used = 0,
              overage_events = 0,
              overage_ai_credits = 0,
              updated_at = NOW()
          FROM due d
          LEFT JOIN organization_subscriptions os ON os.id = d.subscription_id
          WHERE u.organization_id = d.organization_id
          RETURNING u.organization_id
        )
        SELECT COUNT(*)::text AS count FROM reset
        `,
        [batchSize],
      );
      return { processed: firstCount(result), failed: 0, retried: 0 };
    });
  }

  async aggregateUsage(batchSize: number): Promise<BillingBatchResult> {
    return this.withTransaction(async (client) => {
      const result = await client.query(
        `
        WITH due AS (
          SELECT organization_id, subscription_id, period_end, events_used, ai_credits_used
          FROM organization_usage_current_period
          WHERE updated_at >= NOW() - INTERVAL '2 days'
          ORDER BY updated_at, organization_id
          LIMIT $1
          FOR UPDATE SKIP LOCKED
        ),
        upserted AS (
          INSERT INTO usage_daily_counters (organization_id, project_id, usage_date, events_count, ai_credits_used)
          SELECT organization_id, NULL, CURRENT_DATE, events_used, ai_credits_used
          FROM due
          ON CONFLICT (organization_id, project_id, usage_date) DO UPDATE
          SET events_count = EXCLUDED.events_count,
              ai_credits_used = EXCLUDED.ai_credits_used,
              updated_at = NOW()
          RETURNING organization_id
        )
        SELECT COUNT(*)::text AS count FROM upserted
        `,
        [batchSize],
      );
      return { processed: firstCount(result), failed: 0, retried: 0 };
    });
  }

  async resetAiCredits(batchSize: number): Promise<BillingBatchResult> {
    return this.withTransaction(async (client) => {
      const result = await client.query(
        `
        WITH due AS (
          SELECT organization_id, ai_credits_used
          FROM organization_usage_current_period
          WHERE period_end <= NOW()
            AND ai_credits_used > 0
          ORDER BY period_end, organization_id
          LIMIT $1
          FOR UPDATE SKIP LOCKED
        ),
        archived AS (
          INSERT INTO billing_audit_logs (organization_id, actor_type, action, previous_state, metadata)
          SELECT organization_id, 'system', 'ai_credits.reset',
                 jsonb_build_object('ai_credits_used', ai_credits_used),
                 jsonb_build_object('source','ai-credit-reset')
          FROM due
          RETURNING id
        ),
        reset AS (
          UPDATE organization_usage_current_period u
          SET ai_credits_used = 0,
              overage_ai_credits = 0,
              updated_at = NOW()
          FROM due
          WHERE u.organization_id = due.organization_id
          RETURNING u.organization_id
        )
        SELECT COUNT(*)::text AS count FROM reset
        `,
        [batchSize],
      );
      return { processed: firstCount(result), failed: 0, retried: 0 };
    });
  }

  async expireCoupons(batchSize: number): Promise<BillingBatchResult> {
    return this.updateWithAudit(
      `
      WITH due AS (
        SELECT id
        FROM coupons
        WHERE is_active = TRUE
          AND valid_until IS NOT NULL
          AND valid_until <= NOW()
          AND deleted_at IS NULL
        ORDER BY valid_until, id
        LIMIT $1
        FOR UPDATE SKIP LOCKED
      )
      UPDATE coupons c
      SET is_active = FALSE, updated_at = NOW()
      FROM due
      WHERE c.id = due.id
      RETURNING c.id
      `,
      batchSize,
    );
  }

  async expireAddons(batchSize: number): Promise<BillingBatchResult> {
    return this.withTransaction(async (client) => {
      const result = await client.query(
        `
        WITH due AS (
          SELECT id, organization_id, subscription_id
          FROM subscription_addons
          WHERE status = 'active'
            AND expires_at IS NOT NULL
            AND expires_at <= NOW()
          ORDER BY expires_at, id
          LIMIT $1
          FOR UPDATE SKIP LOCKED
        ),
        expired AS (
          UPDATE subscription_addons sa
          SET status = 'expired', updated_at = NOW()
          FROM due
          WHERE sa.id = due.id
          RETURNING sa.id, sa.organization_id, sa.subscription_id
        ),
        audits AS (
          INSERT INTO billing_audit_logs (organization_id, subscription_id, actor_type, action, metadata)
          SELECT organization_id, subscription_id, 'system', 'addon.expired',
                 jsonb_build_object('addon_id', id, 'source','addon-expiration')
          FROM expired
          RETURNING id
        )
        SELECT COUNT(*)::text AS count FROM expired
        `,
        [batchSize],
      );
      return { processed: firstCount(result), failed: 0, retried: 0 };
    });
  }

  async expireFeatureOverrides(batchSize: number): Promise<BillingBatchResult> {
    return this.withTransaction(async (client) => {
      const result = await client.query(
        `
        WITH due AS (
          SELECT id, organization_id
          FROM organization_feature_overrides
          WHERE deleted_at IS NULL
            AND expires_at IS NOT NULL
            AND expires_at <= NOW()
          ORDER BY expires_at, id
          LIMIT $1
          FOR UPDATE SKIP LOCKED
        ),
        expired AS (
          UPDATE organization_feature_overrides ofo
          SET deleted_at = NOW(), updated_at = NOW()
          FROM due
          WHERE ofo.id = due.id
          RETURNING ofo.id, ofo.organization_id
        ),
        audits AS (
          INSERT INTO billing_audit_logs (organization_id, actor_type, action, metadata)
          SELECT organization_id, 'system', 'feature_override.expired',
                 jsonb_build_object('override_id', id, 'source','feature-override-expiration')
          FROM expired
          RETURNING id
        )
        SELECT COUNT(*)::text AS count FROM expired
        `,
        [batchSize],
      );
      return { processed: firstCount(result), failed: 0, retried: 0 };
    });
  }

  async markInvoiceReminders(batchSize: number, days: readonly number[]): Promise<BillingBatchResult> {
    return this.withTransaction(async (client) => {
      const result = await client.query(
        `
        WITH due AS (
          SELECT i.id, i.organization_id, i.subscription_id,
                 GREATEST(0, CEIL(EXTRACT(EPOCH FROM (i.due_at - NOW())) / 86400))::int AS days_until_due
          FROM invoices i
          WHERE i.status = 'open'
            AND i.due_at IS NOT NULL
            AND i.deleted_at IS NULL
            AND GREATEST(0, CEIL(EXTRACT(EPOCH FROM (i.due_at - NOW())) / 86400))::int = ANY($2::int[])
            AND NOT (i.metadata ? ('reminder_' || GREATEST(0, CEIL(EXTRACT(EPOCH FROM (i.due_at - NOW())) / 86400))::int::text))
          ORDER BY i.due_at, i.id
          LIMIT $1
          FOR UPDATE SKIP LOCKED
        ),
        marked AS (
          UPDATE invoices i
          SET metadata = i.metadata || jsonb_build_object('reminder_' || due.days_until_due::text, NOW()),
              updated_at = NOW()
          FROM due
          WHERE i.id = due.id
          RETURNING i.id, i.organization_id, i.subscription_id, due.days_until_due
        ),
        audits AS (
          INSERT INTO billing_audit_logs (organization_id, subscription_id, invoice_id, actor_type, action, metadata)
          SELECT organization_id, subscription_id, id, 'system', 'invoice.reminder_due',
                 jsonb_build_object('days_until_due', days_until_due, 'source','invoice-reminder')
          FROM marked
          RETURNING id
        )
        SELECT COUNT(*)::text AS count FROM marked
        `,
        [batchSize, days],
      );
      return { processed: firstCount(result), failed: 0, retried: 0 };
    });
  }

  async createPartitions(config: BillingJobConfig): Promise<BillingBatchResult> {
    return this.withTransaction(async (client) => {
      let processed = 0;
      const now = new Date();
      for (let offset = 0; offset <= config.partitionMonthsAhead; offset += 1) {
        const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
        const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset + 1, 1));
        const suffix = `${start.getUTCFullYear()}_${String(start.getUTCMonth() + 1).padStart(2, '0')}`;
        const fromDate = dateLiteral(start);
        const toDate = dateLiteral(end);
        await client.query(`CREATE TABLE IF NOT EXISTS ${quoteIdent(`usage_daily_counters_${suffix}`)} PARTITION OF usage_daily_counters FOR VALUES FROM ('${fromDate}') TO ('${toDate}')`);
        await client.query(`CREATE INDEX IF NOT EXISTS ${quoteIdent(`idx_udc_${suffix}_org_date`)} ON ${quoteIdent(`usage_daily_counters_${suffix}`)}(organization_id, usage_date DESC)`);
        await client.query(`CREATE TABLE IF NOT EXISTS ${quoteIdent(`ai_usage_logs_${suffix}`)} PARTITION OF ai_usage_logs FOR VALUES FROM ('${fromDate}') TO ('${toDate}')`);
        await client.query(`CREATE INDEX IF NOT EXISTS ${quoteIdent(`idx_ai_usage_${suffix}_org_time`)} ON ${quoteIdent(`ai_usage_logs_${suffix}`)}(organization_id, occurred_at DESC)`);
        await client.query(`CREATE TABLE IF NOT EXISTS ${quoteIdent(`billing_audit_logs_${suffix}`)} PARTITION OF billing_audit_logs FOR VALUES FROM ('${fromDate}') TO ('${toDate}')`);
        await client.query(`CREATE INDEX IF NOT EXISTS ${quoteIdent(`idx_bal_${suffix}_org_time`)} ON ${quoteIdent(`billing_audit_logs_${suffix}`)}(organization_id, occurred_at DESC)`);
        processed += 3;
      }
      return { processed, failed: 0, retried: 0 };
    });
  }

  async cleanupPartitions(retentionDays: number): Promise<BillingBatchResult> {
    const result = await this.db.query(
      `
      SELECT schemaname, tablename
      FROM pg_tables
      WHERE schemaname = 'public'
        AND (
          tablename LIKE 'usage_daily_counters\\_%' ESCAPE '\\'
          OR tablename LIKE 'ai_usage_logs\\_%' ESCAPE '\\'
          OR tablename LIKE 'billing_audit_logs\\_%' ESCAPE '\\'
        )
        AND to_date(right(tablename, 7), 'YYYY_MM') < date_trunc('month', NOW() - ($1::int * INTERVAL '1 day'))::date
      ORDER BY tablename
      LIMIT 50
      `,
      [retentionDays],
    );

    let processed = 0;
    for (const row of result.rows as Array<{ schemaname: string; tablename: string }>) {
      await this.db.query(`DROP TABLE IF EXISTS ${quoteIdent(row.schemaname)}.${quoteIdent(row.tablename)}`);
      processed += 1;
    }
    return { processed, failed: 0, retried: 0 };
  }

  async detectUsageAnomalies(batchSize: number, multiplier: number, minimumEvents: number): Promise<BillingBatchResult> {
    return this.withTransaction(async (client) => {
      const result = await client.query(
        `
        WITH recent AS (
          SELECT organization_id, SUM(events_count) AS today_events
          FROM usage_daily_counters
          WHERE usage_date = CURRENT_DATE
          GROUP BY organization_id
        ),
        baseline AS (
          SELECT organization_id, GREATEST(AVG(events_count), 1) AS avg_events
          FROM usage_daily_counters
          WHERE usage_date >= CURRENT_DATE - INTERVAL '14 days'
            AND usage_date < CURRENT_DATE
          GROUP BY organization_id
        ),
        anomalies AS (
          SELECT r.organization_id, r.today_events, b.avg_events
          FROM recent r
          JOIN baseline b ON b.organization_id = r.organization_id
          WHERE r.today_events >= $3
            AND r.today_events >= b.avg_events * $2
          ORDER BY r.today_events DESC, r.organization_id
          LIMIT $1
        ),
        inserted AS (
          INSERT INTO billing_audit_logs (organization_id, actor_type, action, new_state, metadata)
          SELECT organization_id, 'system', 'usage.anomaly_detected',
                 jsonb_build_object('today_events', today_events, 'baseline_events', avg_events),
                 jsonb_build_object('source','usage-anomaly')
          FROM anomalies a
          WHERE NOT EXISTS (
            SELECT 1 FROM billing_audit_logs bal
            WHERE bal.organization_id = a.organization_id
              AND bal.action = 'usage.anomaly_detected'
              AND bal.occurred_at >= NOW() - INTERVAL '1 day'
          )
          RETURNING id
        )
        SELECT COUNT(*)::text AS count FROM inserted
        `,
        [batchSize, multiplier, minimumEvents],
      );
      return { processed: firstCount(result), failed: 0, retried: 0 };
    });
  }

  async refreshEntitlements(batchSize: number): Promise<BillingBatchResult> {
    return this.withTransaction(async (client) => {
      const result = await client.query(
        `
        WITH due AS (
          SELECT u.organization_id
          FROM organization_usage_current_period u
          JOIN organization_subscriptions os ON os.organization_id = u.organization_id
          WHERE os.status IN ('trialing','active','past_due')
            AND os.deleted_at IS NULL
          ORDER BY u.updated_at, u.organization_id
          LIMIT $1
          FOR UPDATE OF u SKIP LOCKED
        ),
        ent AS (
          SELECT organization_id,
                 MAX(integer_value) FILTER (WHERE feature_key = 'monthly_events') AS event_limit,
                 MAX(integer_value) FILTER (WHERE feature_key = 'ai_credits') AS ai_credit_limit
          FROM v_effective_entitlements
          WHERE organization_id IN (SELECT organization_id FROM due)
          GROUP BY organization_id
        ),
        refreshed AS (
          UPDATE organization_usage_current_period u
          SET event_limit = COALESCE(ent.event_limit, u.event_limit),
              ai_credit_limit = COALESCE(ent.ai_credit_limit, u.ai_credit_limit),
              updated_at = NOW()
          FROM ent
          WHERE u.organization_id = ent.organization_id
            AND (u.event_limit IS DISTINCT FROM COALESCE(ent.event_limit, u.event_limit)
              OR u.ai_credit_limit IS DISTINCT FROM COALESCE(ent.ai_credit_limit, u.ai_credit_limit))
          RETURNING u.organization_id
        )
        SELECT COUNT(*)::text AS count FROM refreshed
        `,
        [batchSize],
      );
      return { processed: firstCount(result), failed: 0, retried: 0 };
    });
  }

  async archiveAuditLogs(retentionDays: number): Promise<BillingBatchResult> {
    return this.cleanupPartitions(retentionDays);
  }

  async reconcileData(batchSize: number): Promise<BillingBatchResult> {
    return this.withTransaction(async (client) => {
      const result = await client.query(
        `
        WITH aggregates AS (
          SELECT organization_id,
                 SUM(events_count) FILTER (WHERE usage_date >= date_trunc('month', CURRENT_DATE)::date) AS events_used,
                 SUM(ai_credits_used) FILTER (WHERE usage_date >= date_trunc('month', CURRENT_DATE)::date) AS ai_used
          FROM usage_daily_counters
          GROUP BY organization_id
          ORDER BY organization_id
          LIMIT $1
        ),
        fixed AS (
          UPDATE organization_usage_current_period u
          SET events_used = GREATEST(u.events_used, COALESCE(a.events_used, 0)),
              ai_credits_used = GREATEST(u.ai_credits_used, COALESCE(a.ai_used, 0)),
              updated_at = NOW(),
              metadata = u.metadata || jsonb_build_object('last_reconciled_at', NOW())
          FROM aggregates a
          WHERE u.organization_id = a.organization_id
            AND (u.events_used < COALESCE(a.events_used, 0) OR u.ai_credits_used < COALESCE(a.ai_used, 0))
          RETURNING u.organization_id
        ),
        audits AS (
          INSERT INTO billing_audit_logs (organization_id, actor_type, action, metadata)
          SELECT organization_id, 'system', 'data.reconciled', jsonb_build_object('source','data-reconciliation')
          FROM fixed
          RETURNING id
        )
        SELECT COUNT(*)::text AS count FROM fixed
        `,
        [batchSize],
      );
      return { processed: firstCount(result), failed: 0, retried: 0 };
    });
  }

  async publishMetrics(): Promise<BillingBatchResult> {
    const result = await this.db.query(
      `
      SELECT
        (SELECT COUNT(*) FROM invoices WHERE created_at >= NOW() - INTERVAL '1 day') AS invoice_count,
        (SELECT COUNT(*) FROM payments WHERE created_at >= NOW() - INTERVAL '1 day') AS payment_count,
        (SELECT COUNT(*) FROM billing_webhook_events WHERE processing_status = 'failed') AS webhook_failures,
        (SELECT COALESCE(SUM(events_used), 0) FROM organization_usage_current_period) AS usage_count,
        (SELECT COALESCE(SUM(ai_credits_used), 0) FROM organization_usage_current_period) AS ai_credit_consumption
      `,
    );
    return { processed: result.rows.length, failed: 0, retried: 0 };
  }

  private async updateWithAudit(sql: string, batchSize: number): Promise<BillingBatchResult> {
    return this.withTransaction(async (client) => {
      const result = await client.query(sql, [batchSize]);
      return { processed: rowCount(result), failed: 0, retried: 0 };
    });
  }
}
