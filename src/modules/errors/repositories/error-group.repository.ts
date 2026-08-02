import type { Pool, PoolClient } from 'pg';
import type { ErrorGroup, CreateErrorGroupParams, UpdateErrorGroupParams } from '../models/error-group.model.ts';

export class ErrorGroupRepository {
  constructor(private readonly pool: Pool) {}

  /**
   * Atomically upserts an error group based on (project_id, fingerprint).
   * It handles group creation and updating statistics on repeat occurrences,
   * as well as regression detection (moving RESOLVED back to REGRESSED).
   */
  async upsertGroup(
    client: PoolClient,
    params: CreateErrorGroupParams
  ): Promise<string> {
    const {
      projectId,
      fingerprint,
      eventId,
      severity,
      release,
      sdkVersion,
      applicationVersion,
    } = params;

    const query = `
      INSERT INTO error_groups (
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
        latest_application_version
      )
      VALUES (
        $1, $2, 'OPEN', 1, NOW(), NOW(), $3, $3, $4, $4, FALSE, 0, NULL, $5, $6, $7
      )
      ON CONFLICT (project_id, fingerprint) DO UPDATE SET
        occurrence_count = error_groups.occurrence_count + 1,
        last_seen_at = NOW(),
        latest_event_id = EXCLUDED.latest_event_id,
        latest_severity = EXCLUDED.latest_severity,
        latest_release = COALESCE(EXCLUDED.latest_release, error_groups.latest_release),
        latest_sdk_version = COALESCE(EXCLUDED.latest_sdk_version, error_groups.latest_sdk_version),
        latest_application_version = COALESCE(EXCLUDED.latest_application_version, error_groups.latest_application_version),
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
      RETURNING id
    `;

    const result = await client.query(query, [
      projectId,
      fingerprint,
      eventId,
      severity,
      release || null,
      sdkVersion || null,
      applicationVersion || null,
    ]);

    return result.rows[0].id;
  }

  async findByFingerprint(projectId: string, fingerprint: string): Promise<ErrorGroup | null> {
    const result = await this.pool.query(
      `SELECT * FROM error_groups WHERE project_id = $1 AND fingerprint = $2`,
      [projectId, fingerprint]
    );

    if (result.rows.length === 0) return null;
    return this.mapToDomain(result.rows[0]);
  }

  async resolve(projectId: string, id: string): Promise<void> {
    await this.pool.query(
      `UPDATE error_groups SET status = 'RESOLVED', updated_at = NOW() WHERE project_id = $1 AND id = $2`,
      [projectId, id]
    );
  }

  async ignore(projectId: string, id: string): Promise<void> {
    await this.pool.query(
      `UPDATE error_groups SET status = 'IGNORED', updated_at = NOW() WHERE project_id = $1 AND id = $2`,
      [projectId, id]
    );
  }

  async assign(projectId: string, id: string, userId: string): Promise<void> {
    // Note: To be fully aligned with future phases (e.g. Issue Assignment)
    // We would alter error_groups to include assigned_to field or separate table.
  }

  private mapToDomain(row: any): ErrorGroup {
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
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
