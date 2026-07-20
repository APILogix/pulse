/**
 * Project usage repository.
 *
 * Aggregates per-project statistics and usage counters.
 */
import type { Pool, PoolClient } from "pg";
import { pool } from "../../../config/database.js";
import type { ProjectUsageCounter } from "../types.js";

export interface ProjectModuleUsageCounts {
  projects: number;
  environments: number;
  apiKeys: number;
}

export class ProjectUsageRepository {
  constructor(private readonly db: Pool = pool) {}

  async withTransaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      const result = await callback(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  // ── Project stats ───────────────────────────────────────────────────────────

  async getProjectStats(
    projectId: string,
    client?: PoolClient,
  ): Promise<{
    totalRequests: number;
    apiKeysCount: number;
    activeKeysCount: number;
    environmentCount: number;
  }> {
    const db = client ?? this.db;
    const result = await db.query<{
      api_keys_count: string;
      active_keys_count: string;
      environment_count: string;
      total_requests: string;
    }>(
      `SELECT
         (SELECT COUNT(*) FROM project_api_keys WHERE project_id = $1 AND deleted_at IS NULL)::text AS api_keys_count,
         (SELECT COUNT(*) FROM project_api_keys WHERE project_id = $1 AND is_active = TRUE AND deleted_at IS NULL)::text AS active_keys_count,
         (SELECT COUNT(*) FROM project_environments WHERE project_id = $1 AND deleted_at IS NULL)::text AS environment_count,
         COALESCE((SELECT SUM(total_events) FROM project_usage_daily WHERE project_id = $1),0)::text AS total_requests`,
      [projectId],
    );

    const row = result.rows[0];
    return {
      totalRequests: Number.parseInt(row?.total_requests ?? "0", 10),
      apiKeysCount: Number.parseInt(row?.api_keys_count ?? "0", 10),
      activeKeysCount: Number.parseInt(row?.active_keys_count ?? "0", 10),
      environmentCount: Number.parseInt(row?.environment_count ?? "0", 10),
    };
  }

  async getProjectUsageCounters(
    projectId: string,
    client?: PoolClient,
  ): Promise<ProjectUsageCounter[]> {
    const db = client ?? this.db;
    const result = await db.query<{
      counter_type: string;
      total_value: string;
      last_period_start: Date | null;
      last_period_end: Date | null;
      last_flushed_at: Date | null;
    }>(
      `SELECT
         counter_type,
         COALESCE(SUM(value),0)::text AS total_value,
         MAX(period_start) AS last_period_start,
         MAX(period_end) AS last_period_end,
         MAX(updated_at) AS last_flushed_at
       FROM project_usage_minute
       WHERE project_id = $1
       GROUP BY counter_type
       ORDER BY counter_type ASC`,
      [projectId],
    );

    return result.rows.map((row) => ({
      counterType: row.counter_type,
      totalValue: Number.parseInt(row.total_value ?? "0", 10),
      lastPeriodStart: row.last_period_start,
      lastPeriodEnd: row.last_period_end,
      lastFlushedAt: row.last_flushed_at,
    }));
  }

  async getProjectModuleUsageCounts(
    orgId: string,
    client?: PoolClient,
  ): Promise<ProjectModuleUsageCounts> {
    const db = client ?? this.db;
    const result = await db.query<{
      projects: string;
      environments: string;
      api_keys: string;
    }>(
      `SELECT
         (SELECT COUNT(*) FROM projects WHERE org_id = $1 AND deleted_at IS NULL)::text AS projects,
         (SELECT COUNT(*) FROM project_environments WHERE organization_id = $1 AND deleted_at IS NULL)::text AS environments,
         (SELECT COUNT(*) FROM project_api_keys WHERE organization_id = $1 AND deleted_at IS NULL)::text AS api_keys`,
      [orgId],
    );

    const row = result.rows[0];
    return {
      projects: Number.parseInt(row?.projects ?? "0", 10),
      environments: Number.parseInt(row?.environments ?? "0", 10),
      apiKeys: Number.parseInt(row?.api_keys ?? "0", 10),
    };
  }
}
