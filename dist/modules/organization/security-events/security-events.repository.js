import { BaseRepository, cursorPage } from "../shared/base.repository.js";
export class SecurityEventsRepository extends BaseRepository {
    async listSecurityEvents(orgId, q, filters) {
        const countParams = [orgId];
        let countWhere = `org_id=$1`;
        if (filters?.severity) {
            countParams.push(filters.severity);
            countWhere += ` AND severity=$${countParams.length}`;
        }
        if (filters?.eventType) {
            countParams.push(filters.eventType);
            countWhere += ` AND event_type=$${countParams.length}`;
        }
        const countRes = await this.db.query(`SELECT COUNT(*)::text as count FROM organization_security_events WHERE ${countWhere}`, countParams);
        const totalCount = Number(countRes.rows[0]?.count ?? 0);
        const params = [...countParams];
        let where = countWhere;
        if (q.cursor) {
            params.push(q.cursor);
            where += ` AND created_at < $${params.length}`;
        }
        params.push(q.limit + 1);
        const r = await this.db.query(`SELECT id,org_id,user_id,event_type,severity,ip_address::text AS ip_address,metadata,created_at
       FROM organization_security_events WHERE ${where} ORDER BY created_at DESC LIMIT $${params.length}`, params);
        return cursorPage(r.rows, q.limit, totalCount);
    }
}
//# sourceMappingURL=security-events.repository.js.map