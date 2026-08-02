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
export declare class AlertRuntimeRuleCatalog {
    private readonly db;
    constructor(db: Pool);
    listRulesForTier(organizationId: string, tier: AlertRuntimeTier): Promise<RuntimeRuleRow[]>;
    listConditions(ruleIds: string[]): Promise<Map<string, AlertRuleConditionRow[]>>;
    listBindings(organizationId: string, ruleIds: string[]): Promise<Map<string, AlertRuleBindingRow[]>>;
    resolveRulesForScope(organizationId: string, tier: AlertRuntimeTier, scope: EvaluationScope): Promise<ResolvedRuntimeRule[]>;
}
//# sourceMappingURL=rule-catalog.d.ts.map