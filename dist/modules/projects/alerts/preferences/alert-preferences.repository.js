import { pool } from "../../../../config/database.js";
import { ProjectError } from "../../shared/utils.js";
import { AlertCategorySchema } from "../subscriptions/connector-subscription.types.js";
const MEMBER_PREF_COLUMNS = `
  id, project_id, user_id, channel, category, enabled, severity_threshold,
  digest_mode, quiet_hours, created_at, updated_at
`;
const PROJECT_PREF_COLUMNS = `
  id, project_id, organization_id, category, enabled, severity_threshold,
  connector_ids, member_ids, quiet_hours, digest_mode, created_at, updated_at
`;
export class AlertPreferencesRepository {
    async withTransaction(callback) {
        const client = await pool.connect();
        try {
            await client.query("BEGIN");
            const result = await callback(client);
            await client.query("COMMIT");
            return result;
        }
        catch (err) {
            await client.query("ROLLBACK");
            throw err;
        }
        finally {
            client.release();
        }
    }
    mapMemberPreferenceRow(row) {
        return {
            id: row.id,
            projectId: row.project_id,
            userId: row.user_id,
            channel: row.channel,
            category: row.category,
            enabled: row.enabled,
            severityThreshold: row.severity_threshold,
            digestMode: row.digest_mode,
            quietHours: row.quiet_hours,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        };
    }
    mapProjectPreferenceRow(row) {
        return {
            id: row.id,
            projectId: row.project_id,
            organizationId: row.organization_id,
            category: row.category,
            enabled: row.enabled,
            severityThreshold: row.severity_threshold,
            connectorIds: row.connector_ids ?? [],
            memberIds: row.member_ids ?? [],
            quietHours: row.quiet_hours,
            digestMode: row.digest_mode,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        };
    }
    async getMemberPreferences(projectId, userId, client) {
        const db = client ?? pool;
        const res = await db.query(`SELECT ${MEMBER_PREF_COLUMNS}
         FROM project_member_notification_preferences
        WHERE project_id = $1 AND user_id = $2`, [projectId, userId]);
        return res.rows.map((row) => this.mapMemberPreferenceRow(row));
    }
    async getProjectDefaults(projectId, client) {
        const db = client ?? pool;
        const res = await db.query(`SELECT ${PROJECT_PREF_COLUMNS}
         FROM project_notification_preferences
        WHERE project_id = $1`, [projectId]);
        return res.rows.map((row) => this.mapProjectPreferenceRow(row));
    }
    async createMemberPreference(projectId, userId, channel, category, client) {
        const db = client ?? pool;
        const res = await db.query(`INSERT INTO project_member_notification_preferences (
         project_id, user_id, channel, category
       ) VALUES ($1, $2, $3, $4)
       ON CONFLICT (project_id, user_id, channel, category) DO NOTHING
       RETURNING ${MEMBER_PREF_COLUMNS}`, [projectId, userId, channel, category]);
        if (!res.rows.length) {
            const existing = await db.query(`SELECT ${MEMBER_PREF_COLUMNS}
           FROM project_member_notification_preferences
          WHERE project_id = $1 AND user_id = $2 AND channel = $3 AND category = $4`, [projectId, userId, channel, category]);
            return this.mapMemberPreferenceRow(existing.rows[0]);
        }
        return this.mapMemberPreferenceRow(res.rows[0]);
    }
    async updateMemberPreference(prefId, projectId, userId, dto, client) {
        const db = client ?? pool;
        const fields = [];
        const values = [];
        let idx = 1;
        if (dto.enabled !== undefined) {
            fields.push(`enabled = $${idx++}`);
            values.push(dto.enabled);
        }
        if (dto.severity_threshold !== undefined) {
            fields.push(`severity_threshold = $${idx++}`);
            values.push(dto.severity_threshold);
        }
        if (dto.digest_mode !== undefined) {
            fields.push(`digest_mode = $${idx++}`);
            values.push(dto.digest_mode);
        }
        if (dto.quiet_hours !== undefined) {
            fields.push(`quiet_hours = $${idx++}`);
            values.push(dto.quiet_hours);
        }
        if (fields.length === 0) {
            const res = await db.query(`SELECT ${MEMBER_PREF_COLUMNS}
           FROM project_member_notification_preferences
          WHERE id = $1`, [prefId]);
            return this.mapMemberPreferenceRow(res.rows[0]);
        }
        fields.push("updated_at = NOW()");
        values.push(prefId, projectId, userId);
        const res = await db.query(`UPDATE project_member_notification_preferences
          SET ${fields.join(", ")}
        WHERE id = $${idx - 2} AND project_id = $${idx - 1} AND user_id = $${idx}
        RETURNING ${MEMBER_PREF_COLUMNS}`, values);
        if (!res.rows.length) {
            throw new ProjectError("PREFERENCE_NOT_FOUND", "Preference not found", 404);
        }
        return this.mapMemberPreferenceRow(res.rows[0]);
    }
    async bulkSubscribe(projectId, channel, category, userIds, client) {
        if (userIds.length === 0)
            return;
        const db = client ?? pool;
        const placeholders = [];
        const values = [];
        let idx = 1;
        for (const userId of userIds) {
            placeholders.push(`($${idx++}, $${idx++}, $${idx++}, $${idx++}, TRUE)`);
            values.push(projectId, userId, channel, category);
        }
        await db.query(`INSERT INTO project_member_notification_preferences (
         project_id, user_id, channel, category, enabled
       ) VALUES ${placeholders.join(", ")}
       ON CONFLICT (project_id, user_id, channel, category)
       DO UPDATE SET enabled = true, updated_at = NOW()`, values);
    }
    async resolveRecipients(projectId, category, severity, client) {
        const db = client ?? pool;
        const severityOrder = {
            info: 0,
            warning: 1,
            error: 2,
            critical: 3,
        };
        const minSeverityValue = severityOrder[severity] ?? 0;
        const applicableSeverities = Object.keys(severityOrder).filter((k) => (severityOrder[k] ?? 0) <= minSeverityValue);
        const res = await db.query(`SELECT user_id
         FROM project_member_notification_preferences
        WHERE project_id = $1
          AND category = $2
          AND enabled = true
          AND severity_threshold = ANY($3::severity_threshold[])`, [projectId, category, applicableSeverities]);
        return res.rows.map((row) => row.user_id);
    }
    async seedMissingMemberPreferences(projectId, userId, client) {
        const db = client ?? pool;
        const categories = AlertCategorySchema.options;
        const channels = ["email", "slack", "webhook", "push", "sms"];
        const existing = await this.getMemberPreferences(projectId, userId, db);
        const existingKeys = new Set(existing.map((p) => `${p.channel}:${p.category}`));
        const missing = [];
        for (const channel of channels) {
            for (const category of categories) {
                if (!existingKeys.has(`${channel}:${category}`)) {
                    missing.push({ channel, category });
                }
            }
        }
        if (missing.length > 0) {
            await this.withTransaction(async (tx) => {
                for (const { channel, category } of missing) {
                    await this.createMemberPreference(projectId, userId, channel, category, tx);
                }
            });
        }
        return this.getMemberPreferences(projectId, userId, db);
    }
}
//# sourceMappingURL=alert-preferences.repository.js.map