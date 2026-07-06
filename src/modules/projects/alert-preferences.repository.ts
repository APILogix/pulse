import type { PoolClient } from "pg";
import { pool } from "../../config/database.js";
import type {
  UpdateAlertPreferenceBody,
  ProjectMemberAlertPreference,
} from "./alert-preferences.types.js";
import { ProjectError } from "./utils.js";

const PREF_COLUMNS = `
  id, project_id, user_id, route_id, is_subscribed,
  min_severity, quiet_hours_start, quiet_hours_end, created_at, updated_at
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

  private mapRow(row: any): ProjectMemberAlertPreference {
    return {
      id: row.id,
      projectId: row.project_id,
      userId: row.user_id,
      routeId: row.route_id,
      isSubscribed: row.is_subscribed,
      minSeverity: row.min_severity,
      quietHoursStart: row.quiet_hours_start,
      quietHoursEnd: row.quiet_hours_end,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async getPreferences(projectId: string, userId: string): Promise<ProjectMemberAlertPreference[]> {
    const res = await pool.query(
      `SELECT ${PREF_COLUMNS} FROM project_member_alert_preferences WHERE project_id = $1 AND user_id = $2`,
      [projectId, userId]
    );
    return res.rows.map(this.mapRow);
  }

  async createPreference(
    projectId: string,
    userId: string,
    routeId: string,
    client: PoolClient = pool as unknown as PoolClient,
  ): Promise<ProjectMemberAlertPreference> {
    const res = await client.query(
      `
      INSERT INTO project_member_alert_preferences (
        project_id, user_id, route_id
      ) VALUES ($1, $2, $3)
      ON CONFLICT (project_id, user_id, route_id) DO NOTHING
      RETURNING ${PREF_COLUMNS}
      `,
      [projectId, userId, routeId]
    );
    if (!res.rows.length) {
      // It already exists, fetch it
      const existing = await client.query(
        `SELECT ${PREF_COLUMNS} FROM project_member_alert_preferences WHERE project_id = $1 AND user_id = $2 AND route_id = $3`,
        [projectId, userId, routeId]
      );
      return this.mapRow(existing.rows[0]);
    }
    return this.mapRow(res.rows[0]);
  }

  async updatePreference(
    prefId: string,
    projectId: string,
    userId: string,
    dto: UpdateAlertPreferenceBody,
  ): Promise<ProjectMemberAlertPreference> {
    const fields: string[] = [];
    const values: any[] = [];
    let idx = 1;

    if (dto.is_subscribed !== undefined) {
      fields.push(`is_subscribed = $${idx++}`);
      values.push(dto.is_subscribed);
    }
    if (dto.min_severity !== undefined) {
      fields.push(`min_severity = $${idx++}`);
      values.push(dto.min_severity);
    }
    if (dto.quiet_hours_start !== undefined) {
      fields.push(`quiet_hours_start = $${idx++}`);
      values.push(dto.quiet_hours_start);
    }
    if (dto.quiet_hours_end !== undefined) {
      fields.push(`quiet_hours_end = $${idx++}`);
      values.push(dto.quiet_hours_end);
    }

    if (fields.length === 0) {
      const res = await pool.query(`SELECT ${PREF_COLUMNS} FROM project_member_alert_preferences WHERE id = $1`, [prefId]);
      return this.mapRow(res.rows[0]);
    }

    fields.push(`updated_at = NOW()`);
    values.push(prefId, projectId, userId);

    const res = await pool.query(
      `
      UPDATE project_member_alert_preferences
      SET ${fields.join(", ")}
      WHERE id = $${idx - 3} AND project_id = $${idx - 2} AND user_id = $${idx - 1}
      RETURNING ${PREF_COLUMNS}
      `,
      values
    );

    if (!res.rows.length) {
      throw new ProjectError("PREFERENCE_NOT_FOUND", "Preference not found", 404);
    }
    return this.mapRow(res.rows[0]);
  }

  async bulkSubscribe(projectId: string, routeId: string, userIds: string[], client: PoolClient = pool as unknown as PoolClient): Promise<void> {
    if (userIds.length === 0) return;
    
    // We update is_subscribed = true for the batch, inserting if they don't exist.
    const values = userIds.map((userId) => `('${projectId}', '${userId}', '${routeId}')`).join(", ");
    await client.query(`
      INSERT INTO project_member_alert_preferences (project_id, user_id, route_id, is_subscribed)
      VALUES ${values}
      ON CONFLICT (project_id, user_id, route_id) 
      DO UPDATE SET is_subscribed = true, updated_at = NOW()
    `);
  }

  async resolveRecipients(projectId: string, routeId: string, severity: string): Promise<string[]> {
    // The master prompt says:
    // Returns list of user_ids from project_members JOIN project_member_alert_preferences 
    // where is_subscribed = true AND min_severity <= $severity
    // postgres enums can be compared but we should use standard mapping or an array of active severities.
    
    // Let's rely on standard logic for enum comparison if possible, or build an array of severities that match.
    // Assuming ENUM is ordered, or we just map it.
    const severityOrder: Record<string, number> = {
      'info': 0, 'warning': 1, 'error': 2, 'critical': 3
    };
    const minSeverityValue = severityOrder[severity] ?? 0;
    const applicableSeverities = Object.keys(severityOrder).filter(k => (severityOrder[k] ?? 0) <= minSeverityValue);

    const res = await pool.query(
      `
      SELECT pmap.user_id 
      FROM project_member_alert_preferences pmap
      JOIN project_members pm ON pm.project_id = pmap.project_id AND pm.user_id = pmap.user_id
      WHERE pmap.project_id = $1 
        AND pmap.route_id = $2 
        AND pmap.is_subscribed = true
        AND pmap.min_severity = ANY($3::notification_severity[])
      `,
      [projectId, routeId, applicableSeverities]
    );

    return res.rows.map((row) => row.user_id);
  }
}
