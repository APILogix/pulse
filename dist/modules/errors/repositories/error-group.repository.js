export class ErrorGroupRepository {
    pool;
    constructor(pool) {
        this.pool = pool;
    }
    /**
     * Atomically upserts an error group based on (project_id, fingerprint).
     * It handles group creation and updating statistics on repeat occurrences,
     * as well as regression detection (moving RESOLVED back to REGRESSED).
     */
    async upsertGroup(client, params) {
        const { organizationId, projectId, fingerprint, eventId, severity, release, sdkVersion, applicationVersion, message, errorName, statusCode, traceId, requestId } = params;
        const query = `
      INSERT INTO error_groups (
        organization_id,
        project_id,
        fingerprint,
        status,
        occurrence_count,
        first_seen_at,
        last_seen_at,
        first_event_id,
        latest_event_id,
        highest_severity,
        latest_severity,
        is_regression,
        regression_count,
        last_regressed_at,
        latest_release,
        latest_sdk_version,
        latest_application_version,
        last_error_message,
        last_error_name,
        last_status_code,
        last_trace_id,
        last_request_id,
        version
      )
      VALUES (
        $1, $2, $3, 'OPEN', 1, NOW(), NOW(), $4, $4, $5, $5, FALSE, 0, NULL, $6, $7, $8, $9, $10, $11, $12, $13, 1
      )
      ON CONFLICT (project_id, fingerprint) DO UPDATE SET
        organization_id = COALESCE(error_groups.organization_id, EXCLUDED.organization_id),
        occurrence_count = error_groups.occurrence_count + 1,
        last_seen_at = NOW(),
        latest_event_id = EXCLUDED.latest_event_id,
        latest_severity = EXCLUDED.latest_severity,
        latest_release = COALESCE(EXCLUDED.latest_release, error_groups.latest_release),
        latest_sdk_version = COALESCE(EXCLUDED.latest_sdk_version, error_groups.latest_sdk_version),
        latest_application_version = COALESCE(EXCLUDED.latest_application_version, error_groups.latest_application_version),
        last_error_message = COALESCE(EXCLUDED.last_error_message, error_groups.last_error_message),
        last_error_name = COALESCE(EXCLUDED.last_error_name, error_groups.last_error_name),
        last_status_code = COALESCE(EXCLUDED.last_status_code, error_groups.last_status_code),
        last_trace_id = COALESCE(EXCLUDED.last_trace_id, error_groups.last_trace_id),
        last_request_id = COALESCE(EXCLUDED.last_request_id, error_groups.last_request_id),
        version = error_groups.version + 1,
        updated_at = NOW(),
        
        -- Handle Regressions
        status = CASE 
          WHEN error_groups.status = 'RESOLVED' THEN 'REGRESSED'
          ELSE error_groups.status 
        END,
        is_regression = CASE 
          WHEN error_groups.status = 'RESOLVED' THEN TRUE
          ELSE error_groups.is_regression 
        END,
        regression_count = CASE 
          WHEN error_groups.status = 'RESOLVED' THEN error_groups.regression_count + 1
          ELSE error_groups.regression_count 
        END,
        last_regressed_at = CASE 
          WHEN error_groups.status = 'RESOLVED' THEN NOW()
          ELSE error_groups.last_regressed_at 
        END
      RETURNING id, (xmax = 0) AS is_new, status, is_regression
    `;
        const result = await client.query(query, [
            organizationId || null,
            projectId,
            fingerprint,
            eventId,
            severity,
            release || null,
            sdkVersion || null,
            applicationVersion || null,
            message || null,
            errorName || null,
            statusCode || null,
            traceId || null,
            requestId || null,
        ]);
        const row = result.rows[0];
        return {
            id: row.id,
            isNew: row.is_new,
            status: row.status,
            isRegression: row.is_regression
        };
    }
    async findByFingerprint(projectId, fingerprint) {
        const result = await this.pool.query(`SELECT * FROM error_groups WHERE project_id = $1 AND fingerprint = $2`, [projectId, fingerprint]);
        if (result.rows.length === 0)
            return null;
        return this.mapToDomain(result.rows[0]);
    }
    async resolve(client, projectId, id) {
        await client.query(`UPDATE error_groups SET status = 'RESOLVED', version = version + 1, updated_at = NOW() WHERE project_id = $1 AND id = $2`, [projectId, id]);
    }
    async ignore(client, projectId, id) {
        await client.query(`UPDATE error_groups SET status = 'IGNORED', version = version + 1, updated_at = NOW() WHERE project_id = $1 AND id = $2`, [projectId, id]);
    }
    async reopen(client, projectId, id) {
        await client.query(`UPDATE error_groups SET status = 'OPEN', version = version + 1, updated_at = NOW() WHERE project_id = $1 AND id = $2`, [projectId, id]);
    }
    async archive(client, projectId, id) {
        await client.query(`UPDATE error_groups SET status = 'ARCHIVED', version = version + 1, updated_at = NOW() WHERE project_id = $1 AND id = $2`, [projectId, id]);
    }
    async assign(client, projectId, id, userId) {
        // Phase 14 future compatibility placeholder
    }
    mapToDomain(row) {
        return {
            id: row.id,
            projectId: row.project_id,
            fingerprint: row.fingerprint,
            status: row.status,
            occurrenceCount: Number(row.occurrence_count),
            firstSeenAt: row.first_seen_at,
            lastSeenAt: row.last_seen_at,
            firstEventId: row.first_event_id,
            latestEventId: row.latest_event_id,
            highestSeverity: row.highest_severity,
            latestSeverity: row.latest_severity,
            isRegression: row.is_regression,
            regressionCount: Number(row.regression_count),
            lastRegressedAt: row.last_regressed_at,
            latestRelease: row.latest_release,
            latestSdkVersion: row.latest_sdk_version,
            latestApplicationVersion: row.latest_application_version,
            lastErrorMessage: row.last_error_message,
            lastErrorName: row.last_error_name,
            lastStatusCode: row.last_status_code,
            lastTraceId: row.last_trace_id,
            lastRequestId: row.last_request_id,
            mergedInto: row.merged_into,
            isMerged: row.is_merged,
            version: row.version,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        };
    }
}
//# sourceMappingURL=error-group.repository.js.map