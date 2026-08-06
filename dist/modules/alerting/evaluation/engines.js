import { pgboss } from '../../../lib/pgboss.js';
import { AlertPolicyEngine } from '../policy/policy.engine.js';
import { evaluateMetric } from './metric-registry.js';
export class FastEvaluationEngine {
    policies;
    log;
    constructor(policies, log) {
        this.policies = policies;
        this.log = log;
    }
    async evaluate(input) {
        const result = evaluateMetric(input.metric, input.context, input.candidate.observedAt);
        if (result.value === null)
            return false;
        const policy = await this.policies.resolve(input.candidate);
        const candidate = {
            ...input.candidate,
            values: { ...input.candidate.values, metric: result.value, sampleCount: result.sampleCount },
        };
        await pgboss.send('alert.decide', {
            ...candidate,
            observedAt: candidate.observedAt.toISOString(),
            policy: policy.policy,
            observedValue: result.value,
            evidence: { ...(candidate.evidence ?? {}), metric: input.metric, sampleCount: result.sampleCount },
        }, { retryLimit: 5, retryDelay: 1, retryBackoff: true });
        this.log.debug({ ruleId: candidate.ruleId, value: result.value }, 'Fast evaluation emitted alert candidate');
        return true;
    }
}
export class WindowEvaluationEngine extends FastEvaluationEngine {
}
export class PgBossEvaluationTierScheduler {
    async schedule(organizationId, tier) {
        await pgboss.send(`alert.evaluate.${tier}`, { organizationId }, {
            singletonKey: `alert-evaluate:${tier}:${organizationId}:${Math.floor(Date.now() / 5000)}`,
            retryLimit: 3,
            retryDelay: 1,
            retryBackoff: true,
        });
    }
}
//# sourceMappingURL=engines.js.map