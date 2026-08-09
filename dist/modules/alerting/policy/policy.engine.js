import { AlertRuleBindingsService } from '../config/bindings.service.js';
import { AlertPolicyCache, policyCacheKey } from './policy.cache.js';
import { hashCanonical } from '../runtime/effective-rule-contract.js';
export class AlertPolicyEngine {
    bindings;
    cache = new AlertPolicyCache();
    log;
    constructor(deps) {
        this.bindings = deps.bindings ?? new AlertRuleBindingsService({ logger: deps.logger });
        this.log = deps.logger.child({ component: 'alert-policy-engine' });
    }
    async resolve(candidate, version = 1, options = {}) {
        const scope = {
            ...(candidate.projectId ? { projectId: candidate.projectId } : {}),
            ...(candidate.environment ? { environment: candidate.environment } : {}),
            ...(candidate.service ? { service: candidate.service } : {}),
            ...(candidate.endpoint ? { endpoint: candidate.endpoint } : {}),
        };
        const key = policyCacheKey(candidate.organizationId, candidate.ruleId, version, {
            projectId: candidate.projectId ?? null,
            environment: candidate.environment ?? null,
            service: candidate.service ?? null,
            endpoint: candidate.endpoint ?? null,
        }, options);
        const cacheable = options.requireProjectSubscription !== true;
        const cached = cacheable ? this.cache.get(key) : undefined;
        if (cached)
            return cached;
        const result = await this.bindings.resolveEffective(candidate.organizationId, candidate.ruleId, scope, options);
        const policy = {
            policyId: `${candidate.organizationId}:${candidate.ruleId}:${result.ruleRevision}`,
            version: result.ruleRevision,
            organizationId: candidate.organizationId,
            projectId: candidate.projectId ?? null,
            ruleId: candidate.ruleId,
            bindingId: result.rule.bindingId,
            ruleRevision: result.ruleRevision,
            effectiveRuleHash: hashCanonical({
                organizationId: candidate.organizationId,
                projectId: candidate.projectId ?? null,
                ruleId: candidate.ruleId,
                bindingId: result.rule.bindingId,
                version,
                rule: result.rule,
                thresholds: result.thresholds,
            }),
            scope: {
                organizationId: candidate.organizationId,
                projectId: candidate.projectId ?? null,
                environment: candidate.environment ?? null,
                service: candidate.service ?? null,
                endpoint: candidate.endpoint ?? null,
            },
            enabled: result.rule.enabled,
            severity: result.rule.severity,
            cooldownSeconds: result.rule.cooldownSeconds,
            deduplicationWindowSeconds: result.rule.deduplicationWindowSeconds,
            evaluationIntervalSeconds: result.rule.evaluationIntervalSeconds,
            autoResolveAfterMinutes: result.rule.autoResolveAfterMinutes,
            consecutiveBreaches: result.rule.consecutiveBreaches,
            conditions: result.rule.conditions,
            thresholds: result.thresholds,
            requestedChannels: [...result.rule.requestedChannels],
            recipientOverrides: result.rule.recipientOverrides
                ? { ...result.rule.recipientOverrides }
                : null,
            escalationPolicyId: result.rule.escalationPolicyId,
            trace: result.rule.trace.map((entry) => ({ ...entry, applied: [...entry.applied] })),
        };
        const resolved = {
            policy,
            conflict: result.conflict,
            appliedBindingIds: [...result.appliedBindingIds],
        };
        if (cacheable)
            this.cache.set(key, resolved);
        return resolved;
    }
    async simulate(candidate, version = 1) {
        const startedAt = Date.now();
        try {
            return await this.resolve(candidate, version);
        }
        finally {
            this.log.debug({ ruleId: candidate.ruleId, durationMs: Date.now() - startedAt }, 'Alert policy simulated');
        }
    }
    invalidateRule(ruleId) {
        this.cache.deleteByRule(ruleId);
    }
    clearCache() {
        this.cache.clear();
    }
}
//# sourceMappingURL=policy.engine.js.map