import { pool } from "../../../config/database.js";
import { cursorPage } from "../shared/base.repository.js";
import type { CursorPaginationQuery, CursorPaginatedResponse } from "../shared/types.js";
import type {
  SdkConfigResolvedDto,
  SdkConfigRow,
  SdkConfigVersionRow,
} from "./sdk-config.types.js";

const CONFIG_COLS = `
  h.id,h.organization_id,h.project_id,h.environment_id,h.published_revision_id,
  h.current_revision,h.current_hash,h.schema_version,h.created_by,h.updated_by,
  h.created_at,h.updated_at,h.version,r.compiled_snapshot,r.published_at,
  e.name AS environment_name,e.slug AS environment_slug
`;

const VERSION_COLS = `
  r.id,r.config_id,r.organization_id,r.project_id,r.environment_id,
  e.name AS environment_name,e.slug AS environment_slug,
  r.revision_number,r.compiled_snapshot,r.config_hash,r.schema_version,r.change_type,
  r.change_summary,r.rolled_back_to_revision,r.published_by,r.published_at
`;

/** Read-only admin projection. All mutations go through RemoteSdkConfigService. */
export class SdkConfigRepository {
  private readonly db = pool;

  async findById(orgId: string, configId: string): Promise<SdkConfigRow | null> {
    const result = await this.db.query<SdkConfigRow>(
      `SELECT ${CONFIG_COLS}
         FROM project_environment_sdk_configs h
         JOIN project_environment_sdk_config_revisions r ON r.id=h.published_revision_id
         JOIN project_environments e ON e.id=h.environment_id
        WHERE h.organization_id=$1 AND h.id=$2`,
      [orgId, configId],
    );
    return result.rows[0] ?? null;
  }

  async list(
    orgId: string,
    filters: { projectId?: string; environmentId?: string },
    query: CursorPaginationQuery,
  ): Promise<CursorPaginatedResponse<SdkConfigRow>> {
    const params: unknown[] = [orgId];
    const where = ["h.organization_id=$1"];
    if (filters.projectId) {
      params.push(filters.projectId);
      where.push(`h.project_id=$${params.length}`);
    }
    if (filters.environmentId) {
      params.push(filters.environmentId);
      where.push(`h.environment_id=$${params.length}`);
    }
    const count = await this.db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM project_environment_sdk_configs h WHERE ${where.join(" AND ")}`,
      params,
    );
    if (query.cursor) {
      params.push(query.cursor);
      where.push(`h.created_at < $${params.length}`);
    }
    params.push(query.limit + 1);
    const rows = await this.db.query<SdkConfigRow>(
      `SELECT ${CONFIG_COLS}
         FROM project_environment_sdk_configs h
         JOIN project_environment_sdk_config_revisions r ON r.id=h.published_revision_id
         JOIN project_environments e ON e.id=h.environment_id
        WHERE ${where.join(" AND ")}
        ORDER BY h.created_at DESC LIMIT $${params.length}`,
      params,
    );
    return cursorPage(rows.rows, query.limit, Number(count.rows[0]?.count ?? 0));
  }

  async listVersions(configId: string): Promise<SdkConfigVersionRow[]> {
    const result = await this.db.query<SdkConfigVersionRow>(
      `SELECT ${VERSION_COLS}
         FROM project_environment_sdk_config_revisions r
         JOIN project_environments e ON e.id=r.environment_id
        WHERE r.config_id=$1 ORDER BY r.revision_number DESC`,
      [configId],
    );
    return result.rows;
  }

  async getVersion(configId: string, revision: number): Promise<SdkConfigVersionRow | null> {
    const result = await this.db.query<SdkConfigVersionRow>(
      `SELECT ${VERSION_COLS}
         FROM project_environment_sdk_config_revisions r
         JOIN project_environments e ON e.id=r.environment_id
        WHERE r.config_id=$1 AND r.revision_number=$2`,
      [configId, revision],
    );
    return result.rows[0] ?? null;
  }

  async resolveForEnvironment(orgId: string, environmentId: string): Promise<SdkConfigResolvedDto | null> {
    const result = await this.db.query<{
      environment_id: string;
      environment_name: string;
      environment_slug: string;
      current_revision: number;
      current_hash: string;
      compiled_snapshot: SdkConfigResolvedDto["compiledSnapshot"];
      published_at: Date;
    }>(
      `SELECT h.environment_id,e.name AS environment_name,e.slug AS environment_slug,
              h.current_revision,h.current_hash,
              r.compiled_snapshot,r.published_at
         FROM project_environment_sdk_configs h
         JOIN project_environment_sdk_config_revisions r ON r.id=h.published_revision_id
         JOIN project_environments e
           ON e.id=h.environment_id AND e.project_id=h.project_id
          AND e.organization_id=h.organization_id
        WHERE h.organization_id=$1 AND h.environment_id=$2
          AND e.is_active=TRUE AND e.deleted_at IS NULL`,
      [orgId, environmentId],
    );
    const row = result.rows[0];
    return row
      ? {
          environmentId: row.environment_id,
          environmentName: row.environment_name,
          environmentSlug: row.environment_slug,
          revision: row.current_revision,
          revisionHash: row.current_hash,
          schemaVersion: 1,
          compiledSnapshot: row.compiled_snapshot,
          publishedAt: row.published_at,
        }
      : null;
  }
}
