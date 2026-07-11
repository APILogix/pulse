import { pool } from "../../../config/database.js";
import { ProjectError } from "../shared/utils.js";
// Column list selected for every project read. Centralized so the projection
// stays consistent across find/list/update.
const PROJECT_COLUMNS = `
  id, org_id, name, slug, description, status, default_environment AS environment,
  archived_at, deleted_at, created_at, updated_at
`;
const API_KEY_COLUMNS = `
  id, project_id, org_id, key_hash, key_prefix, key_type, environment,
  name, description, is_active, status, created_by,
  rotated_from_key_id, rotated_at, rotated_by, rotation_reason, grace_period_ends_at,
  revoked_at, revoked_by, revoked_reason, expires_at,
  auto_rotate_enabled, auto_rotate_days,
  last_used_at, last_used_ip, usage_count, error_count,
  rate_limit_per_second, rate_limit_per_minute, rate_limit_per_hour,
  permissions, allowed_endpoints, blocked_endpoints, metadata,
  created_at, updated_at
`;
const ENV_COLUMNS = `
  id, project_id, org_id, environment, is_active,
  rate_limit_per_second, rate_limit_per_minute, rate_limit_per_hour, burst_limit,
  allowed_event_types, max_event_size_bytes, max_batch_size,
  require_https, ip_allowlist, ip_blocklist, alert_email, alert_webhook_url,
  created_by, created_at, updated_at
`;
const DEFAULT_PROJECT_ENVIRONMENTS = ["development", "staging", "production"];
export class MemberRepository {
    db;
    constructor(db = pool) {
        this.db = db;
    }
    async withTransaction(callback) {
        const client = await this.db.connect();
        try {
            await client.query("BEGIN");
            const result = await callback(client);
            await client.query("COMMIT");
            return result;
        }
        catch (error) {
            await client.query("ROLLBACK");
            throw error;
        }
        finally {
            client.release();
        }
    }
    // ── Membership ────────────────────────────────────────────────────────────
    async findOrganizationMembership(orgId, userId, client) {
        const db = client ?? this.db;
        // organization_members uses a `status` column, not is_active; derive it.
        const result = await db.query(`SELECT org_id, user_id, role, (status = 'active') AS is_active
         FROM organization_members
        WHERE org_id = $1 AND user_id = $2
        LIMIT 1`, [orgId, userId]);
        const row = result.rows[0];
        if (!row)
            return null;
        return {
            orgId: row.org_id,
            userId: row.user_id,
            role: row.role,
            isActive: row.is_active,
        };
    }
    // ── Projects ────────────────────────────────────────────────────────────────
    // ── Mapping helpers ─────────────────────────────────────────────────────────
    buildProjectAssignments(input) {
        const assignments = [];
        const values = [];
        let i = 1;
        const set = (col, val) => {
            assignments.push(`${col} = $${i++}`);
            values.push(val);
        };
        if (input.name !== undefined)
            set("name", input.name);
        if (input.description !== undefined)
            set("description", input.description);
        if (input.status !== undefined)
            set("status", input.status);
        if (input.environment !== undefined)
            set("default_environment", input.environment);
        if (input.archivedAt !== undefined)
            set("archived_at", input.archivedAt);
        return { assignments, values };
    }
}
//# sourceMappingURL=member.repository.js.map