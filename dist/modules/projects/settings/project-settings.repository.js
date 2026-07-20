import { pool } from "../../../config/database.js";
const DEFAULT_PROJECT_ENVIRONMENTS = ["development", "staging", "production"];
export class ProjectSettingsRepository {
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
    // ── SDK config provisioning ────────────────────────────────────────────────
    async findSdkConfigPlanKey(orgId, client) {
        const db = client ?? this.db;
        try {
            const result = await db.query(`SELECT p.key AS plan_key
           FROM organization_subscriptions s
           INNER JOIN plans p ON p.id = s.plan_id
          WHERE s.org_id = $1
            AND s.status IN ('trialing','active','past_due')
            AND p.is_active = TRUE
          ORDER BY s.current_period_end DESC, s.created_at DESC
          LIMIT 1`, [orgId]);
            return result.rows[0]?.plan_key ?? "free";
        }
        catch (error) {
            if (error.code === "42P01")
                return "free";
            throw error;
        }
    }
    async createDefaultSdkConfigs(project, createdBy, planKey, client) {
        const db = client ?? this.db;
        const result = await db.query(`WITH matching_templates AS (
         SELECT
           t.environment,
           t.config_key,
           t.config_type,
           t.config_value,
           t.schema_version,
           t.target_sdk_versions,
           t.target_platforms,
           t.rollout_percentage
         FROM sdk_config_templates t
         WHERE t.plan_key = $4
           AND t.environment = ANY($5::text[])
           AND t.is_active = TRUE
       ),
       selected_templates AS (
         SELECT
           environment,
           config_key,
           config_type,
           config_value,
           schema_version,
           target_sdk_versions,
           target_platforms,
           rollout_percentage
         FROM matching_templates
         UNION ALL
         SELECT
           f.environment,
           f.config_key,
           f.config_type,
           f.config_value,
           f.schema_version,
           f.target_sdk_versions,
           f.target_platforms,
           f.rollout_percentage
         FROM sdk_config_templates f
         WHERE f.plan_key = 'free'
           AND f.environment = ANY($5::text[])
           AND f.is_active = TRUE
           AND NOT EXISTS (SELECT 1 FROM matching_templates)
       ),
       prepared_configs AS (
         SELECT
           $1::uuid AS org_id,
           $2::uuid AS project_id,
           s.config_key,
           s.config_type,
           jsonb_set(
             jsonb_set(
               COALESCE(s.config_value, '{}'::jsonb),
               '{sdk,projectId}',
               to_jsonb($2::text),
               TRUE
             ),
             '{sdk,environment}',
             to_jsonb(s.environment),
             TRUE
           ) AS config_value,
           s.schema_version,
           s.environment,
           s.target_sdk_versions,
           s.target_platforms,
           s.rollout_percentage
         FROM selected_templates s
       ),
       inserted_configs AS (
         INSERT INTO sdk_configs (
           org_id,
           project_id,
           config_key,
           config_type,
           version,
           version_hash,
           is_latest,
           config_value,
           schema_version,
           environment,
           target_sdk_versions,
           target_platforms,
           rollout_percentage,
           is_active,
           is_encrypted,
           created_by,
           updated_by
         )
         SELECT
           p.org_id,
           p.project_id,
           p.config_key,
           p.config_type,
           1,
           encode(digest(p.config_value::text, 'sha256'), 'hex'),
           TRUE,
           p.config_value,
           p.schema_version,
           p.environment,
           p.target_sdk_versions,
           p.target_platforms,
           p.rollout_percentage,
           TRUE,
           FALSE,
           $3::uuid,
           $3::uuid
         FROM prepared_configs p
         ON CONFLICT (
           org_id,
           (COALESCE(project_id, '00000000-0000-0000-0000-000000000000'::uuid)),
           config_key,
           environment
         ) WHERE is_latest = TRUE DO NOTHING
         RETURNING id, version, version_hash, config_value, rollout_percentage
       ),
       inserted_versions AS (
         INSERT INTO sdk_config_versions (
           config_id,
           version,
           version_hash,
           config_value,
           change_type,
           change_summary,
           created_by
         )
         SELECT
           id,
           version,
           version_hash,
           config_value,
           'create',
           'Initial project SDK config',
           $3::uuid
         FROM inserted_configs
         RETURNING id
       ),
       inserted_deployments AS (
         INSERT INTO sdk_config_deployments (
           config_id,
           version,
           status,
           rollout_percentage,
           started_at
         )
         SELECT
           id,
           version,
           'deploying',
           rollout_percentage,
           NOW()
         FROM inserted_configs
         RETURNING id
       )
       SELECT COUNT(*)::text AS inserted_count FROM inserted_configs`, [
            project.orgId,
            project.id,
            createdBy,
            planKey,
            DEFAULT_PROJECT_ENVIRONMENTS,
        ]);
        return Number.parseInt(result.rows[0]?.inserted_count ?? "0", 10);
    }
}
//# sourceMappingURL=project-settings.repository.js.map