import { LRUCache } from 'lru-cache';
import { ALERT_RULE_CONDITIONS_COLUMNS } from '../rules/rules.repository.js';
import { resolveEffectiveRule, } from '../policy/resolve-rule.js';
import { recordCatalogCacheHit, recordCatalogCacheMiss, recordCatalogCacheLoad, recordCatalogCacheInvalidation, } from './alert-runtime-metrics.js';
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
const TIER_FIELD_PREFIXES = {
    fast: [
        'errors.unhandled',
        'errors.fatal',
        'errors.crash',
        // Backs the `unhandled_rejection_fast` preset. It was previously absent here,
        // so field-path classification returned null for it: the preset itself still
        // worked (listRulesForTier also matches evaluation_category = 'fast'), but a
        // USER-created rule on errors.rejection would be inferred as 'analytics' by
        // inferEvaluationCategory() and land on the window tier, whose rollup tables
        // have no such column - so hasRelevantMetrics would skip it and the rule
        // would never fire. Registering the prefix makes both paths agree.
        'errors.rejection',
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
        // These four back fast-tier presets whose field paths were never registered
        // here. The presets themselves work (listRulesForTier also matches
        // evaluation_category = 'fast'), but inferEvaluationCategory() classifies an
        // unregistered path as 'analytics', so a user-created rule on one of them
        // would be routed to the window tier - whose rollup tables contain no such
        // column - and silently never fire. Registering them makes the heuristic
        // agree with the presets.
        'span.timeout',
        'db.deadlock',
        'eventloop.lag',
        'telemetry.drops',
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
export function tierForFieldPath(fieldPath) {
    const normalized = fieldPath.trim().toLowerCase();
    if (normalized.includes('.p95') ||
        normalized.includes('.p99') ||
        normalized.includes('.rate') ||
        normalized.includes('rate.') ||
        normalized.endsWith('_rate')) {
        return 'window';
    }
    for (const [tier, prefixes] of Object.entries(TIER_FIELD_PREFIXES)) {
        if (prefixes.some((prefix) => normalized === prefix || normalized.startsWith(`${prefix}.`))) {
            return tier;
        }
    }
    return null;
}
export class AlertCatalogSnapshot {
    organizationId;
    tier;
    rules;
    conditionsByRule;
    bindingsByRule;
    constructor(organizationId, tier, rules, conditionsByRule, bindingsByRule) {
        this.organizationId = organizationId;
        this.tier = tier;
        this.rules = rules;
        this.conditionsByRule = conditionsByRule;
        this.bindingsByRule = bindingsByRule;
    }
    /**
     * Pure, hot-path rule resolution. Called once per scope per evaluation tick.
     *
     * Deliberately performs NO logging: it previously emitted several console.log
     * lines per candidate rule (including building a joined condition-description
     * string for every rule, even when it was not logged at that level), which is
     * measurable wasted CPU and unbounded stdout volume on the fast path. Callers
     * emit structured summaries instead (see AlertRuntimeEngines), and per-rule
     * outcomes are exported as metrics.
     */
    resolveRulesForScope(scope) {
        if (!scope.projectId)
            return [];
        const candidateRules = this.rules.filter((rule) => rule.project_id === null || rule.project_id === scope.projectId);
        const resolved = [];
        for (const rule of candidateRules) {
            const bindings = this.bindingsByRule.get(rule.id) ?? [];
            const conditions = this.conditionsByRule.get(rule.id) ?? [];
            // Project scope requires an explicit project subscription binding for organization-level catalog rules.
            const requireProjectSubscription = rule.project_id === null;
            const effective = resolveEffectiveRule(rule, conditions, bindings, scope, { requireProjectSubscription });
            // Disabled or not subscribed to this project - skip silently. The
            // enabled/subscription decision is captured in `effective.trace` for
            // auditing, and skip counts are exported as metrics by the caller.
            if (!effective.enabled)
                continue;
            resolved.push({ rule, effective });
        }
        return resolved;
    }
}
export class AlertRuntimeRuleCatalog {
    db;
    static globalCache = new LRUCache({
        max: 2000,
        ttl: 60_000,
        updateAgeOnGet: false,
        allowStale: false,
    });
    cache;
    inFlightLoads = new Map();
    constructor(db, options = {}) {
        this.db = db;
        if (options.isolatedCache) {
            this.cache = new LRUCache({
                max: options.maxEntries ?? 2000,
                ttl: options.ttlMs ?? 60_000, // 60s default TTL
                updateAgeOnGet: false,
                allowStale: false,
            });
        }
        else {
            this.cache = AlertRuntimeRuleCatalog.globalCache;
        }
    }
    static invalidateGlobal(organizationId, tier, reason = 'mutation') {
        if (organizationId && tier) {
            AlertRuntimeRuleCatalog.globalCache.delete(`${organizationId}:${tier}`);
        }
        else if (organizationId) {
            for (const t of ['fast', 'window', 'operational', 'ai']) {
                AlertRuntimeRuleCatalog.globalCache.delete(`${organizationId}:${t}`);
            }
        }
        else {
            AlertRuntimeRuleCatalog.globalCache.clear();
        }
        recordCatalogCacheInvalidation(reason);
    }
    static clearGlobalCache() {
        AlertRuntimeRuleCatalog.globalCache.clear();
    }
    /**
     * Load catalog snapshot for an organization and runtime tier.
     * Leverages process-local L1 LRU cache and single-flight coalescing to eliminate
     * duplicate database queries across concurrent evaluations.
     */
    async loadCatalogSnapshot(organizationId, tier, options = {}) {
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
                const snapshot = new AlertCatalogSnapshot(organizationId, tier, rules, conditionsByRule, bindingsByRule);
                this.cache.set(cacheKey, snapshot);
                recordCatalogCacheLoad(tier);
                return snapshot;
            }
            finally {
                this.inFlightLoads.delete(cacheKey);
            }
        })();
        this.inFlightLoads.set(cacheKey, loadPromise);
        return loadPromise;
    }
    /**
     * Invalidate cached catalog snapshot(s) after rule/binding/condition mutations.
     */
    invalidate(organizationId, tier, reason = 'mutation') {
        if (organizationId && tier) {
            this.cache.delete(`${organizationId}:${tier}`);
        }
        else if (organizationId) {
            for (const t of ['fast', 'window', 'operational', 'ai']) {
                this.cache.delete(`${organizationId}:${t}`);
            }
        }
        else {
            this.cache.clear();
        }
        recordCatalogCacheInvalidation(reason);
    }
    /**
     * Clear all cached snapshots in memory.
     */
    clearCache() {
        this.cache.clear();
        this.inFlightLoads.clear();
    }
    /**
     * Return the current number of cached entries in L1 memory.
     */
    getCacheSize() {
        return this.cache.size;
    }
    async listRulesForTier(organizationId, tier) {
        if (tier === 'fast') {
            const prefixes = TIER_FIELD_PREFIXES.fast;
            const result = await this.db.query(`SELECT ${RULE_COLUMNS}
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
          LIMIT 1000`, [organizationId, prefixes]);
            return result.rows;
        }
        const prefixes = TIER_FIELD_PREFIXES[tier];
        const result = await this.db.query(`SELECT ${RULE_COLUMNS}
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
        LIMIT 1000`, [organizationId, prefixes]);
        return result.rows;
    }
    async listConditions(ruleIds) {
        const grouped = new Map();
        if (ruleIds.length === 0)
            return grouped;
        const result = await this.db.query(`SELECT ${ALERT_RULE_CONDITIONS_COLUMNS}
         FROM alert_rule_conditions
        WHERE rule_id = ANY($1::uuid[])
        ORDER BY rule_id, order_index ASC, id ASC`, [ruleIds]);
        for (const row of result.rows) {
            const list = grouped.get(row.rule_id) ?? [];
            list.push(row);
            grouped.set(row.rule_id, list);
        }
        return grouped;
    }
    async listBindings(organizationId, ruleIds) {
        const grouped = new Map();
        if (ruleIds.length === 0)
            return grouped;
        const result = await this.db.query(`SELECT ${BINDING_COLUMNS}
         FROM alert_rule_bindings
        WHERE organization_id = $1
          AND rule_id = ANY($2::uuid[])
          AND deleted_at IS NULL
        ORDER BY rule_id, scope_level ASC, priority DESC, created_at ASC`, [organizationId, ruleIds]);
        for (const row of result.rows) {
            const list = grouped.get(row.rule_id) ?? [];
            list.push(row);
            grouped.set(row.rule_id, list);
        }
        return grouped;
    }
    async resolveRulesForScope(organizationId, tier, scope) {
        if (!scope.projectId)
            return [];
        const snapshot = await this.loadCatalogSnapshot(organizationId, tier);
        return snapshot.resolveRulesForScope(scope);
    }
}
//# sourceMappingURL=rule-catalog.js.map