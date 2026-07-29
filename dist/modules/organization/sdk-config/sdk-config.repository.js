import { pool } from "../../../config/database.js";
import { NotFoundError } from "../types.js";
import { cursorPage } from "../shared/base.repository.js";
const CONFIG_COLS = `
  h.id,h.organization_id,h.project_id,h.environment_id,h.published_revision_id,
  h.current_revision,h.current_hash,h.schema_version,h.created_by,h.updated_by,
  h.created_at,h.updated_at,h.version,r.config_value,r.published_at,
  e.name AS environment_name,e.slug AS environment_slug
`;
const VERSION_COLS = `
  r.id,r.config_id,r.organization_id,r.project_id,r.environment_id,
  e.name AS environment_name,e.slug AS environment_slug,
  r.revision_number,r.config_value,r.config_hash,r.schema_version,r.change_type,
  r.change_summary,r.rolled_back_to_revision,r.published_by,r.published_at
`;
export class SdkConfigRepository {
    db = pool;
    async withTransaction(fn) {
        const client = await this.db.connect();
        try {
            await client.query("BEGIN");
            const result = await fn(client);
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
    async findById(orgId, configId) {
        const result = await this.db.query(`SELECT ${CONFIG_COLS}
         FROM project_environment_sdk_configs h
         JOIN project_environment_sdk_config_revisions r ON r.id=h.published_revision_id
         JOIN project_environments e ON e.id=h.environment_id
        WHERE h.organization_id=$1 AND h.id=$2`, [orgId, configId]);
        return result.rows[0] ?? null;
    }
    async list(orgId, filters, query) {
        const params = [orgId];
        const where = ["h.organization_id=$1"];
        if (filters.projectId) {
            params.push(filters.projectId);
            where.push(`h.project_id=$${params.length}`);
        }
        if (filters.environmentId) {
            params.push(filters.environmentId);
            where.push(`h.environment_id=$${params.length}`);
        }
        const count = await this.db.query(`SELECT COUNT(*)::text AS count FROM project_environment_sdk_configs h WHERE ${where.join(" AND ")}`, params);
        if (query.cursor) {
            params.push(query.cursor);
            where.push(`h.created_at < $${params.length}`);
        }
        params.push(query.limit + 1);
        const rows = await this.db.query(`SELECT ${CONFIG_COLS}
         FROM project_environment_sdk_configs h
         JOIN project_environment_sdk_config_revisions r ON r.id=h.published_revision_id
         JOIN project_environments e ON e.id=h.environment_id
        WHERE ${where.join(" AND ")}
        ORDER BY h.created_at DESC LIMIT $${params.length}`, params);
        return cursorPage(rows.rows, query.limit, Number(count.rows[0]?.count ?? 0));
    }
    async publish(orgId, configId, data) {
        return this.withTransaction(async (client) => {
            const current = await client.query(`SELECT id,organization_id,project_id,environment_id,current_revision
           FROM project_environment_sdk_configs
          WHERE organization_id=$1 AND id=$2 FOR UPDATE`, [orgId, configId]);
            const head = current.rows[0];
            if (!head)
                throw new NotFoundError("SDK config");
            const revision = head.current_revision + 1;
            const inserted = await client.query(`INSERT INTO project_environment_sdk_config_revisions(
           config_id,organization_id,project_id,environment_id,revision_number,
           config_value,config_hash,schema_version,change_type,change_summary,
           rolled_back_to_revision,published_by
         ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         RETURNING id`, [
                head.id,
                head.organization_id,
                head.project_id,
                head.environment_id,
                revision,
                JSON.stringify(data.configValue),
                data.configHash,
                data.schemaVersion,
                data.changeType,
                data.changeSummary,
                data.rolledBackToRevision ?? null,
                data.publishedBy,
            ]);
            await client.query(`UPDATE project_environment_sdk_configs
            SET published_revision_id=$3,current_revision=$4,current_hash=$5,
                schema_version=$6,updated_by=$7,version=version+1
          WHERE organization_id=$1 AND id=$2`, [orgId, configId, inserted.rows[0].id, revision, data.configHash, data.schemaVersion, data.publishedBy]);
            const result = await client.query(`SELECT ${CONFIG_COLS}
           FROM project_environment_sdk_configs h
           JOIN project_environment_sdk_config_revisions r ON r.id=h.published_revision_id
           JOIN project_environments e ON e.id=h.environment_id
          WHERE h.organization_id=$1 AND h.id=$2`, [orgId, configId]);
            return result.rows[0];
        });
    }
    async listVersions(configId) {
        const result = await this.db.query(`SELECT ${VERSION_COLS}
         FROM project_environment_sdk_config_revisions r
         JOIN project_environments e ON e.id=r.environment_id
        WHERE r.config_id=$1 ORDER BY r.revision_number DESC`, [configId]);
        return result.rows;
    }
    async getVersion(configId, revision) {
        const result = await this.db.query(`SELECT ${VERSION_COLS}
         FROM project_environment_sdk_config_revisions r
         JOIN project_environments e ON e.id=r.environment_id
        WHERE r.config_id=$1 AND r.revision_number=$2`, [configId, revision]);
        return result.rows[0] ?? null;
    }
    async resolveForEnvironment(orgId, environmentId) {
        const result = await this.db.query(`SELECT h.environment_id,e.name AS environment_name,e.slug AS environment_slug,
              h.current_revision,h.current_hash,h.schema_version,
              r.config_value,r.published_at
         FROM project_environment_sdk_configs h
         JOIN project_environment_sdk_config_revisions r ON r.id=h.published_revision_id
         JOIN project_environments e
           ON e.id=h.environment_id AND e.project_id=h.project_id
          AND e.organization_id=h.organization_id
        WHERE h.organization_id=$1 AND h.environment_id=$2
          AND e.is_active=TRUE AND e.deleted_at IS NULL`, [orgId, environmentId]);
        const row = result.rows[0];
        return row
            ? {
                environmentId: row.environment_id,
                environmentName: row.environment_name,
                environmentSlug: row.environment_slug,
                revision: row.current_revision,
                revisionHash: row.current_hash,
                schemaVersion: row.schema_version,
                configValue: row.config_value,
                publishedAt: row.published_at,
            }
            : null;
    }
}
//# sourceMappingURL=sdk-config.repository.js.map