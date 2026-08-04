import type { FastifyBaseLogger } from 'fastify';
import { pgboss } from '../../../lib/pgboss.js';
import { AlertPolicyEngine } from '../policy/policy.engine.js';
import type { AlertCandidate } from '../policy/types.js';
import { evaluateMetric, type MetricContext, type MetricRequest } from './metric-registry.js';

export interface EvaluationInput {
  candidate: AlertCandidate;
  metric: MetricRequest;
  context: MetricContext;
}

export class FastEvaluationEngine {
  constructor(
    private readonly policies: AlertPolicyEngine,
    private readonly log: FastifyBaseLogger,
  ) {}

  async evaluate(input: EvaluationInput): Promise<boolean> {
    const result = evaluateMetric(input.metric, input.context, input.candidate.observedAt);
    if (result.value === null) return false;
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
    }, { retryLimit: 5, retryDelay: 1, retryBackoff: true } as never);
    this.log.debug({ ruleId: candidate.ruleId, value: result.value }, 'Fast evaluation emitted alert candidate');
    return true;
  }
}

export class WindowEvaluationEngine extends FastEvaluationEngine {}

export interface EvaluationTierScheduler {
  schedule(organizationId: string, tier: string): Promise<void>;
}

export class PgBossEvaluationTierScheduler implements EvaluationTierScheduler {
  async schedule(organizationId: string, tier: string): Promise<void> {
    await pgboss.send(`alert.evaluate.${tier}`, { organizationId }, {
      singletonKey: `alert-evaluate:${tier}:${organizationId}:${Math.floor(Date.now() / 5000)}`,
      retryLimit: 3,
      retryDelay: 1,
      retryBackoff: true,
    } as never);
  }
}
