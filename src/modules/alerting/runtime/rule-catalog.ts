import type { Pool } from 'pg';
import { LRUCache } from 'lru-cache';
import type { AlertRuleConditionRow, AlertRuleRow } from '../rules/rules.types.js';
import {
  resolveEffectiveRule,
  type AlertRuleBindingRow,
  type EffectiveRule,
  type EvaluationScope,
} from '../policy/resolve-rule.js';
import {
  recordCatalogCacheHit,
  recordCatalogCacheMiss,
  recordCatalogCacheLoad,
  recordCatalogCacheInvalidation,
} from './alert-runtime-metrics.js';

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
  COALESCE(current_revision, 1) AS current_revision,
  evaluation_category
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
      // Project scope requires an explicit project subscription binding for organization-level catalog rules.
      const requireProjectSubscription = rule.project_id === null;

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
  private static readonly globalCache = new LRUCache<string, AlertCatalogSnapshot>({
    max: 2000,
    ttl: 60_000,
    updateAgeOnGet: false,
    allowStale: false,
  });

  private readonly cache: LRUCache<string, AlertCatalogSnapshot>;
  private readonly inFlightLoads = new Map<string, Promise<AlertCatalogSnapshot>>();

  constructor(
    private readonly db: Pool,
    options: { maxEntries?: number; ttlMs?: number; isolatedCache?: boolean } = {},
  ) {
    if (options.isolatedCache) {
      this.cache = new LRUCache<string, AlertCatalogSnapshot>({
        max: options.maxEntries ?? 2000,
        ttl: options.ttlMs ?? 60_000, // 60s default TTL
        updateAgeOnGet: false,
        allowStale: false,
      });
    } else {
      this.cache = AlertRuntimeRuleCatalog.globalCache;
    }
  }

  public static invalidateGlobal(organizationId?: string, tier?: AlertRuntimeTier, reason = 'mutation'): void {
    if (organizationId && tier) {
      AlertRuntimeRuleCatalog.globalCache.delete(`${organizationId}:${tier}`);
    } else if (organizationId) {
      for (const t of ['fast', 'window', 'operational', 'ai'] as AlertRuntimeTier[]) {
        AlertRuntimeRuleCatalog.globalCache.delete(`${organizationId}:${t}`);
      }
    } else {
      AlertRuntimeRuleCatalog.globalCache.clear();
    }
    recordCatalogCacheInvalidation(reason);
  }

  public static clearGlobalCache(): void {
    AlertRuntimeRuleCatalog.globalCache.clear();
  }

  /**
   * Load catalog snapshot for an organization and runtime tier.
   * Leverages process-local L1 LRU cache and single-flight coalescing to eliminate
   * duplicate database queries across concurrent evaluations.
   */
  async loadCatalogSnapshot(
    organizationId: string,
    tier: AlertRuntimeTier,
    options: { skipCache?: boolean } = {},
  ): Promise<AlertCatalogSnapshot> {
    const cacheKey = `${organizationId}:${tier}`;

    if (!options.skipCache) {
      const cached = this.cache.get(cacheKey);
      if (cached) {
        recordCatalogCacheHit(tier);
        return cached;
      }
    }

    recordCatalogCacheMiss(tier);

    // Single-flight deduplication for concurrent loads of the same org:tier
    const inFlight = this.inFlightLoads.get(cacheKey);
    if (inFlight) {
      return inFlight;
    }

    const loadPromise = (async () => {
      try {
        const rules = await this.listRulesForTier(organizationId, tier);
        const ruleIds = rules.map((rule) => rule.id);
        const [conditionsByRule, bindingsByRule] = await Promise.all([
          this.listConditions(ruleIds),
          this.listBindings(organizationId, ruleIds),
        ]);
        const snapshot = new AlertCatalogSnapshot(
          organizationId,
          tier,
          rules,
          conditionsByRule,
          bindingsByRule,
        );

        this.cache.set(cacheKey, snapshot);
        recordCatalogCacheLoad(tier);
        return snapshot;
      } finally {
        this.inFlightLoads.delete(cacheKey);
      }
    })();

    this.inFlightLoads.set(cacheKey, loadPromise);
    return loadPromise;
  }

  /**
   * Invalidate cached catalog snapshot(s) after rule/binding/condition mutations.
   */
  invalidate(organizationId?: string, tier?: AlertRuntimeTier, reason = 'mutation'): void {
    if (organizationId && tier) {
      this.cache.delete(`${organizationId}:${tier}`);
    } else if (organizationId) {
      for (const t of ['fast', 'window', 'operational', 'ai'] as AlertRuntimeTier[]) {
        this.cache.delete(`${organizationId}:${t}`);
      }
    } else {
      this.cache.clear();
    }
    recordCatalogCacheInvalidation(reason);
  }

  /**
   * Clear all cached snapshots in memory.
   */
  clearCache(): void {
    this.cache.clear();
    this.inFlightLoads.clear();
  }

  /**
   * Return the current number of cached entries in L1 memory.
   */
  getCacheSize(): number {
    return this.cache.size;
  }

  async listRulesForTier(organizationId: string, tier: AlertRuntimeTier): Promise<RuntimeRuleRow[]> {
    if (tier === 'fast') {
      const prefixes = TIER_FIELD_PREFIXES.fast;
      const result = await this.db.query<RuntimeRuleRow>(
        `SELECT ${RULE_COLUMNS}
           FROM alert_rules r
          WHERE r.organization_id = $1
            AND r.enabled = TRUE
            AND r.deleted_at IS NULL
            AND (
              r.evaluation_category = 'fast'
              OR EXISTS (
                SELECT 1
                  FROM alert_rule_conditions c
                 WHERE c.rule_id = r.id
                   AND EXISTS (
                     SELECT 1 FROM unnest($2::text[]) AS p(prefix)
                      WHERE lower(c.field_path) = p.prefix
                         OR lower(c.field_path) LIKE p.prefix || '.%'
                   )
              )
            )
          ORDER BY r.created_at ASC
          LIMIT 1000`,
        [organizationId, prefixes],
      );
      return result.rows;
    }

    const prefixes = TIER_FIELD_PREFIXES[tier];
    const result = await this.db.query<RuntimeRuleRow>(
      `SELECT ${RULE_COLUMNS}
         FROM alert_rules r
        WHERE r.organization_id = $1
          AND r.enabled = TRUE
          AND r.deleted_at IS NULL
          AND r.evaluation_category = 'analytics'
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
