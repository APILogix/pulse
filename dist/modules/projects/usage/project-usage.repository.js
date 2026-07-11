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
export class ProjectUsageRepository {
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
    // ── Projects ────────────────────────────────────────────────────────────────
    async getProjectStats(projectId, client) {
        const db = client ?? this.db;
        const result = await db.query(`SELECT
         (SELECT COUNT(*) FROM project_api_keys WHERE project_id = $1)::text AS api_keys_count,
         (SELECT COUNT(*) FROM project_api_keys WHERE project_id = $1 AND is_active = TRUE)::text AS active_keys_count,
         (SELECT COUNT(*) FROM project_environments WHERE project_id = $1)::text AS environment_count,
         GREATEST(
           COALESCE((SELECT SUM(request_count) FROM project_api_key_usage WHERE project_id = $1),0),
           COALESCE((SELECT SUM(usage_count) FROM project_api_keys WHERE project_id = $1),0)
         )::text AS total_requests`, [projectId]);
        const row = result.rows[0];
        return {
            totalRequests: Number.parseInt(row?.total_requests ?? "0", 10),
            apiKeysCount: Number.parseInt(row?.api_keys_count ?? "0", 10),
            activeKeysCount: Number.parseInt(row?.active_keys_count ?? "0", 10),
            environmentCount: Number.parseInt(row?.environment_count ?? "0", 10),
        };
    }
    async getProjectUsageCounters(projectId, client) {
        const db = client ?? this.db;
        const result = await db.query(`SELECT
         counter_type,
         COALESCE(SUM(total_value),0)::text AS total_value,
         MAX(period_start) AS last_period_start,
         MAX(period_end) AS last_period_end,
         MAX(last_flushed_at) AS last_flushed_at
       FROM project_usage_realtime
       WHERE project_id = $1
       GROUP BY counter_type
       ORDER BY counter_type ASC`, [projectId]);
        return result.rows.map((row) => ({
            counterType: row.counter_type,
            totalValue: Number.parseInt(row.total_value ?? "0", 10),
            lastPeriodStart: row.last_period_start,
            lastPeriodEnd: row.last_period_end,
            lastFlushedAt: row.last_flushed_at,
        }));
    }
    async getProjectModuleUsageCounts(orgId, client) {
        const db = client ?? this.db;
        const result = await db.query(`SELECT
         (SELECT COUNT(*) FROM projects WHERE org_id = $1 AND deleted_at IS NULL)::text AS projects,
         (SELECT COUNT(*) FROM project_environments WHERE org_id = $1)::text AS environments,
         (SELECT COUNT(*) FROM project_api_keys WHERE org_id = $1 AND is_active = TRUE)::text AS api_keys`, [orgId]);
        const row = result.rows[0];
        return {
            projects: Number.parseInt(row?.projects ?? "0", 10),
            environments: Number.parseInt(row?.environments ?? "0", 10),
            apiKeys: Number.parseInt(row?.api_keys ?? "0", 10),
        };
    }
}
//# sourceMappingURL=project-usage.repository.js.map