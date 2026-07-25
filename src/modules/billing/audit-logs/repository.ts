import { pool } from '../../../config/database.js';
import type { Pool, PoolClient } from 'pg';

type Db = Pool | PoolClient;

export interface BillingAuditLogFilters {
  action?: string;
  subscriptionId?: string;
  invoiceId?: string;
  paymentId?: string;
  startDate?: Date;
  endDate?: Date;
  limit: number;
  offset: number;
}

export class BillingAuditLogsRepository {
  constructor(private readonly db: Pool = pool) {}

  async listAuditLogs(orgId: string, filters: BillingAuditLogFilters, db: Db = this.db) {
    const values: any[] = [orgId];
    let i = 2;
    const where = ['organization_id = $1'];

    if (filters.action) {
      where.push(`action = $${i++}`);
      values.push(filters.action);
    }
    if (filters.subscriptionId) {
      where.push(`subscription_id = $${i++}`);
      values.push(filters.subscriptionId);
    }
    if (filters.invoiceId) {
      where.push(`invoice_id = $${i++}`);
      values.push(filters.invoiceId);
    }
    if (filters.paymentId) {
      where.push(`payment_id = $${i++}`);
      values.push(filters.paymentId);
    }
    if (filters.startDate) {
      where.push(`occurred_at >= $${i++}`);
      values.push(filters.startDate);
    }
    if (filters.endDate) {
      where.push(`occurred_at <= $${i++}`);
      values.push(filters.endDate);
    }

    const whereClause = where.join(' AND ');
    const countResult = await db.query(
      `SELECT COUNT(*)::int AS total FROM billing_audit_logs WHERE ${whereClause}`,
      values
    );

    const limitParam = i++;
    const offsetParam = i++;
    const result = await db.query(
      `SELECT
         id, organization_id, subscription_id, invoice_id, payment_id, coupon_id,
         actor_type, actor_user_id, action, request_id, correlation_id, trace_id,
         ip_address, user_agent, previous_state, new_state, metadata, occurred_at
       FROM billing_audit_logs
       WHERE ${whereClause}
       ORDER BY occurred_at DESC
       LIMIT $${limitParam} OFFSET $${offsetParam}`,
      [...values, filters.limit, filters.offset]
    );

    return { data: result.rows, total: countResult.rows[0]?.total ?? 0 };
  }
}
