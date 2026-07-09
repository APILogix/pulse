import { pool } from '../../../config/database.js';
import { PaymentStatus, BillingProvider } from '../shared/types.js';
export class PaymentsRepository {
    db;
    constructor(db = pool) {
        this.db = db;
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
}
//# sourceMappingURL=repository.js.map