import type { Pool, PoolClient } from "pg";
import { pool } from "../../../../config/database.js";
import type {
  UpdateAlertPreferenceBody,
  ProjectMemberNotificationPreference,
  ProjectNotificationPreference,
  NotificationChannel,
} from "./alert-preferences.types.js";
import { ProjectError } from "../../shared/utils.js";

type DbClient = Pool | PoolClient;

const MEMBER_PREF_COLUMNS = `
  p.id, p.project_id, p.user_id, c.channel_type AS channel, p.category, p.enabled,
  p.severity_threshold, p.digest_mode, p.quiet_hours, p.created_at, p.updated_at
`;

const PROJECT_PREF_COLUMNS = `
  id, project_id, organization_id, category, enabled, severity_threshold,
  default_channel_ids, default_member_ids, quiet_hours, digest_mode, created_at, updated_at
`;

export class AlertPreferencesRepository {
  async withTransaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await callback(client);
      await client.query("COMMIT");
      return result;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  private mapMemberPreferenceRow(row: Record<string, unknown>): ProjectMemberNotificationPreference {
    return {
      id: row.id as string,
      projectId: row.project_id as string,
      userId: row.user_id as string,
      channel: row.channel as NotificationChannel,
      category: row.category as ProjectMemberNotificationPreference["category"],
      enabled: row.enabled === true,
      severityThreshold: row.severity_threshold as string,
      digestMode: row.digest_mode as string,
      quietHours: (row.quiet_hours as Record<string, unknown> | null) ?? null,
      createdAt: row.created_at as Date,
      updatedAt: row.updated_at as Date,
    };
  }

  private mapProjectPreferenceRow(row: Record<string, unknown>): ProjectNotificationPreference {
    return {
      id: row.id as string,
      projectId: row.project_id as string,
      organizationId: row.organization_id as string,
      category: row.category as ProjectNotificationPreference["category"],
      enabled: row.enabled === true,
      severityThreshold: row.severity_threshold as string,
      connectorIds: (row.default_channel_ids as string[] | null) ?? [],
      memberIds: (row.default_member_ids as string[] | null) ?? [],
      quietHours: (row.quiet_hours as Record<string, unknown> | null) ?? null,
      digestMode: row.digest_mode as string,
      createdAt: row.created_at as Date,
      updatedAt: row.updated_at as Date,
    };
  }

  async getMemberPreferences(
    organizationId: string,
    projectId: string,
    userId: string,
    client?: DbClient,
  ): Promise<ProjectMemberNotificationPreference[]> {
    const db = client ?? pool;
    const res = await db.query(
      `SELECT ${MEMBER_PREF_COLUMNS}
         FROM project_member_alert_channel_preferences p
         JOIN project_alert_channels c
           ON c.id = p.project_alert_channel_id
          AND c.organization_id = p.organization_id
          AND c.project_id = p.project_id
        WHERE p.organization_id = $1 AND p.project_id = $2 AND p.user_id = $3
          AND p.deleted_at IS NULL AND c.deleted_at IS NULL`,
      [organizationId, projectId, userId],
    );
    return res.rows.map((row) => this.mapMemberPreferenceRow(row as Record<string, unknown>));
  }

  async getProjectDefaults(
    organizationId: string,
    projectId: string,
    client?: DbClient,
  ): Promise<ProjectNotificationPreference[]> {
    const db = client ?? pool;
    const res = await db.query(
      `SELECT ${PROJECT_PREF_COLUMNS}
         FROM project_notification_preferences
        WHERE organization_id = $1 AND project_id = $2 AND deleted_at IS NULL`,
      [organizationId, projectId],
    );
    return res.rows.map((row) => this.mapProjectPreferenceRow(row as Record<string, unknown>));
  }

  async createMemberPreference(
    organizationId: string,
    projectId: string,
    userId: string,
    channel: NotificationChannel,
    category: string,
    client?: DbClient,
  ): Promise<ProjectMemberNotificationPreference> {
    const db = client ?? pool;
    const res = await db.query(
      `WITH inserted AS (
         INSERT INTO project_member_alert_channel_preferences (
           organization_id, project_id, user_id, project_alert_channel_id, category
         )
         SELECT $1, $2, $3, c.id, $5
           FROM project_alert_channels c
          WHERE c.organization_id = $1 AND c.project_id = $2
            AND c.channel_type = $4 AND c.enabled = TRUE AND c.deleted_at IS NULL
          ORDER BY c.is_default DESC, c.created_at ASC
          LIMIT 1
         ON CONFLICT (project_id, user_id, project_alert_channel_id, category)
         DO UPDATE SET organization_id = EXCLUDED.organization_id, deleted_at = NULL, updated_at = NOW()
         RETURNING id
       )
       SELECT ${MEMBER_PREF_COLUMNS}
         FROM project_member_alert_channel_preferences p
         JOIN project_alert_channels c ON c.id = p.project_alert_channel_id
         JOIN inserted i ON i.id = p.id`,
      [organizationId, projectId, userId, channel, category],
    );
    if (!res.rows[0]) {
      throw new ProjectError("ALERT_CHANNEL_NOT_FOUND", "No active alert channel exists for this channel type", 404);
    }
    return this.mapMemberPreferenceRow(res.rows[0] as Record<string, unknown>);
  }

  async updateMemberPreference(
    prefId: string,
    organizationId: string,
    projectId: string,
    userId: string,
    dto: UpdateAlertPreferenceBody,
    client?: DbClient,
  ): Promise<ProjectMemberNotificationPreference> {
    const db = client ?? pool;
    const assignments: string[] = [];
    const values: unknown[] = [];
    const add = (column: string, value: unknown): void => {
      values.push(value);
      assignments.push(`${column} = $${values.length}`);
    };
    if (dto.enabled !== undefined) add("enabled", dto.enabled);
    if (dto.severity_threshold !== undefined) add("severity_threshold", dto.severity_threshold);
    if (dto.digest_mode !== undefined) add("digest_mode", dto.digest_mode);
    if (dto.quiet_hours !== undefined) add("quiet_hours", dto.quiet_hours);

    if (assignments.length === 0) {
      const existing = await db.query(
        `SELECT ${MEMBER_PREF_COLUMNS}
           FROM project_member_alert_channel_preferences p
           JOIN project_alert_channels c ON c.id = p.project_alert_channel_id
          WHERE p.id = $1 AND p.organization_id = $2 AND p.project_id = $3 AND p.user_id = $4
            AND p.deleted_at IS NULL AND c.deleted_at IS NULL`,
        [prefId, organizationId, projectId, userId],
      );
      if (!existing.rows[0]) throw new ProjectError("PREFERENCE_NOT_FOUND", "Preference not found", 404);
      return this.mapMemberPreferenceRow(existing.rows[0] as Record<string, unknown>);
    }

    assignments.push("updated_at = NOW()");
    values.push(prefId, organizationId, projectId, userId);
    const res = await db.query(
      `WITH updated AS (
         UPDATE project_member_alert_channel_preferences
            SET ${assignments.join(", ")}
          WHERE id = $${values.length - 3} AND organization_id = $${values.length - 2}
            AND project_id = $${values.length - 1} AND user_id = $${values.length}
            AND deleted_at IS NULL
          RETURNING *
       )
       SELECT ${MEMBER_PREF_COLUMNS}
         FROM updated p
         JOIN project_alert_channels c
           ON c.id = p.project_alert_channel_id
          AND c.organization_id = p.organization_id
          AND c.project_id = p.project_id
        WHERE c.deleted_at IS NULL`,
      values,
    );
    if (!res.rows[0]) throw new ProjectError("PREFERENCE_NOT_FOUND", "Preference not found", 404);
    return this.mapMemberPreferenceRow(res.rows[0] as Record<string, unknown>);
  }

  async bulkSubscribe(
    organizationId: string,
    projectId: string,
    channel: NotificationChannel,
    category: string,
    userIds: string[],
    client?: DbClient,
  ): Promise<void> {
    if (userIds.length === 0) return;
    const db = client ?? pool;
    await db.query(
      `INSERT INTO project_member_alert_channel_preferences (
         organization_id, project_id, user_id, project_alert_channel_id, category, enabled
       )
       SELECT $1, $2, requested.user_id, channel.id, $4, TRUE
         FROM unnest($5::uuid[]) AS requested(user_id)
         JOIN project_members member
           ON member.organization_id = $1 AND member.project_id = $2
          AND member.user_id = requested.user_id AND member.status = 'active'
         CROSS JOIN project_alert_channels channel
        WHERE channel.organization_id = $1 AND channel.project_id = $2
          AND channel.channel_type = $3 AND channel.enabled = TRUE AND channel.deleted_at IS NULL
       ON CONFLICT (project_id, user_id, project_alert_channel_id, category)
       DO UPDATE SET organization_id = EXCLUDED.organization_id, enabled = TRUE,
                     deleted_at = NULL, updated_at = NOW()`,
      [organizationId, projectId, channel, category, userIds],
    );
  }

  async resolveRecipients(
    organizationId: string,
    projectId: string,
    category: string,
    severity: string,
    client?: DbClient,
  ): Promise<string[]> {
    const db = client ?? pool;
    const res = await db.query<{ user_id: string }>(
      `SELECT DISTINCT pref.user_id
         FROM project_member_alert_channel_preferences pref
         JOIN project_members member
           ON member.organization_id = pref.organization_id
          AND member.project_id = pref.project_id
          AND member.user_id = pref.user_id
          AND member.status = 'active'
         JOIN project_alert_channels channel
           ON channel.id = pref.project_alert_channel_id
          AND channel.organization_id = pref.organization_id
          AND channel.project_id = pref.project_id
          AND channel.enabled = TRUE
          AND channel.deleted_at IS NULL
        WHERE pref.organization_id = $1 AND pref.project_id = $2
          AND pref.deleted_at IS NULL AND pref.enabled = TRUE
          AND (pref.category = 'all' OR pref.category = $3)
          AND CASE pref.severity_threshold
                WHEN 'info' THEN 0 WHEN 'warning' THEN 1 WHEN 'error' THEN 2 WHEN 'critical' THEN 3
                ELSE 4
              END <= CASE $4
                WHEN 'info' THEN 0 WHEN 'warning' THEN 1 WHEN 'error' THEN 2 WHEN 'critical' THEN 3
                ELSE -1
              END`,
      [organizationId, projectId, category, severity],
    );
    return res.rows.map((row) => row.user_id);
  }

  async seedMissingMemberPreferences(
    organizationId: string,
    projectId: string,
    userId: string,
    client?: DbClient,
  ): Promise<ProjectMemberNotificationPreference[]> {
    // Compatibility method only: canonical preferences are created explicitly
    // for real, active project channels. Never synthesize channel/category rows.
    return this.getMemberPreferences(organizationId, projectId, userId, client);
  }
}
