import type { Pool, PoolClient } from "pg";
import { pool } from "../../config/database.js";
import type { ProjectSettings } from "./types.js";
import { ProjectError } from "./utils.js";

type ProjectSettingsRow = {
  id: string;
  project_id: string;
  organization_id: string;
  retention_days: number;
  max_events_per_second: number;
  auto_archive: boolean;
  alerting_enabled: boolean;
  ingestion_enabled: boolean;
  metadata: Record<string, any>;
  created_at: Date;
  updated_at: Date;
};

export class SettingsRepository {
  constructor(private readonly db: Pool = pool) {}

  async findByProjectId(
    projectId: string,
    client?: PoolClient,
  ): Promise<ProjectSettings | null> {
    const db = client ?? this.db;
    const result = await db.query<ProjectSettingsRow>(
      `SELECT * FROM project_settings WHERE project_id = $1 LIMIT 1`,
      [projectId],
    );
    return result.rows[0] ? this.mapRow(result.rows[0]) : null;
  }

  async createDefault(
    projectId: string,
    organizationId: string,
    client?: PoolClient,
  ): Promise<ProjectSettings> {
    const db = client ?? this.db;
    const result = await db.query<ProjectSettingsRow>(
      `INSERT INTO project_settings (project_id, organization_id)
       VALUES ($1, $2)
       ON CONFLICT (project_id) DO NOTHING
       RETURNING *`,
      [projectId, organizationId],
    );

    if (result.rowCount === 0) {
      const existing = await this.findByProjectId(projectId, client);
      if (existing) return existing;
      throw new Error("Failed to create project settings");
    }

    return this.mapRow(result.rows[0]!);
  }

  async update(
    projectId: string,
    updates: Partial<ProjectSettings>,
    client?: PoolClient,
  ): Promise<ProjectSettings> {
    const db = client ?? this.db;
    const assignments: string[] = [];
    const values: unknown[] = [];
    let i = 1;

    const set = (col: string, val: unknown) => {
      assignments.push(`${col} = $${i++}`);
      values.push(val);
    };

    if (updates.retentionDays !== undefined) set("retention_days", updates.retentionDays);
    if (updates.maxEventsPerSecond !== undefined) set("max_events_per_second", updates.maxEventsPerSecond);
    if (updates.autoArchive !== undefined) set("auto_archive", updates.autoArchive);
    if (updates.alertingEnabled !== undefined) set("alerting_enabled", updates.alertingEnabled);
    if (updates.ingestionEnabled !== undefined) set("ingestion_enabled", updates.ingestionEnabled);
    if (updates.metadata !== undefined) set("metadata", updates.metadata);

    if (assignments.length === 0) {
      const existing = await this.findByProjectId(projectId, client);
      if (!existing) throw new ProjectError("SETTINGS_NOT_FOUND", "Settings not found", 404);
      return existing;
    }

    values.push(projectId);
    const result = await db.query<ProjectSettingsRow>(
      `UPDATE project_settings
       SET ${assignments.join(", ")}, updated_at = NOW()
       WHERE project_id = $${values.length}
       RETURNING *`,
      values,
    );

    if (result.rowCount === 0) {
      throw new ProjectError("SETTINGS_NOT_FOUND", "Settings not found", 404);
    }

    return this.mapRow(result.rows[0]!);
  }

  private mapRow(row: ProjectSettingsRow): ProjectSettings {
    return {
      id: row.id,
      projectId: row.project_id,
      organizationId: row.organization_id,
      retentionDays: row.retention_days,
      maxEventsPerSecond: row.max_events_per_second,
      autoArchive: row.auto_archive,
      alertingEnabled: row.alerting_enabled,
      ingestionEnabled: row.ingestion_enabled,
      metadata: row.metadata || {},
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
