import { pool } from "../../../config/database.js";
import { ProjectError } from "../shared/utils.js";
export class SettingsRepository {
    db;
    constructor(db = pool) {
        this.db = db;
    }
    async findByProjectId(projectId, client) {
        const db = client ?? this.db;
        const result = await db.query(`SELECT * FROM project_settings WHERE project_id = $1 LIMIT 1`, [projectId]);
        return result.rows[0] ? this.mapRow(result.rows[0]) : null;
    }
    async createDefault(projectId, organizationId, client) {
        const db = client ?? this.db;
        const result = await db.query(`INSERT INTO project_settings (
         project_id, organization_id, data_retention_days, sampling_rate, allowed_domains, blocked_domains,
         pii_scrubbing_enabled, ip_collection_enabled, release_tracking_enabled, session_replay_enabled,
         performance_monitoring_enabled, error_monitoring_enabled, log_ingestion_enabled, metric_ingestion_enabled,
         trace_ingestion_enabled, profile_ingestion_enabled, version
       )
       VALUES (
         $1, $2, 10, 1.00000, '{}'::text[], '{}'::text[],
         true, true, true, false,
         true, true, true, true,
         true, true, 1
       )
       ON CONFLICT (project_id) DO NOTHING
       RETURNING *`, [projectId, organizationId]);
        if (result.rows[0])
            return this.mapRow(result.rows[0]);
        const existing = await this.findByProjectId(projectId, client);
        if (existing)
            return existing;
        throw new Error("Failed to create project settings");
    }
    async update(projectId, updates, client) {
        const db = client ?? this.db;
        const assignments = [];
        const values = [];
        const set = (column, value) => {
            values.push(value);
            assignments.push(`${column} = $${values.length}`);
        };
        if (updates.dataRetentionDays !== undefined)
            set("data_retention_days", updates.dataRetentionDays);
        if (updates.samplingRate !== undefined)
            set("sampling_rate", updates.samplingRate);
        if (updates.allowedDomains !== undefined)
            set("allowed_domains", updates.allowedDomains);
        if (updates.blockedDomains !== undefined)
            set("blocked_domains", updates.blockedDomains);
        if (updates.piiScrubbingEnabled !== undefined)
            set("pii_scrubbing_enabled", updates.piiScrubbingEnabled);
        if (updates.ipCollectionEnabled !== undefined)
            set("ip_collection_enabled", updates.ipCollectionEnabled);
        if (updates.releaseTrackingEnabled !== undefined)
            set("release_tracking_enabled", updates.releaseTrackingEnabled);
        if (updates.sessionReplayEnabled !== undefined)
            set("session_replay_enabled", updates.sessionReplayEnabled);
        if (updates.performanceMonitoringEnabled !== undefined)
            set("performance_monitoring_enabled", updates.performanceMonitoringEnabled);
        if (updates.errorMonitoringEnabled !== undefined)
            set("error_monitoring_enabled", updates.errorMonitoringEnabled);
        if (updates.logIngestionEnabled !== undefined)
            set("log_ingestion_enabled", updates.logIngestionEnabled);
        if (updates.metricIngestionEnabled !== undefined)
            set("metric_ingestion_enabled", updates.metricIngestionEnabled);
        if (updates.traceIngestionEnabled !== undefined)
            set("trace_ingestion_enabled", updates.traceIngestionEnabled);
        if (updates.profileIngestionEnabled !== undefined)
            set("profile_ingestion_enabled", updates.profileIngestionEnabled);
        if (assignments.length === 0) {
            const existing = await this.findByProjectId(projectId, client);
            if (!existing)
                throw new ProjectError("SETTINGS_NOT_FOUND", "Settings not found", 404);
            return existing;
        }
        values.push(projectId);
        const projectIndex = values.length;
        let versionClause = "";
        if (updates.version !== undefined) {
            values.push(updates.version);
            versionClause = ` AND version = $${values.length}`;
        }
        const result = await db.query(`UPDATE project_settings
          SET ${assignments.join(", ")}, updated_at = NOW(), version = version + 1
        WHERE project_id = $${projectIndex}${versionClause}
        RETURNING *`, values);
        if (!result.rows[0]) {
            throw new ProjectError(updates.version === undefined ? "SETTINGS_NOT_FOUND" : "PROJECT_CONCURRENT_UPDATE", updates.version === undefined ? "Settings not found" : "Settings were modified concurrently", updates.version === undefined ? 404 : 409);
        }
        return this.mapRow(result.rows[0]);
    }
    mapRow(row) {
        return {
            id: row.id,
            projectId: row.project_id,
            organizationId: row.organization_id,
            dataRetentionDays: row.data_retention_days,
            samplingRate: Number(row.sampling_rate),
            allowedDomains: row.allowed_domains ?? [],
            blockedDomains: row.blocked_domains ?? [],
            piiScrubbingEnabled: row.pii_scrubbing_enabled,
            ipCollectionEnabled: row.ip_collection_enabled,
            releaseTrackingEnabled: row.release_tracking_enabled,
            sessionReplayEnabled: row.session_replay_enabled,
            performanceMonitoringEnabled: row.performance_monitoring_enabled,
            errorMonitoringEnabled: row.error_monitoring_enabled,
            logIngestionEnabled: row.log_ingestion_enabled,
            metricIngestionEnabled: row.metric_ingestion_enabled,
            traceIngestionEnabled: row.trace_ingestion_enabled,
            profileIngestionEnabled: row.profile_ingestion_enabled,
            version: row.version,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        };
    }
}
//# sourceMappingURL=settings.repository.js.map