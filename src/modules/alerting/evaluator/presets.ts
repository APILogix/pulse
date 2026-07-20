/**
 * Default alert-rule presets (platform-managed templates).
 *
 * Each preset seeds ONE org-level alert rule (project_id NULL) with a single
 * condition and a single `notify` action. Presets are org-customizable: the
 * org can edit thresholds, disable, or soft-delete the rule — `preset_key`
 * keeps track of which template it came from, and the partial unique index
 * `uq_alert_rules_preset_scope` makes seeding idempotent
 * (INSERT ... ON CONFLICT DO NOTHING).
 *
 * Delivery shape: the seeded notify action has NO connectorId/routeId. In the
 * current delivery pipeline (batch-processor.isDeliverAction) such an action
 * is intentionally not connector-deliverable — the fired alert event itself
 * (status 'firing', visible in-app to org members) IS the default "in-app
 * route", and the org attaches real connectors later via routing rules or by
 * editing the action. This matches the platform default of "notify org
 * members in-app" without requiring a connector that may not exist yet.
 *
 * Condition fieldPaths are evaluated by evaluator/rule-evaluator.ts against
 * the observability event tables; see that file for the exact SQL per kind.
 */
import type { Pool } from 'pg';
import type { AlertSeverity, ConditionOperator } from '../rules/rules.types.js';

export interface DefaultAlertPreset {
  presetKey: string;
  name: string;
  description: string;
  severity: AlertSeverity;
  cooldownSeconds: number;
  evaluationIntervalSeconds: number;
  deduplicationWindowSeconds: number;
  autoResolveAfterMinutes: number | null;
  condition: {
    fieldPath: string;
    operator: ConditionOperator;
    thresholdValue: unknown;
    lookbackMinutes: number;
    aggregateFunction?: 'avg' | 'sum' | 'count' | 'max' | 'min' | 'p99';
  };
  /** Extra rule metadata (e.g. consecutiveBreachesRequired). */
  metadata?: Record<string, unknown>;
}

export const DEFAULT_ALERT_PRESETS: readonly DefaultAlertPreset[] = [
  {
    presetKey: 'high_error_rate',
    name: 'High error rate (default)',
    description: 'Errors as a percentage of requests exceeds the threshold within the lookback window.',
    severity: 'error',
    cooldownSeconds: 600,
    evaluationIntervalSeconds: 60,
    deduplicationWindowSeconds: 3600,
    autoResolveAfterMinutes: 30,
    condition: { fieldPath: 'errors.rate', operator: 'gte', thresholdValue: 5, lookbackMinutes: 5 },
  },
  {
    presetKey: 'high_latency_p95',
    name: 'High latency p95 (default)',
    description: 'p95 request latency (latency_ms) exceeds the threshold within the lookback window.',
    severity: 'warning',
    cooldownSeconds: 900,
    evaluationIntervalSeconds: 60,
    deduplicationWindowSeconds: 3600,
    autoResolveAfterMinutes: 30,
    condition: { fieldPath: 'requests.latency.p95', operator: 'gte', thresholdValue: 2000, lookbackMinutes: 5 },
  },
  {
    presetKey: 'elevated_5xx',
    name: 'Elevated 5xx responses (default)',
    description: 'Percentage of requests with status_code >= 500 exceeds the threshold.',
    severity: 'error',
    cooldownSeconds: 600,
    evaluationIntervalSeconds: 60,
    deduplicationWindowSeconds: 3600,
    autoResolveAfterMinutes: 30,
    condition: { fieldPath: 'requests.error_rate', operator: 'gte', thresholdValue: 2, lookbackMinutes: 5 },
  },
  {
    presetKey: 'failed_cron',
    name: 'Failed cron check-ins (default)',
    description: 'One or more cron check-ins report status error within the lookback window.',
    severity: 'error',
    cooldownSeconds: 1800,
    evaluationIntervalSeconds: 120,
    deduplicationWindowSeconds: 3600,
    autoResolveAfterMinutes: 60,
    condition: { fieldPath: 'cron.failures', operator: 'gte', thresholdValue: 1, lookbackMinutes: 15 },
  },
  {
    presetKey: 'service_inactivity',
    name: 'Service inactivity (default)',
    description: 'No requests observed within the lookback window — the service may be down or not reporting.',
    severity: 'warning',
    cooldownSeconds: 3600,
    evaluationIntervalSeconds: 120,
    deduplicationWindowSeconds: 7200,
    autoResolveAfterMinutes: 60,
    condition: { fieldPath: 'requests.count', operator: 'lt', thresholdValue: 1, lookbackMinutes: 10 },
  },
  {
    presetKey: 'availability_degradation',
    name: 'Availability degradation (default)',
    description: 'Percentage of degraded requests (status_code >= 500 or latency_ms >= 10000) exceeds the threshold.',
    severity: 'critical',
    cooldownSeconds: 900,
    evaluationIntervalSeconds: 60,
    deduplicationWindowSeconds: 3600,
    autoResolveAfterMinutes: 30,
    condition: { fieldPath: 'requests.degraded_rate', operator: 'gte', thresholdValue: 10, lookbackMinutes: 5 },
  },
  {
    presetKey: 'traffic_spike',
    name: 'Traffic spike (default)',
    description: 'Request volume within the lookback window exceeds the (org-customizable) absolute threshold.',
    severity: 'info',
    cooldownSeconds: 1800,
    evaluationIntervalSeconds: 60,
    deduplicationWindowSeconds: 3600,
    autoResolveAfterMinutes: 30,
    condition: { fieldPath: 'requests.count', operator: 'gte', thresholdValue: 10000, lookbackMinutes: 5 },
  },
] as const;

/**
 * Resolve the user id recorded as `created_by` for seeded rules: the org
 * owner (organizations.owner_user_id), falling back to the first active
 * owner/admin member. Returns null when the org has no resolvable owner —
 * the caller then skips seeding for that org (alert_rules.created_by is
 * NOT NULL with a users FK, so we cannot seed without one).
 */
async function resolvePresetActor(pool: Pool, orgId: string): Promise<string | null> {
  const owner = await pool.query<{ owner_user_id: string }>(
    `SELECT owner_user_id FROM organizations WHERE id = $1 AND deleted_at IS NULL`,
    [orgId],
  );
  if (owner.rows[0]) return owner.rows[0].owner_user_id;

  const member = await pool.query<{ user_id: string }>(
    `SELECT user_id
     FROM organization_members
     WHERE org_id = $1 AND status = 'active' AND role IN ('owner', 'admin')
     ORDER BY CASE role WHEN 'owner' THEN 0 ELSE 1 END, joined_at ASC NULLS LAST
     LIMIT 1`,
    [orgId],
  );
  return member.rows[0]?.user_id ?? null;
}

/**
 * Seed any missing default presets for an org (org-level, project_id NULL).
 * Idempotent: `uq_alert_rules_preset_scope` (partial unique index on
 * (organization_id, project_id, preset_key) NULLS NOT DISTINCT) plus
 * ON CONFLICT DO NOTHING make re-runs safe, including concurrent ones.
 * Returns the number of presets actually inserted.
 *
 * Exported for the org-creation/provisioning flow AND invoked from the
 * evaluator tick for orgs that already have traffic but no presets yet.
 */
export async function seedDefaultPresetsForOrg(pool: Pool, orgId: string): Promise<number> {
  const createdBy = await resolvePresetActor(pool, orgId);
  if (!createdBy) return 0;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let seeded = 0;
    for (const preset of DEFAULT_ALERT_PRESETS) {
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO alert_rules
           (organization_id, name, description, severity, enabled,
            evaluation_interval_seconds, cooldown_seconds, auto_resolve_after_minutes,
            deduplication_window_seconds,
            labels, annotations, metadata, created_by, enabled_at,
            project_id, preset_key, is_default)
         VALUES ($1, $2, $3, $4, TRUE, $5, $6, $7, $8, $9, $10, $11, $12, NOW(),
                 NULL, $13, TRUE)
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [
          orgId,
          preset.name,
          preset.description,
          preset.severity,
          preset.evaluationIntervalSeconds,
          preset.cooldownSeconds,
          preset.autoResolveAfterMinutes,
          preset.deduplicationWindowSeconds,
          JSON.stringify({ preset: true }),
          JSON.stringify({ preset_key: preset.presetKey }),
          JSON.stringify(preset.metadata ?? {}),
          createdBy,
          preset.presetKey,
        ],
      );
      const rule = inserted.rows[0];
      if (!rule) continue; // preset already exists for this org

      await client.query(
        `INSERT INTO alert_rule_conditions
           (rule_id, condition_type, field_path, operator, threshold_value,
            lookback_minutes, aggregate_function, is_required, order_index)
         VALUES ($1, 'threshold'::alert_condition_type, $2, $3::alert_condition_operator,
                 $4, $5, $6, TRUE, 0)`,
        [
          rule.id,
          preset.condition.fieldPath,
          preset.condition.operator,
          JSON.stringify(preset.condition.thresholdValue ?? null),
          preset.condition.lookbackMinutes,
          preset.condition.aggregateFunction ?? null,
        ],
      );

      // Default delivery: in-app only (see module docstring). The org attaches
      // connectors via routing rules or by editing this action.
      await client.query(
        `INSERT INTO alert_rule_actions
           (rule_id, action_type, priority, order_index, action_conditions, is_active)
         VALUES ($1, 'notify'::alert_action_type, 100, 0, $2, TRUE)`,
        [rule.id, JSON.stringify({ channel: 'in_app', audience: 'org_members' })],
      );
      seeded += 1;
    }
    await client.query('COMMIT');
    return seeded;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
