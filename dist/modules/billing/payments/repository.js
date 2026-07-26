import { pool } from '../../../config/database.js';
import { PaymentStatus, BillingProvider } from '../shared/types.js';
export class PaymentsRepository {
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
    async listPayments(orgId, options, db = this.db) {
        const values = [orgId];
        let whereClause = `organization_id = $1 AND deleted_at IS NULL`;
        if (options.status) {
            whereClause += ` AND status = $2`;
            values.push(options.status);
        }
        const countResult = await db.query(`SELECT COUNT(*)::int as total FROM payments WHERE ${whereClause}`, values);
        const total = countResult.rows[0]?.total ?? 0;
        const dataValues = [...values, options.limit, options.offset];
        const limitOffsetParams = options.status ? `LIMIT $3 OFFSET $4` : `LIMIT $2 OFFSET $3`;
        const result = await db.query(`SELECT * FROM payments WHERE ${whereClause} ORDER BY created_at DESC ${limitOffsetParams}`, dataValues);
        return { data: result.rows, total };
    }
    async getPaymentForUpdate(orgId, paymentId, db) {
        const result = await db.query(`SELECT * FROM payments
       WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL
       FOR UPDATE`, [paymentId, orgId]);
        return result.rows[0] || null;
    }
    async refundPayment(payment, amount, reason, db) {
        const newRefundedAmount = Number(payment.refunded_amount) + amount;
        const fullyRefunded = newRefundedAmount >= Number(payment.amount);
        const result = await db.query(`UPDATE payments
       SET refunded_amount = refunded_amount + $3,
           status = CASE WHEN refunded_amount + $3 >= amount THEN 'refunded' ELSE status END,
           refunded_at = CASE WHEN refunded_amount + $3 >= amount THEN COALESCE(refunded_at, NOW()) ELSE refunded_at END,
           metadata = metadata || jsonb_build_object('last_refund_reason', $4::text),
           updated_at = NOW()
       WHERE id = $1 AND organization_id = $2
       RETURNING *`, [payment.id, payment.organization_id, amount, reason ?? null]);
        if (payment.invoice_id && fullyRefunded) {
            await db.query(`UPDATE invoices
         SET status = 'refunded',
             updated_at = NOW()
         WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`, [payment.invoice_id, payment.organization_id]);
        }
        await db.query(`INSERT INTO billing_audit_logs (
         organization_id, subscription_id, invoice_id, payment_id, actor_type, action, metadata
       )
       VALUES ($1,$2,$3,$4,'user','payment.refunded',$5::jsonb)`, [
            payment.organization_id,
            payment.subscription_id,
            payment.invoice_id,
            payment.id,
            JSON.stringify({ source: 'payments-api', amount, currency: payment.currency, reason: reason ?? null }),
        ]);
        return result.rows[0];
    }
}
//# sourceMappingURL=repository.js.map