import type { Pool } from 'pg';
import type { AlertRuleConditionRow, AlertRuleRow } from '../rules/rules.types.js';
import { type AlertRuleBindingRow, type EffectiveRule, type EvaluationScope } from '../policy/resolve-rule.js';
export type AlertRuntimeTier = 'fast' | 'window' | 'operational' | 'ai';
export interface RuntimeRuleRow extends AlertRuleRow {
    current_revision: number;
}
export interface ResolvedRuntimeRule {
    rule: RuntimeRuleRow;
    effective: EffectiveRule;
}
export declare function tierForFieldPath(fieldPath: string): AlertRuntimeTier | null;
export declare class AlertCatalogSnapshot {
    readonly organizationId: string;
    readonly tier: AlertRuntimeTier;
    readonly rules: RuntimeRuleRow[];
    readonly conditionsByRule: Map<string, AlertRuleConditionRow[]>;
    readonly bindingsByRule: Map<string, AlertRuleBindingRow[]>;
    constructor(organizationId: string, tier: AlertRuntimeTier, rules: RuntimeRuleRow[], conditionsByRule: Map<string, AlertRuleConditionRow[]>, bindingsByRule: Map<string, AlertRuleBindingRow[]>);
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
    resolveRulesForScope(scope: EvaluationScope): ResolvedRuntimeRule[];
}
export declare class AlertRuntimeRuleCatalog {
    private readonly db;
    private static readonly globalCache;
    private readonly cache;
    private readonly inFlightLoads;
    constructor(db: Pool, options?: {
        maxEntries?: number;
        ttlMs?: number;
        isolatedCache?: boolean;
    });
    static invalidateGlobal(organizationId?: string, tier?: AlertRuntimeTier, reason?: string): void;
    static clearGlobalCache(): void;
    /**
     * Load catalog snapshot for an organization and runtime tier.
     * Leverages process-local L1 LRU cache and single-flight coalescing to eliminate
     * duplicate database queries across concurrent evaluations.
     */
    loadCatalogSnapshot(organizationId: string, tier: AlertRuntimeTier, options?: {
        skipCache?: boolean;
    }): Promise<AlertCatalogSnapshot>;
    /**
     * Invalidate cached catalog snapshot(s) after rule/binding/condition mutations.
     */
    invalidate(organizationId?: string, tier?: AlertRuntimeTier, reason?: string): void;
    /**
     * Clear all cached snapshots in memory.
     */
    clearCache(): void;
    /**
     * Return the current number of cached entries in L1 memory.
     */
    getCacheSize(): number;
    listRulesForTier(organizationId: string, tier: AlertRuntimeTier): Promise<RuntimeRuleRow[]>;
    listConditions(ruleIds: string[]): Promise<Map<string, AlertRuleConditionRow[]>>;
    listBindings(organizationId: string, ruleIds: string[]): Promise<Map<string, AlertRuleBindingRow[]>>;
    resolveRulesForScope(organizationId: string, tier: AlertRuntimeTier, scope: EvaluationScope): Promise<ResolvedRuntimeRule[]>;
}
//# sourceMappingURL=rule-catalog.d.ts.map