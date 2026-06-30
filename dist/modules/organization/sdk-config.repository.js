import { pool } from "../../config/database.js";
import { ConflictError, NotFoundError } from "./types.js";
const CONFIG_COLS = `id,org_id,project_id,config_key,config_type,version,version_hash,is_latest,
  config_value,schema_version,environment,target_sdk_versions,target_platforms,
  rollout_percentage,is_active,is_encrypted,created_by,updated_by,created_at,updated_at`;
const VERSION_COLS = `id,config_id,version,version_hash,config_value,config_value_encrypted,
  change_type,change_summary,change_diff,rolled_back_at,rolled_back_by,rolled_back_to_version,
  created_by,created_at`;
const DEPLOYMENT_COLS = `id,config_id,version,status,rollout_percentage,target_count,
  reached_count,error_count,last_error,started_at,completed_at,created_at,updated_at`;
export class SdkConfigRepository {
    db = pool;
    async withTransaction(fn) {
        const client = await this.db.connect();
        try {
            await client.query("BEGIN");
            const r = await fn(client);
            await client.query("COMMIT");
            return r;
        }
        catch (e) {
            await client.query("ROLLBACK");
            throw e;
        }
        finally {
            client.release();
        }
    }
    // ── Create ────────────────────────────────────
    async create(data) {
        return this.withTransaction(async (client) => {
            let row;
            try {
                const r = await client.query(`INSERT INTO sdk_configs
             (org_id,project_id,config_key,config_type,version,version_hash,is_latest,
              config_value,schema_version,environment,target_sdk_versions,target_platforms,
              rollout_percentage,is_active,is_encrypted,created_by,updated_by)
           VALUES ($1,$2,$3,$4,1,$5,TRUE,$6,$7,$8,$9,$10,$11,TRUE,$12,$13,$13)
           RETURNING ${CONFIG_COLS}`, [
                    data.orgId, data.projectId, data.configKey, data.configType, data.versionHash,
                    JSON.stringify(data.configValue), data.schemaVersion, data.environment,
                    data.targetSdkVersions, data.targetPlatforms, data.rolloutPercentage,
                    data.isEncrypted, data.createdBy,
                ]);
                row = r.rows[0];
            }
            catch (e) {
                if (e.code === "23505") {
                    throw new ConflictError("An SDK config with this key already exists for this scope");
                }
                throw e;
            }
            await client.query(`INSERT INTO sdk_config_versions
           (config_id,version,version_hash,config_value,change_type,change_summary,created_by)
         VALUES ($1,1,$2,$3,'create',$4,$5)`, [row.id, data.versionHash, JSON.stringify(data.configValue), "Initial version", data.createdBy]);
            await client.query(`INSERT INTO sdk_config_deployments
           (config_id,version,status,rollout_percentage,started_at)
         VALUES ($1,1,'deploying',$2,NOW())`, [row.id, data.rolloutPercentage]);
            return row;
        });
    }
    // ── Read ──────────────────────────────────────
    async findById(orgId, configId) {
        const r = await this.db.query(`SELECT ${CONFIG_COLS} FROM sdk_configs WHERE org_id=$1 AND id=$2`, [orgId, configId]);
        return r.rows[0] ?? null;
    }
    async list(orgId, filters) {
        const params = [orgId];
        let where = `org_id=$1 AND is_latest=TRUE`;
        if (!filters.includeInactive)
            where += ` AND is_active=TRUE`;
        if (filters.projectId) {
            params.push(filters.projectId);
            where += ` AND project_id=$${params.length}`;
        }
        if (filters.environment) {
            params.push(filters.environment);
            where += ` AND environment=$${params.length}`;
        }
        if (filters.configKey) {
            params.push(filters.configKey);
            where += ` AND config_key=$${params.length}`;
        }
        const r = await this.db.query(`SELECT ${CONFIG_COLS} FROM sdk_configs WHERE ${where} ORDER BY config_key ASC, environment ASC`, params);
        return r.rows;
    }
    // ── Update (in-place, version++) ──────────────
    async update(orgId, configId, data) {
        return this.withTransaction(async (client) => {
            // Lock the live row so concurrent updates serialize and versions stay monotonic.
            const cur = await client.query(`SELECT ${CONFIG_COLS} FROM sdk_configs WHERE org_id=$1 AND id=$2 FOR UPDATE`, [orgId, configId]);
            if (!cur.rows[0])
                throw new NotFoundError("SDK config");
            const sets = [
                `config_value=$3`, `version=$4`, `version_hash=$5`, `updated_by=$6`,
            ];
            const vals = [
                orgId, configId, JSON.stringify(data.configValue), data.newVersion, data.versionHash, data.updatedBy,
            ];
            const push = (col, v) => { vals.push(v); sets.push(`${col}=$${vals.length}`); };
            if (data.schemaVersion !== undefined)
                push("schema_version", data.schemaVersion);
            if (data.environment !== undefined)
                push("environment", data.environment);
            if (data.targetSdkVersions !== undefined)
                push("target_sdk_versions", data.targetSdkVersions);
            if (data.targetPlatforms !== undefined)
                push("target_platforms", data.targetPlatforms);
            if (data.rolloutPercentage !== undefined)
                push("rollout_percentage", data.rolloutPercentage);
            if (data.isActive !== undefined)
                push("is_active", data.isActive);
            const upd = await client.query(`UPDATE sdk_configs SET ${sets.join(",")} WHERE org_id=$1 AND id=$2 RETURNING ${CONFIG_COLS}`, vals);
            const row = upd.rows[0];
            await client.query(`INSERT INTO sdk_config_versions
           (config_id,version,version_hash,config_value,change_type,change_summary,change_diff,
            rolled_back_by,rolled_back_to_version,rolled_back_at,created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [
                configId, data.newVersion, data.versionHash, JSON.stringify(data.configValue),
                data.changeType, data.changeSummary, data.changeDiff ? JSON.stringify(data.changeDiff) : null,
                data.changeType === "rollback" ? data.updatedBy : null,
                data.rolledBackToVersion ?? null,
                data.changeType === "rollback" ? new Date() : null,
                data.updatedBy,
            ]);
            await client.query(`INSERT INTO sdk_config_deployments
           (config_id,version,status,rollout_percentage,started_at)
         VALUES ($1,$2,'deploying',$3,NOW())`, [configId, data.newVersion, row.rollout_percentage]);
            return row;
        });
    }
    // ── Versions ──────────────────────────────────
    async listVersions(configId) {
        const r = await this.db.query(`SELECT ${VERSION_COLS} FROM sdk_config_versions WHERE config_id=$1 ORDER BY version DESC`, [configId]);
        return r.rows;
    }
    async getVersion(configId, version) {
        const r = await this.db.query(`SELECT ${VERSION_COLS} FROM sdk_config_versions WHERE config_id=$1 AND version=$2`, [configId, version]);
        return r.rows[0] ?? null;
    }
    // ── Deployments ───────────────────────────────
    async listDeployments(configId) {
        const r = await this.db.query(`SELECT ${DEPLOYMENT_COLS} FROM sdk_config_deployments WHERE config_id=$1 ORDER BY version DESC`, [configId]);
        return r.rows;
    }
    /** Bump reached_count for a (config,version) deployment; mark deployed when target reached. */
    async acknowledgeDeployment(configId, version) {
        await this.db.query(`UPDATE sdk_config_deployments
       SET reached_count = reached_count + 1,
           status = CASE
             WHEN target_count IS NOT NULL AND reached_count + 1 >= target_count THEN 'deployed'
             ELSE status END,
           completed_at = CASE
             WHEN target_count IS NOT NULL AND reached_count + 1 >= target_count THEN NOW()
             ELSE completed_at END
       WHERE config_id=$1 AND version=$2`, [configId, version]);
    }
    // ── SDK runtime resolve ───────────────────────
    /**
     * Resolve the active config set an SDK should receive for a scope. Matches the
     * org-wide rows plus (optionally) the project's rows, the requested
     * environment or 'all', and platform targeting (NULL target = all platforms).
     * Rollout filtering is applied by the caller (needs a stable per-instance key).
     */
    async resolveForSdk(orgId, projectId, environment, platform) {
        const params = [orgId, environment];
        let where = `org_id=$1 AND is_latest=TRUE AND is_active=TRUE
      AND environment IN ($2,'all')`;
        if (projectId) {
            params.push(projectId);
            where += ` AND (project_id IS NULL OR project_id=$${params.length})`;
        }
        else {
            where += ` AND project_id IS NULL`;
        }
        if (platform) {
            params.push(platform);
            where += ` AND (target_platforms IS NULL OR $${params.length} = ANY(target_platforms))`;
        }
        const r = await this.db.query(`SELECT ${CONFIG_COLS} FROM sdk_configs WHERE ${where}
       ORDER BY config_key ASC, (project_id IS NOT NULL) DESC`, params);
        return r.rows.map((row) => ({
            configKey: row.config_key,
            configValue: row.config_value,
            version: row.version,
            versionHash: row.version_hash,
            schemaVersion: row.schema_version,
            environment: row.environment,
            targetPlatforms: row.target_platforms,
            rollout_percentage: row.rollout_percentage,
        }));
    }
}
//# sourceMappingURL=sdk-config.repository.js.map