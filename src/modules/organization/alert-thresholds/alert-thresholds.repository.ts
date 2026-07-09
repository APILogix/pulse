import { BaseRepository } from "../shared/base.repository.js";
import type { AlertThresholdRow } from "../types.js";

export class AlertThresholdsRepository extends BaseRepository {
  private static readonly ALERT_THRESHOLD_COLS = `id,org_id,project_id,
    p50_threshold_ms,p75_threshold_ms,p90_threshold_ms,p95_threshold_ms,p99_threshold_ms,
    p50_alert_enabled,p75_alert_enabled,p90_alert_enabled,p95_alert_enabled,p99_alert_enabled,
    error_rate_threshold_percent,error_rate_alert_enabled,apdex_threshold,apdex_alert_enabled,
    evaluation_window_minutes,cooldown_minutes,alerts_enabled,notify_emails,last_alerted_at,
    created_by,created_at,updated_at`;

  async getAlertThresholds(orgId: string, projectId: string | null): Promise<AlertThresholdRow | null> {
    const r = await this.db.query<AlertThresholdRow>(
      `SELECT ${AlertThresholdsRepository.ALERT_THRESHOLD_COLS}
       FROM organization_alert_thresholds
       WHERE org_id=$1 AND COALESCE(project_id,'00000000-0000-0000-0000-000000000000'::uuid)
                          = COALESCE($2::uuid,'00000000-0000-0000-0000-000000000000'::uuid)`,
      [orgId, projectId]
    );
    return r.rows[0] ?? null;
  }

  async listAlertThresholds(orgId: string): Promise<AlertThresholdRow[]> {
    const r = await this.db.query<AlertThresholdRow>(
      `SELECT ${AlertThresholdsRepository.ALERT_THRESHOLD_COLS}
       FROM organization_alert_thresholds WHERE org_id=$1
       ORDER BY (project_id IS NULL) DESC, created_at ASC`,
      [orgId]
    );
    return r.rows;
  }

  async upsertAlertThresholds(
    orgId: string,
    projectId: string | null,
    data: Record<string, unknown>,
    createdBy: string,
  ): Promise<AlertThresholdRow> {
    const v = (k: string) => (data[k] === undefined ? null : data[k]);
    const r = await this.db.query<AlertThresholdRow>(
      `INSERT INTO organization_alert_thresholds (
         org_id, project_id,
         p50_threshold_ms, p75_threshold_ms, p90_threshold_ms, p95_threshold_ms, p99_threshold_ms,
         p50_alert_enabled, p75_alert_enabled, p90_alert_enabled, p95_alert_enabled, p99_alert_enabled,
         error_rate_threshold_percent, error_rate_alert_enabled, apdex_threshold, apdex_alert_enabled,
         evaluation_window_minutes, cooldown_minutes, alerts_enabled, notify_emails, created_by
       ) VALUES (
         $1,$2,
         COALESCE($3,300),COALESCE($4,500),COALESCE($5,800),COALESCE($6,1000),COALESCE($7,2000),
         COALESCE($8,FALSE),COALESCE($9,FALSE),COALESCE($10,FALSE),COALESCE($11,TRUE),COALESCE($12,TRUE),
         COALESCE($13,5.00),COALESCE($14,TRUE),COALESCE($15,0.85),COALESCE($16,FALSE),
         COALESCE($17,5),COALESCE($18,30),COALESCE($19,TRUE),COALESCE($20,'{}'::text[]),$21
       )
       ON CONFLICT (org_id, COALESCE(project_id,'00000000-0000-0000-0000-000000000000'::uuid))
       DO UPDATE SET
         p50_threshold_ms = COALESCE($3, organization_alert_thresholds.p50_threshold_ms),
         p75_threshold_ms = COALESCE($4, organization_alert_thresholds.p75_threshold_ms),
         p90_threshold_ms = COALESCE($5, organization_alert_thresholds.p90_threshold_ms),
         p95_threshold_ms = COALESCE($6, organization_alert_thresholds.p95_threshold_ms),
         p99_threshold_ms = COALESCE($7, organization_alert_thresholds.p99_threshold_ms),
         p50_alert_enabled = COALESCE($8, organization_alert_thresholds.p50_alert_enabled),
         p75_alert_enabled = COALESCE($9, organization_alert_thresholds.p75_alert_enabled),
         p90_alert_enabled = COALESCE($10, organization_alert_thresholds.p90_alert_enabled),
         p95_alert_enabled = COALESCE($11, organization_alert_thresholds.p95_alert_enabled),
         p99_alert_enabled = COALESCE($12, organization_alert_thresholds.p99_alert_enabled),
         error_rate_threshold_percent = COALESCE($13, organization_alert_thresholds.error_rate_threshold_percent),
         error_rate_alert_enabled = COALESCE($14, organization_alert_thresholds.error_rate_alert_enabled),
         apdex_threshold = COALESCE($15, organization_alert_thresholds.apdex_threshold),
         apdex_alert_enabled = COALESCE($16, organization_alert_thresholds.apdex_alert_enabled),
         evaluation_window_minutes = COALESCE($17, organization_alert_thresholds.evaluation_window_minutes),
         cooldown_minutes = COALESCE($18, organization_alert_thresholds.cooldown_minutes),
         alerts_enabled = COALESCE($19, organization_alert_thresholds.alerts_enabled),
         notify_emails = COALESCE($20, organization_alert_thresholds.notify_emails)
       RETURNING ${AlertThresholdsRepository.ALERT_THRESHOLD_COLS}`,
      [
        orgId, projectId,
        v('p50ThresholdMs'), v('p75ThresholdMs'), v('p90ThresholdMs'), v('p95ThresholdMs'), v('p99ThresholdMs'),
        v('p50AlertEnabled'), v('p75AlertEnabled'), v('p90AlertEnabled'), v('p95AlertEnabled'), v('p99AlertEnabled'),
        v('errorRateThresholdPercent'), v('errorRateAlertEnabled'), v('apdexThreshold'), v('apdexAlertEnabled'),
        v('evaluationWindowMinutes'), v('cooldownMinutes'), v('alertsEnabled'),
        data['notifyEmails'] === undefined ? null : data['notifyEmails'], createdBy,
      ]
    );
    return r.rows[0]!;
  }

  async markAlertThresholdFired(id: string): Promise<void> {
    await this.db.query(
      `UPDATE organization_alert_thresholds SET last_alerted_at=NOW() WHERE id=$1`,
      [id]
    );
  }

  async getOrgFallbackEmail(orgId: string): Promise<string | null> {
    const r = await this.db.query<{ email: string | null }>(
      `SELECT COALESCE(o.billing_email, o.support_email, u.email) AS email
       FROM organizations o JOIN users u ON u.id=o.owner_user_id
       WHERE o.id=$1`,
      [orgId]
    );
    return r.rows[0]?.email ?? null;
  }
}
