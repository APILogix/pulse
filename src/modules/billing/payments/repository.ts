import { pool } from '../../../config/database.js';
import type { Pool, PoolClient } from 'pg';
import { PaymentStatus, BillingProvider } from '../shared/types.js';

type Db = Pool | PoolClient;

export interface PaymentRow {
  id: string;
  organization_id: string;
  invoice_id: string | null;
  subscription_id: string | null;
  provider: BillingProvider;
  provider_payment_id: string | null;
  status: PaymentStatus;
  currency: string;
  amount: number;
  fee_amount: number;
  tax_amount: number;
  refunded_amount: number;
  payment_method: string | null;
  payment_method_last4: string | null;
  initiated_at: Date;
  authorized_at: Date | null;
  captured_at: Date | null;
  failed_at: Date | null;
  refunded_at: Date | null;
  failure_code: string | null;
  failure_reason: string | null;
  created_at: Date;
  updated_at: Date;
}

export class PaymentsRepository {
  constructor(private readonly db: Pool = pool) {}

  async listPayments(
    orgId: string, 
    options: { status?: PaymentStatus; limit: number; offset: number },
    db: Db = this.db
  ): Promise<{ data: PaymentRow[], total: number }> {
    const values: any[] = [orgId];
    let whereClause = `organization_id = $1 AND deleted_at IS NULL`;
    
    if (options.status) {
      whereClause += ` AND status = $2`;
      values.push(options.status);
    }

    const countResult = await db.query(
      `SELECT COUNT(*)::int as total FROM payments WHERE ${whereClause}`,
      values
    );
    const total = countResult.rows[0]?.total ?? 0;

    const dataValues = [...values, options.limit, options.offset];
    const limitOffsetParams = options.status ? `LIMIT $3 OFFSET $4` : `LIMIT $2 OFFSET $3`;

    const result = await db.query(
      `SELECT * FROM payments WHERE ${whereClause} ORDER BY created_at DESC ${limitOffsetParams}`,
      dataValues
    );

    return { data: result.rows, total };
  }
}
