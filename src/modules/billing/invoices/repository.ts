import { pool } from '../../../config/database.js';
import type { Pool, PoolClient } from 'pg';
import { BillingProvider, InvoiceStatus, PaymentStatus } from '../shared/types.js';

type Db = Pool | PoolClient;

export interface InvoiceRow {
  id: string;
  organization_id: string;
  subscription_id: string | null;
  provider: string;
  provider_invoice_id: string | null;
  invoice_number: string;
  status: InvoiceStatus;
  currency: string;
  subtotal_amount: number;
  tax_amount: number;
  discount_amount: number;
  total_amount: number;
  amount_paid: number;
  period_start: Date;
  period_end: Date;
  due_at: Date | null;
  paid_at: Date | null;
  pdf_url: string | null;
  created_at: Date;
}

export interface PaymentMethodRow {
  id: string;
  provider: BillingProvider;
  type: string;
  last4: string | null;
  brand: string | null;
  is_default: boolean;
}

export interface InvoicePaymentResult {
  invoice: InvoiceRow;
  payment: {
    id: string;
    status: PaymentStatus;
    amount: number;
    currency: string;
    payment_method: string | null;
    payment_method_last4: string | null;
  };
}

export class InvoicesRepository {
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

  async listInvoices(
    orgId: string, 
    options: { status?: InvoiceStatus; limit: number; offset: number },
    db: Db = this.db
  ): Promise<{ data: InvoiceRow[], total: number }> {
    const values: any[] = [orgId];
    let whereClause = `organization_id = $1 AND deleted_at IS NULL`;
    
    if (options.status) {
      whereClause += ` AND status = $2`;
      values.push(options.status);
    }

    const countResult = await db.query(
      `SELECT COUNT(*)::int as total FROM invoices WHERE ${whereClause}`,
      values
    );
    const total = countResult.rows[0]?.total ?? 0;

    const dataValues = [...values, options.limit, options.offset];
    const limitOffsetParams = options.status ? `LIMIT $3 OFFSET $4` : `LIMIT $2 OFFSET $3`;

    const result = await db.query(
      `SELECT * FROM invoices WHERE ${whereClause} ORDER BY created_at DESC ${limitOffsetParams}`,
      dataValues
    );

    return { data: result.rows, total };
  }

  async getInvoiceById(orgId: string, invoiceId: string, db: Db = this.db): Promise<InvoiceRow | null> {
    const result = await db.query(
      `SELECT * FROM invoices WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
      [invoiceId, orgId]
    );
    return result.rows[0] || null;
  }

  async getUpcomingInvoicePreview(orgId: string, db: Db = this.db): Promise<Record<string, unknown> | null> {
    const result = await db.query(
      `WITH active_subscription AS (
         SELECT os.*
         FROM organization_subscriptions os
         WHERE os.organization_id = $1
           AND os.status IN ('trialing','active','past_due')
           AND os.deleted_at IS NULL
           AND os.current_period_end > NOW()
         ORDER BY
           CASE os.status WHEN 'active' THEN 0 WHEN 'trialing' THEN 1 WHEN 'past_due' THEN 2 ELSE 3 END,
           os.created_at DESC
         LIMIT 1
       ),
       price AS (
         SELECT pp.*
         FROM plan_prices pp
         JOIN active_subscription os ON os.plan_id = pp.plan_id
         WHERE pp.billing_interval = os.billing_interval
           AND pp.deleted_at IS NULL
           AND (pp.starts_at IS NULL OR pp.starts_at <= NOW())
           AND (pp.ends_at IS NULL OR pp.ends_at > NOW())
         ORDER BY pp.is_default DESC, pp.starts_at DESC NULLS LAST, pp.created_at DESC
         LIMIT 1
       ),
       usage AS (
         SELECT *
         FROM organization_usage_current_period
         WHERE organization_id = $1
         ORDER BY period_end DESC
         LIMIT 1
       )
       SELECT jsonb_build_object(
         'organization_id', os.organization_id,
         'subscription_id', os.id,
         'plan_id', os.plan_id,
         'status', 'draft',
         'currency', COALESCE(price.currency, 'USD'),
         'subtotal_amount', COALESCE(price.amount_minor, 0),
         'tax_amount', 0,
         'discount_amount', 0,
         'total_amount', COALESCE(price.amount_minor, 0),
         'period_start', os.current_period_end,
         'period_end', CASE
           WHEN os.billing_interval = 'annual' THEN os.current_period_end + INTERVAL '1 year'
           ELSE os.current_period_end + INTERVAL '1 month'
         END,
         'usage', CASE WHEN usage.organization_id IS NULL THEN NULL ELSE jsonb_build_object(
           'events_used', usage.events_used,
           'event_limit', usage.event_limit,
           'remaining_events', GREATEST(usage.event_limit - usage.events_used, 0),
           'ai_credits_used', usage.ai_credits_used,
           'ai_credit_limit', usage.ai_credit_limit,
           'remaining_ai_credits', GREATEST(usage.ai_credit_limit - usage.ai_credits_used, 0),
           'overage_events', usage.overage_events,
           'overage_ai_credits', usage.overage_ai_credits
         ) END
       ) AS preview
       FROM active_subscription os
       LEFT JOIN price ON TRUE
       LEFT JOIN usage ON TRUE`,
      [orgId]
    );
    return result.rows[0]?.preview ?? null;
  }

  async getInvoiceByIdForUpdate(orgId: string, invoiceId: string, db: PoolClient): Promise<InvoiceRow | null> {
    const result = await db.query(
      `SELECT * FROM invoices
       WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL
       FOR UPDATE`,
      [invoiceId, orgId]
    );
    return result.rows[0] || null;
  }

  async getPaymentMethod(
    orgId: string,
    paymentMethodId: string | undefined,
    db: Db = this.db
  ): Promise<PaymentMethodRow | null> {
    const values = paymentMethodId ? [orgId, paymentMethodId] : [orgId];
    const idClause = paymentMethodId ? 'AND id = $2' : '';
    const result = await db.query(
      `SELECT id, provider, type, last4, brand, is_default
       FROM payment_methods
       WHERE organization_id = $1
         AND is_active = TRUE
         ${idClause}
       ORDER BY is_default DESC, created_at DESC
       LIMIT 1`,
      values
    );
    return result.rows[0] || null;
  }

  async collectInvoicePayment(
    invoice: InvoiceRow,
    paymentMethod: PaymentMethodRow,
    amountDue: number,
    db: PoolClient
  ): Promise<InvoicePaymentResult> {
    const providerPaymentId = `local_${invoice.id}_${paymentMethod.id}`;
    const metadata = JSON.stringify({
      source: 'invoice-pay-api',
      paymentMethodId: paymentMethod.id,
    });

    const paymentResult = await db.query(
      `INSERT INTO payments (
         organization_id, invoice_id, subscription_id, provider, provider_payment_id,
         status, currency, amount, payment_method, payment_method_last4,
         authorized_at, captured_at, metadata
       )
       VALUES ($1,$2,$3,$4,$5,'succeeded',$6,$7,$8,$9,NOW(),NOW(),$10)
       ON CONFLICT (provider, provider_payment_id) DO UPDATE
       SET status = EXCLUDED.status,
           amount = EXCLUDED.amount,
           captured_at = COALESCE(payments.captured_at, EXCLUDED.captured_at),
           metadata = payments.metadata || EXCLUDED.metadata,
           updated_at = NOW()
       RETURNING id, status, amount, currency, payment_method, payment_method_last4`,
      [
        invoice.organization_id,
        invoice.id,
        invoice.subscription_id,
        BillingProvider.MANUAL,
        providerPaymentId,
        invoice.currency,
        amountDue,
        paymentMethod.type,
        paymentMethod.last4,
        metadata,
      ]
    );

    const invoiceResult = await db.query(
      `UPDATE invoices
       SET amount_paid = LEAST(total_amount, amount_paid + $3),
           status = CASE WHEN amount_paid + $3 >= total_amount THEN 'paid' ELSE status END,
           paid_at = CASE WHEN amount_paid + $3 >= total_amount THEN COALESCE(paid_at, NOW()) ELSE paid_at END,
           metadata = metadata || jsonb_build_object('last_payment_id', $4::uuid),
           updated_at = NOW()
       WHERE id = $1 AND organization_id = $2
       RETURNING *`,
      [invoice.id, invoice.organization_id, amountDue, paymentResult.rows[0].id]
    );

    if (invoice.subscription_id && invoiceResult.rows[0]?.status === InvoiceStatus.PAID) {
      await db.query(
        `UPDATE organization_subscriptions
         SET status = CASE WHEN status = 'past_due' THEN 'active' ELSE status END,
             updated_at = NOW()
         WHERE id = $1
           AND organization_id = $2
           AND deleted_at IS NULL`,
        [invoice.subscription_id, invoice.organization_id]
      );

      await db.query(
        `INSERT INTO subscription_events (organization_id, subscription_id, event_type, actor, metadata)
         VALUES ($1,$2,'payment_succeeded','user',$3)`,
        [
          invoice.organization_id,
          invoice.subscription_id,
          JSON.stringify({ source: 'invoice-pay-api', invoiceId: invoice.id, paymentId: paymentResult.rows[0].id }),
        ]
      );
    }

    await db.query(
      `INSERT INTO billing_audit_logs (
         organization_id, subscription_id, invoice_id, payment_id, actor_type, action, metadata
       )
       VALUES ($1,$2,$3,$4,'user','invoice.paid',$5)`,
      [
        invoice.organization_id,
        invoice.subscription_id,
        invoice.id,
        paymentResult.rows[0].id,
        JSON.stringify({ source: 'invoice-pay-api', amount: amountDue, currency: invoice.currency }),
      ]
    );

    return {
      invoice: invoiceResult.rows[0],
      payment: paymentResult.rows[0],
    };
  }
}
