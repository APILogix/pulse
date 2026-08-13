import { pool } from "../../../../config/database.js";
import { ProjectError } from "../../shared/utils.js";
import { isAnyQuietHoursActive } from "./quiet-hours.js";
const CHANNEL_COLUMNS = `
  id, organization_id, project_id, connector_id, channel_type, name,
  description, destination, destination_metadata, is_default, enabled,
  created_by, updated_by, created_at, updated_at, deleted_at, version
`;
export class AlertChannelRepository {
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
    async countByOrganization(organizationId, client) {
        const db = client ?? this.db;
        const res = await db.query(`SELECT COUNT(*)::text AS count FROM project_alert_channels WHERE organization_id = $1`, [organizationId]);
        return Number.parseInt(res.rows[0]?.count ?? "0", 10);
    }
    async list(organizationId, projectId, query, client) {
        const db = client ?? this.db;
        const values = [organizationId, projectId];
        const where = ["organization_id = $1", "project_id = $2", "deleted_at IS NULL"];
        if (query.channelType !== undefined) {
            values.push(query.channelType);
            where.push(`channel_type = $${values.length}`);
        }
        if (query.enabled !== undefined) {
            values.push(query.enabled);
            where.push(`enabled = $${values.length}`);
        }
        const count = await db.query(`SELECT COUNT(*)::text AS count FROM project_alert_channels WHERE ${where.join(" AND ")}`, values);
        const sortColumn = query.sortBy === "name" ? "name" : query.sortBy === "updated_at" ? "updated_at" : "created_at";
        const sortOrder = query.sortOrder === "asc" ? "ASC" : "DESC";
        const offset = query.offset ?? (query.page - 1) * query.limit;
        values.push(query.limit, offset);
        const result = await db.query(`SELECT ${CHANNEL_COLUMNS}
         FROM project_alert_channels
        WHERE ${where.join(" AND ")}
        ORDER BY ${sortColumn} ${sortOrder}, id ASC
        LIMIT $${values.length - 1} OFFSET $${values.length}`, values);
        return {
            channels: result.rows.map((row) => this.mapChannel(row)),
            total: Number.parseInt(count.rows[0]?.count ?? "0", 10),
        };
    }
    async findById(organizationId, projectId, channelId, client, forUpdate = false) {
        const db = client ?? this.db;
        const result = await db.query(`SELECT ${CHANNEL_COLUMNS}
         FROM project_alert_channels
        WHERE id = $1 AND organization_id = $2 AND project_id = $3 AND deleted_at IS NULL
        LIMIT 1${forUpdate ? " FOR UPDATE" : ""}`, [channelId, organizationId, projectId]);
        return result.rows[0] ? this.mapChannel(result.rows[0]) : null;
    }
    async requireActiveConnector(organizationId, connectorId, client) {
        const db = client ?? this.db;
        const result = await db.query(`SELECT id, provider
         FROM connector_configs
        WHERE id = $1 AND organization_id = $2
          AND status = 'active' AND deleted_at IS NULL
        LIMIT 1
        FOR SHARE`, [connectorId, organizationId]);
        const connector = result.rows[0];
        if (!connector) {
            throw new ProjectError("ALERT_CHANNEL_CONNECTOR_INVALID", "Connector must be active and belong to the organization", 422);
        }
        return connector;
    }
    async lockDefaultGroups(projectId, _channelTypes, client) {
        // A project-scoped transaction lock serializes all channel-type default
        // changes. It is intentionally broader than a type lock so moving a
        // channel between types cannot deadlock with another concurrent move.
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`project-alert-channels:${projectId}`]);
    }
    async hasEnabledDefault(projectId, channelType, client) {
        const result = await client.query(`SELECT 1 FROM project_alert_channels
        WHERE project_id = $1 AND channel_type = $2
          AND is_default = TRUE AND enabled = TRUE AND deleted_at IS NULL
        LIMIT 1`, [projectId, channelType]);
        return result.rows.length > 0;
    }
    async unsetEnabledDefaults(projectId, channelType, exceptChannelId, updatedBy, client) {
        await client.query(`UPDATE project_alert_channels
          SET is_default = FALSE, updated_by = $4, updated_at = NOW(), version = version + 1
        WHERE project_id = $1 AND channel_type = $2
          AND ($3::uuid IS NULL OR id <> $3::uuid)
          AND is_default = TRUE AND enabled = TRUE AND deleted_at IS NULL`, [projectId, channelType, exceptChannelId, updatedBy]);
    }
    async create(organizationId, projectId, userId, body, isDefault, client) {
        const result = await client.query(`INSERT INTO project_alert_channels (
         organization_id, project_id, connector_id, channel_type, name,
         description, destination, destination_metadata, is_default, enabled,
         created_by, updated_by
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)
       RETURNING ${CHANNEL_COLUMNS}`, [
            organizationId,
            projectId,
            body.connectorId ?? null,
            body.channelType,
            body.name,
            body.description ?? null,
            body.destination ?? null,
            body.destinationMetadata,
            isDefault,
            body.enabled,
            userId,
        ]);
        return this.mapChannel(result.rows[0]);
    }
    async update(organizationId, projectId, channelId, userId, body, isDefault, client) {
        const assignments = [];
        const values = [];
        const set = (column, value) => {
            values.push(value);
            assignments.push(`${column} = $${values.length}`);
        };
        if (body.connectorId !== undefined)
            set("connector_id", body.connectorId);
        if (body.channelType !== undefined)
            set("channel_type", body.channelType);
        if (body.name !== undefined)
            set("name", body.name);
        if (body.description !== undefined)
            set("description", body.description);
        if (body.destination !== undefined)
            set("destination", body.destination);
        if (body.destinationMetadata !== undefined)
            set("destination_metadata", body.destinationMetadata);
        if (body.enabled !== undefined)
            set("enabled", body.enabled);
        set("is_default", isDefault);
        set("updated_by", userId);
        assignments.push("updated_at = NOW()", "version = version + 1");
        values.push(channelId, organizationId, projectId);
        const idIndex = values.length - 2;
        const orgIndex = values.length - 1;
        const projectIndex = values.length;
        let versionClause = "";
        if (body.version !== undefined) {
            values.push(body.version);
            versionClause = ` AND version = $${values.length}`;
        }
        const result = await client.query(`UPDATE project_alert_channels
          SET ${assignments.join(", ")}
        WHERE id = $${idIndex} AND organization_id = $${orgIndex}
          AND project_id = $${projectIndex} AND deleted_at IS NULL${versionClause}
        RETURNING ${CHANNEL_COLUMNS}`, values);
        if (!result.rows[0]) {
            throw new ProjectError(body.version === undefined ? "ALERT_CHANNEL_NOT_FOUND" : "ALERT_CHANNEL_CONCURRENT_UPDATE", body.version === undefined ? "Alert channel not found" : "Alert channel was modified concurrently", body.version === undefined ? 404 : 409);
        }
        return this.mapChannel(result.rows[0]);
    }
    async ensureEnabledDefault(organizationId, projectId, channelType, updatedBy, client) {
        await client.query(`UPDATE project_alert_channels candidate
          SET is_default = TRUE, updated_by = $4, updated_at = NOW(), version = version + 1
        WHERE candidate.id = (
          SELECT id FROM project_alert_channels
           WHERE organization_id = $1 AND project_id = $2 AND channel_type = $3
             AND enabled = TRUE AND deleted_at IS NULL
           ORDER BY created_at ASC, id ASC
           LIMIT 1
        )
          AND NOT EXISTS (
            SELECT 1 FROM project_alert_channels current_default
             WHERE current_default.organization_id = $1
               AND current_default.project_id = $2
               AND current_default.channel_type = $3
               AND current_default.is_default = TRUE
               AND current_default.enabled = TRUE
               AND current_default.deleted_at IS NULL
          )`, [organizationId, projectId, channelType, updatedBy]);
    }
    async softDelete(organizationId, projectId, channelId, userId, client) {
        const result = await client.query(`UPDATE project_alert_channels
          SET deleted_at = NOW(), enabled = FALSE, is_default = FALSE,
              updated_by = $4, updated_at = NOW(), version = version + 1
        WHERE id = $1 AND organization_id = $2 AND project_id = $3 AND deleted_at IS NULL`, [channelId, organizationId, projectId, userId]);
        if (result.rowCount === 0) {
            throw new ProjectError("ALERT_CHANNEL_NOT_FOUND", "Alert channel not found", 404);
        }
    }
    async listMemberPreferences(organizationId, projectId, userId, client) {
        const db = client ?? this.db;
        const result = await db.query(`SELECT
         pref.id AS pref_id, pref.organization_id AS pref_organization_id,
         pref.project_id AS pref_project_id, pref.user_id AS pref_user_id,
         pref.project_alert_channel_id AS pref_channel_id, pref.category AS pref_category,
         pref.severity_threshold AS pref_severity_threshold, pref.enabled AS pref_enabled,
         pref.digest_mode AS pref_digest_mode, pref.quiet_hours AS pref_quiet_hours,
         pref.created_at AS pref_created_at, pref.updated_at AS pref_updated_at,
         pref.deleted_at AS pref_deleted_at, pref.version AS pref_version,
         channel.id AS channel_id, channel.organization_id AS channel_organization_id,
         channel.project_id AS channel_project_id, channel.connector_id AS channel_connector_id,
         channel.channel_type, channel.name, channel.description, channel.destination,
         channel.destination_metadata, channel.is_default, channel.enabled AS channel_enabled,
         channel.created_by, channel.updated_by, channel.created_at AS channel_created_at,
         channel.updated_at AS channel_updated_at, channel.deleted_at AS channel_deleted_at,
         channel.version AS channel_version
       FROM project_member_alert_channel_preferences pref
       JOIN project_alert_channels channel
         ON channel.id = pref.project_alert_channel_id
        AND channel.organization_id = pref.organization_id
        AND channel.project_id = pref.project_id
        AND channel.deleted_at IS NULL
      WHERE pref.organization_id = $1 AND pref.project_id = $2 AND pref.user_id = $3
        AND pref.deleted_at IS NULL
      ORDER BY channel.channel_type, channel.name, pref.category`, [organizationId, projectId, userId]);
        return result.rows.map((row) => this.mapPreference(row, true));
    }
    async upsertMemberPreference(organizationId, projectId, userId, channelId, body, client) {
        const db = client ?? this.db;
        const result = await db.query(`INSERT INTO project_member_alert_channel_preferences (
         organization_id, project_id, user_id, project_alert_channel_id,
         category, severity_threshold, enabled, digest_mode, quiet_hours
       )
       SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9
         FROM project_members member
         JOIN project_alert_channels channel
           ON channel.id = $4 AND channel.organization_id = $1
          AND channel.project_id = $2 AND channel.deleted_at IS NULL
        WHERE member.organization_id = $1 AND member.project_id = $2
          AND member.user_id = $3 AND member.status = 'active'
       ON CONFLICT (project_id, user_id, project_alert_channel_id, category)
       WHERE deleted_at IS NULL
       DO UPDATE SET
         severity_threshold = EXCLUDED.severity_threshold,
         enabled = EXCLUDED.enabled,
         digest_mode = EXCLUDED.digest_mode,
         quiet_hours = EXCLUDED.quiet_hours,
         updated_at = NOW(),
         version = project_member_alert_channel_preferences.version + 1
       RETURNING id AS pref_id, organization_id AS pref_organization_id,
         project_id AS pref_project_id, user_id AS pref_user_id,
         project_alert_channel_id AS pref_channel_id, category AS pref_category,
         severity_threshold AS pref_severity_threshold, enabled AS pref_enabled,
         digest_mode AS pref_digest_mode, quiet_hours AS pref_quiet_hours,
         created_at AS pref_created_at, updated_at AS pref_updated_at,
         deleted_at AS pref_deleted_at, version AS pref_version`, [
            organizationId,
            projectId,
            userId,
            channelId,
            body.category,
            body.severityThreshold,
            body.enabled,
            body.digestMode,
            body.quietHours,
        ]);
        if (!result.rows[0]) {
            throw new ProjectError("ALERT_CHANNEL_PREFERENCE_FORBIDDEN", "An active project membership and valid alert channel are required", 403);
        }
        return this.mapPreference(result.rows[0], false);
    }
    async softDeleteMemberPreference(organizationId, projectId, userId, channelId, category, client) {
        const db = client ?? this.db;
        const result = await db.query(`UPDATE project_member_alert_channel_preferences
          SET deleted_at = NOW(), enabled = FALSE, updated_at = NOW(), version = version + 1
        WHERE organization_id = $1 AND project_id = $2 AND user_id = $3
          AND project_alert_channel_id = $4 AND category = $5 AND deleted_at IS NULL`, [organizationId, projectId, userId, channelId, category]);
        if (result.rowCount === 0) {
            throw new ProjectError("ALERT_CHANNEL_PREFERENCE_NOT_FOUND", "Alert channel preference not found", 404);
        }
    }
    async resolveNoChannelEmailTargets(request, client) {
        const db = client ?? this.db;
        const result = await db.query(`SELECT DISTINCT ON (LOWER(BTRIM(users.email)))
         member.user_id, LOWER(BTRIM(users.email)) AS email
       FROM project_members member
       JOIN users ON users.id = member.user_id
       JOIN project_notification_preferences project_pref
         ON project_pref.organization_id = member.organization_id
        AND project_pref.project_id = member.project_id
        AND project_pref.category IN ('all', $3)
        AND project_pref.enabled = TRUE
        AND project_pref.deleted_at IS NULL
       WHERE member.organization_id = $1
         AND member.project_id = $2
         AND member.status = 'active'
         AND users.status = 'active'
         AND users.email_verified = TRUE
         AND NULLIF(BTRIM(users.email), '') IS NOT NULL
         AND project_pref.digest_mode = 'immediate'
         AND CASE $4 WHEN 'info' THEN 1 WHEN 'warning' THEN 2 WHEN 'error' THEN 3
                     WHEN 'critical' THEN 4 ELSE 0 END
             >= CASE project_pref.severity_threshold
                  WHEN 'info' THEN 1 WHEN 'warning' THEN 2 WHEN 'error' THEN 3
                  WHEN 'critical' THEN 4 ELSE 5 END
         AND ((cardinality(project_pref.default_member_ids) = 0
               AND cardinality(project_pref.role_targets) = 0)
              OR member.user_id = ANY(project_pref.default_member_ids)
              OR member.role = ANY(project_pref.role_targets))
         AND NOT EXISTS (
           SELECT 1
             FROM project_member_alert_channel_preferences disabled_pref
            WHERE disabled_pref.organization_id = member.organization_id
              AND disabled_pref.project_id = member.project_id
              AND disabled_pref.user_id = member.user_id
              AND disabled_pref.category IN ('all', $3)
              AND disabled_pref.enabled = FALSE
              AND disabled_pref.deleted_at IS NULL
         )
         AND NOT EXISTS (
           SELECT 1
             FROM user_notification_preferences user_pref
            WHERE user_pref.organization_id = member.organization_id
              AND user_pref.user_id = member.user_id
              AND user_pref.channel_kind = 'email'
              AND (user_pref.enabled = FALSE
                OR (user_pref.temporary_mute_until IS NOT NULL AND user_pref.temporary_mute_until > NOW())
                OR (user_pref.vacation_until IS NOT NULL AND user_pref.vacation_until > NOW()))
         )
       ORDER BY LOWER(BTRIM(users.email)), member.user_id`, [request.organizationId, request.projectId, request.category, request.severity]);
        return result.rows.map((row) => ({ userId: row.user_id, email: row.email }));
    }
    async resolveImmediateDeliveryTargets(request, client) {
        const db = client ?? this.db;
        const result = await db.query(`SELECT DISTINCT ON (member.user_id, channel.id, subscription.id)
         member.organization_id, member.project_id, member.user_id,
         member.role AS member_role, users.email AS member_email,
         channel.id AS channel_id, channel.channel_type,
         channel.destination AS channel_destination,
         CASE WHEN channel.channel_type = 'email'
              THEN COALESCE(channel.destination, users.email)
              ELSE channel.destination END AS member_destination,
         channel.destination_metadata AS channel_metadata,
         channel.connector_id AS channel_connector_id,
         subscription.id AS subscription_id,
         subscription.connector_id AS subscription_connector_id,
         connector.provider AS connector_provider,
         project_pref.digest_mode AS project_digest_mode,
         member_pref.digest_mode AS member_digest_mode,
         subscription.digest_mode AS subscription_digest_mode,
         project_pref.quiet_hours AS project_quiet_hours,
         member_pref.quiet_hours AS member_quiet_hours,
         subscription.quiet_hours AS subscription_quiet_hours,
         (COALESCE(project_pref.quiet_hours, '{}'::jsonb) <> '{}'::jsonb
           OR COALESCE(member_pref.quiet_hours, '{}'::jsonb) <> '{}'::jsonb
           OR COALESCE(subscription.quiet_hours, '{}'::jsonb) <> '{}'::jsonb) AS quiet_hours_configured
       FROM project_members member
       JOIN users ON users.id = member.user_id
       JOIN project_notification_preferences project_pref
         ON project_pref.organization_id = member.organization_id
        AND project_pref.project_id = member.project_id
        AND project_pref.category IN ('all', $3)
        AND project_pref.enabled = TRUE AND project_pref.deleted_at IS NULL
       JOIN project_member_alert_channel_preferences member_pref
         ON member_pref.organization_id = member.organization_id
        AND member_pref.project_id = member.project_id
        AND member_pref.user_id = member.user_id
        AND member_pref.category IN ('all', $3)
        AND member_pref.enabled = TRUE AND member_pref.deleted_at IS NULL
       JOIN project_alert_channels channel
         ON channel.id = member_pref.project_alert_channel_id
        AND channel.organization_id = member.organization_id
        AND channel.project_id = member.project_id
        AND channel.enabled = TRUE AND channel.deleted_at IS NULL
       LEFT JOIN project_connector_subscriptions subscription
         ON subscription.organization_id = member.organization_id
        AND subscription.project_id = member.project_id
        AND subscription.connector_id = channel.connector_id
        AND channel.connector_id IS NOT NULL
        AND subscription.enabled = TRUE AND subscription.deleted_at IS NULL
       LEFT JOIN connector_configs connector
         ON connector.id = channel.connector_id
        AND connector.organization_id = member.organization_id
        AND connector.status = 'active' AND connector.deleted_at IS NULL
      WHERE member.organization_id = $1 AND member.project_id = $2
        AND member.status = 'active'
        AND (
          (channel.connector_id IS NULL
           AND channel.channel_type = 'email'
           AND NULLIF(BTRIM(COALESCE(channel.destination, users.email)), '') IS NOT NULL)
          OR
          (channel.connector_id IS NOT NULL AND subscription.id IS NOT NULL AND connector.id IS NOT NULL)
        )
        AND (cardinality(project_pref.default_channel_ids) = 0
             OR channel.id = ANY(project_pref.default_channel_ids))
        AND ((cardinality(project_pref.default_member_ids) = 0
              AND cardinality(project_pref.role_targets) = 0)
             OR member.user_id = ANY(project_pref.default_member_ids)
             OR member.role = ANY(project_pref.role_targets))
        AND CASE $4 WHEN 'info' THEN 1 WHEN 'warning' THEN 2 WHEN 'error' THEN 3
                    WHEN 'critical' THEN 4 ELSE 0 END
            >= CASE project_pref.severity_threshold
                 WHEN 'info' THEN 1 WHEN 'warning' THEN 2 WHEN 'error' THEN 3
                 WHEN 'critical' THEN 4 ELSE 5 END
        AND CASE $4 WHEN 'info' THEN 1 WHEN 'warning' THEN 2 WHEN 'error' THEN 3
                    WHEN 'critical' THEN 4 ELSE 0 END
            >= CASE member_pref.severity_threshold
                 WHEN 'info' THEN 1 WHEN 'warning' THEN 2 WHEN 'error' THEN 3
                 WHEN 'critical' THEN 4 ELSE 5 END
        AND project_pref.digest_mode = 'immediate'
        AND member_pref.digest_mode = 'immediate'
        AND (
          channel.connector_id IS NULL
          OR (
            (cardinality(subscription.member_ids) = 0 OR member.user_id = ANY(subscription.member_ids))
            AND (cardinality(subscription.alert_categories) = 0
                 OR 'all' = ANY(subscription.alert_categories)
                 OR $3 = ANY(subscription.alert_categories))
            AND CASE $4 WHEN 'info' THEN 1 WHEN 'warning' THEN 2 WHEN 'error' THEN 3
                        WHEN 'critical' THEN 4 ELSE 0 END
                >= CASE subscription.severity_threshold
                     WHEN 'info' THEN 1 WHEN 'warning' THEN 2 WHEN 'error' THEN 3
                     WHEN 'critical' THEN 4 ELSE 5 END
            AND subscription.digest_mode = 'immediate'
          )
        )
      ORDER BY member.user_id, channel.id, subscription.id,
               (project_pref.category = $3) DESC, (member_pref.category = $3) DESC`, [request.organizationId, request.projectId, request.category, request.severity]);
        const targets = result.rows.map((row) => ({
            organizationId: row.organization_id,
            projectId: row.project_id,
            userId: row.user_id,
            memberRole: row.member_role,
            memberEmail: row.member_email,
            channelId: row.channel_id,
            channelType: row.channel_type,
            channelDestination: row.channel_destination,
            memberDestination: row.member_destination,
            channelMetadata: row.channel_metadata ?? {},
            channelConnectorId: row.channel_connector_id,
            subscriptionId: row.subscription_id,
            subscriptionConnectorId: row.subscription_connector_id,
            connectorProvider: row.connector_provider,
            category: request.category,
            severity: request.severity,
            digest: {
                project: row.project_digest_mode,
                member: row.member_digest_mode,
                subscription: row.subscription_digest_mode ?? "immediate",
            },
            quietHours: {
                project: row.project_quiet_hours ?? {},
                member: row.member_quiet_hours ?? {},
                subscription: row.subscription_quiet_hours ?? {},
                configured: row.quiet_hours_configured,
            },
            immediateEligible: true,
        }));
        return targets.filter((target) => !isAnyQuietHoursActive([
            target.quietHours.project,
            target.quietHours.member,
            target.quietHours.subscription,
        ]));
    }
    mapChannel(row) {
        return {
            id: row.id,
            organizationId: row.organization_id,
            projectId: row.project_id,
            connectorId: row.connector_id,
            channelType: row.channel_type,
            name: row.name,
            description: row.description,
            destination: row.destination,
            destinationMetadata: row.destination_metadata ?? {},
            isDefault: row.is_default,
            enabled: row.enabled,
            createdBy: row.created_by,
            updatedBy: row.updated_by,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            deletedAt: row.deleted_at,
            version: row.version,
        };
    }
    mapPreference(row, includeChannel) {
        const preference = {
            id: row.pref_id,
            organizationId: row.pref_organization_id,
            projectId: row.pref_project_id,
            userId: row.pref_user_id,
            projectAlertChannelId: row.pref_channel_id,
            category: row.pref_category,
            severityThreshold: row.pref_severity_threshold,
            enabled: row.pref_enabled,
            digestMode: row.pref_digest_mode,
            quietHours: row.pref_quiet_hours ?? {},
            createdAt: row.pref_created_at,
            updatedAt: row.pref_updated_at,
            deletedAt: row.pref_deleted_at,
            version: row.pref_version,
        };
        if (includeChannel) {
            preference.channel = this.mapChannel({
                id: row.channel_id,
                organization_id: row.channel_organization_id,
                project_id: row.channel_project_id,
                connector_id: row.channel_connector_id,
                channel_type: row.channel_type,
                name: row.name,
                description: row.description,
                destination: row.destination,
                destination_metadata: row.destination_metadata,
                is_default: row.is_default,
                enabled: row.channel_enabled,
                created_by: row.created_by,
                updated_by: row.updated_by,
                created_at: row.channel_created_at,
                updated_at: row.channel_updated_at,
                deleted_at: row.channel_deleted_at,
                version: row.channel_version,
            });
        }
        return preference;
    }
}
//# sourceMappingURL=channel.repository.js.map