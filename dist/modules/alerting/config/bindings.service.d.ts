/**
 * Alert rule binding service — composition layer for bindings and effective rule resolution.
 *
 * Architecture: docs/alerting-redesign/adr/0004-rule-inheritance-model.md
 *               docs/alerting-redesign/08-implementation-plan.md Increment 2 (API)
 *
 * This is deliberately thin. It composes two things that must not be coupled:
 *   - AlertConfigRepository  → the rule definition and its conditions (primary DB)
 *   - AlertRuleBindingsRepository → scope behaviour (primary DB)
 * and calls the PURE resolver. Resolution logic itself lives in policy/resolve-rule.ts and is
 * never duplicated here.
 *
 * Nothing in the evaluation path calls this yet: Increment 2 ships the capability dormant.
 */
import type { FastifyBaseLogger } from 'fastify';
import { type EffectiveRule } from '../policy/resolve-rule.js';
import { type EffectiveThreshold } from '../policy/resolve-threshold.js';
import { AlertConfigRepository } from './alert-config.repository.js';
import { AlertRuleBindingsRepository, type AlertRuleRevisionRow } from './bindings.repository.js';
import type { CreateBindingBody, EffectiveRuleQuery, UpdateBindingBody } from './bindings.types.js';
import type { AlertRuleBindingRow } from '../policy/resolve-rule.js';
export interface EffectiveRuleResult {
    rule: EffectiveRule;
    thresholds: EffectiveThreshold[];
    /** True when two bindings tied at the same depth and the tie-break decided. */
    conflict: boolean;
    /** Bindings that matched the requested scope, deepest last. */
    appliedBindingIds: string[];
}
export interface BindingsServiceDeps {
    config?: AlertConfigRepository;
    bindings?: AlertRuleBindingsRepository;
    logger: FastifyBaseLogger;
}
export declare class AlertRuleBindingsService {
    private readonly config;
    private readonly bindings;
    private readonly log;
    constructor(deps: BindingsServiceDeps);
    list(organizationId: string, ruleId: string): Promise<AlertRuleBindingRow[]>;
    get(organizationId: string, ruleId: string, bindingId: string): Promise<AlertRuleBindingRow>;
    create(organizationId: string, ruleId: string, body: CreateBindingBody, actorUserId: string | null): Promise<AlertRuleBindingRow>;
    update(organizationId: string, ruleId: string, bindingId: string, body: UpdateBindingBody, actorUserId: string | null): Promise<AlertRuleBindingRow>;
    remove(organizationId: string, ruleId: string, bindingId: string, actorUserId: string | null): Promise<void>;
    listRevisions(organizationId: string, ruleId: string, limit?: number): Promise<AlertRuleRevisionRow[]>;
    /**
     * Resolve the ONE effective rule for a scope.
     *
     * The returned trace is the debugging surface for inheritance: it names every binding that
     * contributed and which fields it set, so "why did this fire at 0.5%?" has a direct answer.
     */
    resolveEffective(organizationId: string, ruleId: string, query: EffectiveRuleQuery): Promise<EffectiveRuleResult>;
}
//# sourceMappingURL=bindings.service.d.ts.map