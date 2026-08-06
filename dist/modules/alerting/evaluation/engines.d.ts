import type { FastifyBaseLogger } from 'fastify';
import { AlertPolicyEngine } from '../policy/policy.engine.js';
import type { AlertCandidate } from '../policy/types.js';
import { type MetricContext, type MetricRequest } from './metric-registry.js';
export interface EvaluationInput {
    candidate: AlertCandidate;
    metric: MetricRequest;
    context: MetricContext;
}
export declare class FastEvaluationEngine {
    private readonly policies;
    private readonly log;
    constructor(policies: AlertPolicyEngine, log: FastifyBaseLogger);
    evaluate(input: EvaluationInput): Promise<boolean>;
}
export declare class WindowEvaluationEngine extends FastEvaluationEngine {
}
export interface EvaluationTierScheduler {
    schedule(organizationId: string, tier: string): Promise<void>;
}
export declare class PgBossEvaluationTierScheduler implements EvaluationTierScheduler {
    schedule(organizationId: string, tier: string): Promise<void>;
}
//# sourceMappingURL=engines.d.ts.map