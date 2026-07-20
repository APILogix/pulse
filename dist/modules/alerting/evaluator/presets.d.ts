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
export declare const DEFAULT_ALERT_PRESETS: readonly DefaultAlertPreset[];
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
export declare function seedDefaultPresetsForOrg(pool: Pool, orgId: string): Promise<number>;
//# sourceMappingURL=presets.d.ts.map