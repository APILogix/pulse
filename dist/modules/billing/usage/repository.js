import { pool } from '../../../config/database.js';
export class UsageRepository {
    db;
    constructor(db = pool) {
        this.db = db;
    }
    async getCurrentUsage(orgId, db = this.db) {
        const result = await db.query(`SELECT * FROM v_current_usage WHERE organization_id = $1`, [orgId]);
        return result.rows[0] || null;
    }
    async incrementEventUsage(orgId, count = 1, db = this.db) {
        await db.query(`SELECT increment_event_usage($1, $2)`, [orgId, count]);
    }
    async getDailyUsageRecords(orgId, startDate, endDate, db = this.db) {
        const values = [orgId];
        let i = 2;
        const where = ['organization_id = $1'];
        if (startDate) {
            where.push(`usage_date >= $${i++}`);
            values.push(startDate);
        }
        if (endDate) {
            where.push(`usage_date <= $${i++}`);
            values.push(endDate);
        }
        const result = await db.query(`SELECT * FROM usage_daily_counters WHERE ${where.join(' AND ')} ORDER BY usage_date DESC`, values);
        return result.rows;
    }
}
//# sourceMappingURL=repository.js.map