import type { AlertRuleRow } from '../rules/rules.types.js';
import type { EffectiveRule, EvaluationScope } from '../policy/resolve-rule.js';
export interface EffectiveProjectRule {
    organizationId: string;
    projectId: string;
    ruleId: string;
    bindingId: string;
    ruleRevision: number;
    scope: EvaluationScope;
    enabled: boolean;
    severity: EffectiveRule['severity'];
    cooldownSeconds: number;
    deduplicationWindowSeconds: number;
    evaluationIntervalSeconds: number;
    autoResolveAfterMinutes: number | null;
    consecutiveBreaches: number;
    conditions: EffectiveRule['conditions'];
    requestedChannels: string[];
    recipientOverrides: Record<string, unknown> | null;
    escalationPolicyId: string | null;
    hash: string;
}
export declare function buildEffectiveProjectRule(rule: AlertRuleRow & {
    current_revision: number;
}, effective: EffectiveRule, scope: EvaluationScope): EffectiveProjectRule | null;
export declare function hashCanonical(value: unknown): string;
//# sourceMappingURL=effective-rule-contract.d.ts.map