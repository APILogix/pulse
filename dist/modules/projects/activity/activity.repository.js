import { pool } from "../../../config/database.js";
export class ActivityRepository {
    db;
    constructor(db = pool) {
        this.db = db;
    }
    async listProjectActivity(orgId, projectId, query, client) {
        const db = client ?? this.db;
        const params = [orgId, projectId];
        const whereClauses = [
            "a.org_id = $1",
            `(
        (a.entity_type = 'project' AND a.entity_id = $2::uuid)
        OR a.metadata ->> 'projectId' = $2
        OR a.new_values ->> 'projectId' = $2
        OR a.old_values ->> 'projectId' = $2
        OR (a.entity_type = 'api_key' AND EXISTS (
          SELECT 1 FROM project_api_keys k WHERE k.id = a.entity_id AND k.project_id = $2::uuid
        ))
        OR (a.entity_type = 'project_environment' AND EXISTS (
          SELECT 1 FROM project_environments e WHERE e.id = a.entity_id AND e.project_id = $2::uuid
        ))
      )`,
        ];
        if (query.action) {
            params.push(query.action);
            whereClauses.push(`a.action = $${params.length}`);
        }
        if (query.cursor) {
            params.push(query.cursor);
            whereClauses.push(`a.created_at < $${params.length}`);
        }
        params.push(query.limit + 1);
        const result = await db.query(`SELECT
         a.id,
         a.actor_user_id,
         a.actor_email,
         a.action,
         a.entity_type,
         a.entity_id,
         a.entity_name,
         a.changed_fields,
         a.status,
         a.is_sensitive,
         a.metadata,
         a.created_at
       FROM organization_audit_logs a
       WHERE ${whereClauses.join(" AND ")}
       ORDER BY a.created_at DESC, a.id DESC
       LIMIT $${params.length}`, params);
        const hasMore = result.rows.length > query.limit;
        const rows = hasMore ? result.rows.slice(0, query.limit) : result.rows;
        return {
            data: rows.map((row) => ({
                id: row.id,
                actorUserId: row.actor_user_id,
                actorEmail: row.actor_email,
                action: row.action,
                entityType: row.entity_type,
                entityId: row.entity_id,
                entityName: row.entity_name,
                changedFields: row.changed_fields,
                status: row.status,
                isSensitive: row.is_sensitive,
                metadata: row.metadata ?? {},
                createdAt: row.created_at,
            })),
            meta: {
                hasMore,
                nextCursor: hasMore && rows.length > 0 ? rows[rows.length - 1].created_at.toISOString() : null,
                limit: query.limit,
            },
        };
    }
}
//# sourceMappingURL=activity.repository.js.map