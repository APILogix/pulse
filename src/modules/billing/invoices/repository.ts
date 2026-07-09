import { pool } from '../../../config/database.js';
import type { Pool, PoolClient } from 'pg';
import { InvoiceStatus } from '../shared/types.js';

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

export class InvoicesRepository {
  constructor(private readonly db: Pool = pool) {}

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
}
