import { BaseRepository, cursorPage } from "../shared/base.repository.js";
export class SecurityEventsRepository extends BaseRepository {
    async listSecurityEvents(orgId, q, filters) {
        const params = [orgId];
        let where = `org_id=$1`;
        if (filters?.severity) {
            params.push(filters.severity);
            where += ` AND severity=$${params.length}`;
        }
        if (filters?.eventType) {
            params.push(filters.eventType);
            where += ` AND event_type=$${params.length}`;
        }
        if (q.cursor) {
            params.push(q.cursor);
            where += ` AND created_at < $${params.length}`;
        }
        params.push(q.limit + 1);
        const r = await this.db.query(`SELECT id,org_id,user_id,event_type,severity,ip_address::text AS ip_address,metadata,created_at
       FROM organization_security_events WHERE ${where} ORDER BY created_at DESC LIMIT $${params.length}`, params);
        return cursorPage(r.rows, q.limit);
    }
}
//# sourceMappingURL=security-events.repository.js.map