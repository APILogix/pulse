import type { Pool } from 'pg';
import type { AlertRuleConditionRow, AlertRuleRow } from '../rules/rules.types.js';
import {
  resolveEffectiveRule,
  type AlertRuleBindingRow,
  type EffectiveRule,
  type EvaluationScope,
} from '../policy/resolve-rule.js';

export type AlertRuntimeTier = 'fast' | 'window' | 'operational' | 'ai';

export interface RuntimeRuleRow extends AlertRuleRow {
  current_revision: number;
}

export interface ResolvedRuntimeRule {
  rule: RuntimeRuleRow;
  effective: EffectiveRule;
}

const RULE_COLUMNS = `
  id, organization_id, name, description, severity, enabled,
  evaluation_interval_seconds, cooldown_seconds, auto_resolve_after_minutes,
  deduplication_window_seconds, deduplication_key_template,
  grouping_enabled, grouping_key_template, grouping_wait_seconds,
  labels, annotations, metadata, created_by, updated_by,
  enabled_at, disabled_at, created_at, updated_at, deleted_at,
  project_id, preset_key, is_default, last_evaluated_at,
  COALESCE(current_revision, 1) AS current_revision
`;

const BINDING_COLUMNS = `
  id, organization_id, rule_id, scope_type, scope_level,
  project_id, environment, service, endpoint,
  mode, enabled, priority,
  severity, cooldown_seconds, deduplication_window_seconds,
  auto_resolve_after_minutes, evaluation_interval_seconds, consecutive_breaches,
  threshold_overrides, action_mode, requested_channels, recipient_overrides,
  escalation_policy_id, notes, created_at, deleted_at
`;

const TIER_FIELD_PREFIXES: Record<AlertRuntimeTier, string[]> = {
  fast: [
    'errors.unhandled',
    'errors.fatal',
    'errors.crash',
    'logs.oom',
    'logs.security',
    'cron.failed',
    'requests.auth_failure',
    'requests.latency',
    'requests.latency_ms',
    'requests.duration',
    'requests.duration_ms',
    'requests.status_code',
    'latency',
    'latency_ms',
    'duration',
    'duration_ms',
    'deployment.failed',
    'heartbeat.lost',
    'connector.failure',
  ],
  window: [
    'errors.rate',
    'error.rate',
    'requests.error_rate',
    'requests.degraded_rate',
    'requests.5xx_rate',
    '5xx.rate',
    'requests.latency',
    'requests.latency.p95',
    'requests.latency.p99',
    'requests.latency_ms',
    'requests.duration',
    'requests.duration_ms',
    'latency',
    'latency.p95',
    'latency.p99',
    'latency_ms',
    'duration',
    'duration_ms',
    'availability.pct',
    'requests.count',
    'traffic.count',
    'cron.failure_rate',
    'cron.failures',
    'ai.failure_rate',
    'ai.latency.p95',
    'ai.requests.failed',
    'ai.duration.p95',
  ],
  operational: [
    'runtime.cpu',
    'runtime.memory',
    'metrics.cpu.usage',
    'metrics.memory.usage',
    'runtime.disk',
    'runtime.network_errors',
    'db.connection_errors',
    'queue.backlog',
    'service.health',
    'endpoint.health',
    'logs.error_count',
  ],
  ai: [
    'ai.cost',
    'ai.credits',
    'ai.cost.usd',
    'ai.credits.used',
    'ai.usage',
    'capacity.forecast',
    'slo.burn_rate',
    'release.regression',
    'usage.anomaly',
    'trend.regression',
  ],
};

export function tierForFieldPath(fieldPath: string): AlertRuntimeTier | null {
  const normalized = fieldPath.trim().toLowerCase();
  if (
    normalized.includes('.p95') ||
    normalized.includes('.p99') ||
    normalized.includes('.rate') ||
    normalized.includes('rate.') ||
    normalized.endsWith('_rate')
  ) {
    return 'window';
  }
  for (const [tier, prefixes] of Object.entries(TIER_FIELD_PREFIXES) as Array<[AlertRuntimeTier, string[]]>) {
    if (prefixes.some((prefix) => normalized === prefix || normalized.startsWith(`${prefix}.`))) {
      return tier;
    }
  }
  return null;
}

export class AlertCatalogSnapshot {
  constructor(
    public readonly organizationId: string,
    public readonly tier: AlertRuntimeTier,
    public readonly rules: RuntimeRuleRow[],
    public readonly conditionsByRule: Map<string, AlertRuleConditionRow[]>,
    public readonly bindingsByRule: Map<string, AlertRuleBindingRow[]>,
  ) {}

  resolveRulesForScope(scope: EvaluationScope): ResolvedRuntimeRule[] {
    if (!scope.projectId) {
      console.log(`[ALERTING] [Phase 1/4: Rule Fetch] ⚠️ Scope has no projectId; skipping project resolution.`);
      return [];
    }

    const candidateRules = this.rules.filter(
      (rule) => rule.project_id === null || rule.project_id === scope.projectId,
    );

    console.log(
      `[ALERTING] [Phase 1/4: Rule Fetch] 🔍 Fetching subscribed rules for Project: "${scope.projectId}" | Tier: "${this.tier}" | Organization Catalog Total: ${this.rules.length} | Project Candidates: ${candidateRules.length}`,
    );

    const resolved: ResolvedRuntimeRule[] = [];

    for (const rule of candidateRules) {
      const bindings = this.bindingsByRule.get(rule.id) ?? [];
      const conditions = this.conditionsByRule.get(rule.id) ?? [];
      // Default organization rules (is_default = true) and project-specific rules apply automatically.
      // Optional catalog rules (is_default = false and project_id = null) require an explicit project subscription binding.
      const requireProjectSubscription = !rule.is_default && rule.project_id === null;

      const effective = resolveEffectiveRule(
        rule,
        conditions,
        bindings,
        scope,
        { requireProjectSubscription },
      );

      const conditionsDesc = effective.conditions
        .map((c) => `${c.field_path} ${c.operator} ${c.threshold_value}`)
        .join(' AND ');

      if (!effective.enabled) {
        console.log(
          `[ALERTING] [Phase 1/4: Rule Fetch] ⏭️ Rule "${rule.name}" (${rule.id}) is DISABLED or UNSUBSCRIBED for project ${scope.projectId} (requireProjectSubscription=${requireProjectSubscription}, bindings=${bindings.length}).`,
        );
        continue;
      }

      console.log(
        `[ALERTING] [Phase 1/4: Rule Fetch] ✅ Rule SUBSCRIBED & ACTIVE: "${rule.name}" (${rule.id}) | Scope: [Project: ${scope.projectId}, Env: ${scope.environment ?? 'all'}] | Severity: ${effective.severity} | ConsecutiveBreaches: ${effective.consecutiveBreaches} | Cooldown: ${effective.cooldownSeconds}s | Conditions: [${conditionsDesc}]`,
      );

      resolved.push({ rule, effective });
    }

    console.log(
      `[ALERTING] [Phase 1/4: Rule Fetch] 🎯 Total active subscribed rules ready for evaluation: ${resolved.length}`,
    );

    return resolved;
  }
}

export class AlertRuntimeRuleCatalog {
  constructor(private readonly db: Pool) {}

  async loadCatalogSnapshot(
    organizationId: string,
    tier: AlertRuntimeTier,
  ): Promise<AlertCatalogSnapshot> {
    const rules = await this.listRulesForTier(organizationId, tier);
    const ruleIds = rules.map((rule) => rule.id);
    const [conditionsByRule, bindingsByRule] = await Promise.all([
      this.listConditions(ruleIds),
      this.listBindings(organizationId, ruleIds),
    ]);
    return new AlertCatalogSnapshot(
      organizationId,
      tier,
      rules,
      conditionsByRule,
      bindingsByRule,
    );
  }

  async listRulesForTier(organizationId: string, tier: AlertRuntimeTier): Promise<RuntimeRuleRow[]> {
    const prefixes = TIER_FIELD_PREFIXES[tier];
    const result = await this.db.query<RuntimeRuleRow>(
      `SELECT ${RULE_COLUMNS}
         FROM alert_rules r
        WHERE r.organization_id = $1
          AND r.enabled = TRUE
          AND r.deleted_at IS NULL
          AND EXISTS (
            SELECT 1
              FROM alert_rule_conditions c
             WHERE c.rule_id = r.id
               AND EXISTS (
                 SELECT 1 FROM unnest($2::text[]) AS p(prefix)
                  WHERE lower(c.field_path) = p.prefix
                     OR lower(c.field_path) LIKE p.prefix || '.%'
               )
          )
        ORDER BY r.created_at ASC
        LIMIT 1000`,
      [organizationId, prefixes],
    );
    return result.rows;
  }

  async listConditions(ruleIds: string[]): Promise<Map<string, AlertRuleConditionRow[]>> {
    const grouped = new Map<string, AlertRuleConditionRow[]>();
    if (ruleIds.length === 0) return grouped;
    const result = await this.db.query<AlertRuleConditionRow>(
      `SELECT *
         FROM alert_rule_conditions
        WHERE rule_id = ANY($1::uuid[])
        ORDER BY rule_id, order_index ASC, id ASC`,
      [ruleIds],
    );
    for (const row of result.rows) {
      const list = grouped.get(row.rule_id) ?? [];
      list.push(row);
      grouped.set(row.rule_id, list);
    }
    return grouped;
  }

  async listBindings(organizationId: string, ruleIds: string[]): Promise<Map<string, AlertRuleBindingRow[]>> {
    const grouped = new Map<string, AlertRuleBindingRow[]>();
    if (ruleIds.length === 0) return grouped;
    const result = await this.db.query<AlertRuleBindingRow>(
      `SELECT ${BINDING_COLUMNS}
         FROM alert_rule_bindings
        WHERE organization_id = $1
          AND rule_id = ANY($2::uuid[])
          AND deleted_at IS NULL
        ORDER BY rule_id, scope_level ASC, priority DESC, created_at ASC`,
      [organizationId, ruleIds],
    );
    for (const row of result.rows) {
      const list = grouped.get(row.rule_id) ?? [];
      list.push(row);
      grouped.set(row.rule_id, list);
    }
    return grouped;
  }

  async resolveRulesForScope(
    organizationId: string,
    tier: AlertRuntimeTier,
    scope: EvaluationScope,
  ): Promise<ResolvedRuntimeRule[]> {
    if (!scope.projectId) return [];
    const snapshot = await this.loadCatalogSnapshot(organizationId, tier);
    return snapshot.resolveRulesForScope(scope);
  }
}
