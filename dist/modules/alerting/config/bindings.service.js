import { AlertNotFoundError } from '../types.js';
import { hasEqualDepthConflict, resolveEffectiveRule, } from '../policy/resolve-rule.js';
import { recordBindingConflict } from '../policy/metrics.js';
import { resolveAllEffectiveThresholds } from '../policy/resolve-threshold.js';
import { AlertConfigRepository } from './alert-config.repository.js';
import { AlertRuleBindingsRepository } from './bindings.repository.js';
export class AlertRuleBindingsService {
    config;
    bindings;
    log;
    constructor(deps) {
        this.config = deps.config ?? new AlertConfigRepository();
        this.bindings = deps.bindings ?? new AlertRuleBindingsRepository();
        this.log = deps.logger.child({ component: 'alert-rule-bindings' });
    }
    async list(organizationId, ruleId) {
        return this.bindings.listByRule(organizationId, ruleId);
    }
    async get(organizationId, ruleId, bindingId) {
        const binding = await this.bindings.findById(organizationId, ruleId, bindingId);
        if (!binding)
            throw new AlertNotFoundError('Alert rule binding');
        return binding;
    }
    async create(organizationId, ruleId, body, actorUserId) {
        const binding = await this.bindings.create(organizationId, ruleId, body, actorUserId);
        this.log.info({
            orgId: organizationId, ruleId, bindingId: binding.id,
            scopeType: binding.scope_type, mode: binding.mode,
        }, 'Alert rule binding created');
        return binding;
    }
    async update(organizationId, ruleId, bindingId, body, actorUserId) {
        const binding = await this.bindings.update(organizationId, ruleId, bindingId, body, actorUserId);
        this.log.info({ orgId: organizationId, ruleId, bindingId }, 'Alert rule binding updated');
        return binding;
    }
    async remove(organizationId, ruleId, bindingId, actorUserId) {
        await this.bindings.softDelete(organizationId, ruleId, bindingId, actorUserId);
        this.log.info({ orgId: organizationId, ruleId, bindingId }, 'Alert rule binding deleted');
    }
    async listRevisions(organizationId, ruleId, limit) {
        return this.bindings.listRevisions(organizationId, ruleId, limit);
    }
    /**
     * Resolve the ONE effective rule for a scope.
     *
     * The returned trace is the debugging surface for inheritance: it names every binding that
     * contributed and which fields it set, so "why did this fire at 0.5%?" has a direct answer.
     */
    async resolveEffective(organizationId, ruleId, query) {
        const rule = await this.config.findRuleById(organizationId, ruleId);
        if (!rule)
            throw new AlertNotFoundError('Alert rule');
        const [conditions, bindings] = await Promise.all([
            this.config.getRuleConditions(ruleId),
            this.bindings.listByRule(organizationId, ruleId),
        ]);
        const scope = {
            organizationId,
            projectId: query.projectId ?? null,
            environment: query.environment ?? null,
            service: query.service ?? null,
            endpoint: query.endpoint ?? null,
        };
        const effective = resolveEffectiveRule(rule, conditions, bindings, scope);
        const conflict = hasEqualDepthConflict(bindings, scope);
        if (conflict) {
            recordBindingConflict(effective.resolvedScopeLevel);
            this.log.warn({ orgId: organizationId, ruleId, scopeLevel: effective.resolvedScopeLevel }, 'Two alert rule bindings tie at the same scope depth — resolution used the tie-break');
        }
        return {
            rule: effective,
            thresholds: resolveAllEffectiveThresholds(effective),
            conflict,
            appliedBindingIds: effective.trace
                .map((entry) => entry.bindingId)
                .filter((id) => id !== null),
        };
    }
}
//# sourceMappingURL=bindings.service.js.map