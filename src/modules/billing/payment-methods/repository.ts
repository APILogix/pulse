import { pool } from '../../../config/database.js';
import type { Pool, PoolClient } from 'pg';
import { BillingProvider } from '../shared/types.js';
import type { CreatePaymentMethodBody } from './schemas.js';

type Db = Pool | PoolClient;

export interface PaymentMethodRow {
  id: string;
  organization_id: string;
  provider: BillingProvider;
  provider_payment_method_id: string;
  type: string;
  last4: string | null;
  brand: string | null;
  expiry_month: number | null;
  expiry_year: number | null;
  is_default: boolean;
  is_active: boolean;
  billing_details: Record<string, unknown>;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

export class PaymentMethodsRepository {
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

  async listPaymentMethods(
    orgId: string,
    options: { includeInactive: boolean; limit: number; offset: number },
    db: Db = this.db,
  ): Promise<{ data: PaymentMethodRow[]; total: number }> {
    const where = options.includeInactive
      ? 'organization_id = $1'
      : 'organization_id = $1 AND is_active = TRUE';
    const countResult = await db.query(`SELECT COUNT(*)::int AS total FROM payment_methods WHERE ${where}`, [orgId]);
    const result = await db.query(
      `SELECT *
         FROM payment_methods
        WHERE ${where}
        ORDER BY is_default DESC, created_at DESC
        LIMIT $2 OFFSET $3`,
      [orgId, options.limit, options.offset],
    );
    return { data: result.rows, total: countResult.rows[0]?.total ?? 0 };
  }

  async createPaymentMethod(orgId: string, body: CreatePaymentMethodBody, db: PoolClient): Promise<PaymentMethodRow> {
    if (body.isDefault) {
      await db.query(
        `UPDATE payment_methods
            SET is_default = FALSE, updated_at = NOW()
          WHERE organization_id = $1 AND is_default = TRUE`,
        [orgId],
      );
    }

    const result = await db.query(
      `INSERT INTO payment_methods (
         organization_id, provider, provider_payment_method_id, type, last4, brand,
         expiry_month, expiry_year, is_default, billing_details, metadata
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING *`,
      [
        orgId,
        body.provider,
        body.providerPaymentMethodId,
        body.type,
        body.last4 ?? null,
        body.brand ?? null,
        body.expiryMonth ?? null,
        body.expiryYear ?? null,
        body.isDefault,
        JSON.stringify(body.billingDetails),
        JSON.stringify(body.metadata),
      ],
    );
    return result.rows[0];
  }

  async setDefault(orgId: string, paymentMethodId: string, db: PoolClient): Promise<PaymentMethodRow | null> {
    const existing = await db.query(
      `SELECT * FROM payment_methods
        WHERE id = $1 AND organization_id = $2 AND is_active = TRUE
        FOR UPDATE`,
      [paymentMethodId, orgId],
    );
    if (!existing.rows[0]) return null;

    await db.query(
      `UPDATE payment_methods
          SET is_default = FALSE, updated_at = NOW()
        WHERE organization_id = $1 AND is_default = TRUE`,
      [orgId],
    );

    const result = await db.query(
      `UPDATE payment_methods
          SET is_default = TRUE, updated_at = NOW()
        WHERE id = $1 AND organization_id = $2
        RETURNING *`,
      [paymentMethodId, orgId],
    );
    return result.rows[0] ?? null;
  }

  async deactivate(orgId: string, paymentMethodId: string, db: Db = this.db): Promise<PaymentMethodRow | null> {
    const result = await db.query(
      `UPDATE payment_methods
          SET is_active = FALSE, is_default = FALSE, updated_at = NOW()
        WHERE id = $1 AND organization_id = $2 AND is_active = TRUE
        RETURNING *`,
      [paymentMethodId, orgId],
    );
    return result.rows[0] ?? null;
  }
}
