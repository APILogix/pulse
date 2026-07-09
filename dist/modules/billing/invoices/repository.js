import { pool } from '../../../config/database.js';
import { InvoiceStatus } from '../shared/types.js';
export class InvoicesRepository {
    db;
    constructor(db = pool) {
        this.db = db;
    }
    async listInvoices(orgId, options, db = this.db) {
        const values = [orgId];
        let whereClause = `organization_id = $1 AND deleted_at IS NULL`;
        if (options.status) {
            whereClause += ` AND status = $2`;
            values.push(options.status);
        }
        const countResult = await db.query(`SELECT COUNT(*)::int as total FROM invoices WHERE ${whereClause}`, values);
        const total = countResult.rows[0]?.total ?? 0;
        const dataValues = [...values, options.limit, options.offset];
        const limitOffsetParams = options.status ? `LIMIT $3 OFFSET $4` : `LIMIT $2 OFFSET $3`;
        const result = await db.query(`SELECT * FROM invoices WHERE ${whereClause} ORDER BY created_at DESC ${limitOffsetParams}`, dataValues);
        return { data: result.rows, total };
    }
    async getInvoiceById(orgId, invoiceId, db = this.db) {
        const result = await db.query(`SELECT * FROM invoices WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`, [invoiceId, orgId]);
        return result.rows[0] || null;
    }
}
//# sourceMappingURL=repository.js.map