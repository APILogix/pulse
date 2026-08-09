import type { FastifyBaseLogger } from 'fastify';
import { AlertRuleBindingsService } from '../config/bindings.service.js';
import type { AlertCandidate, PolicyResolutionResult } from './types.js';
export interface AlertPolicyEngineDeps {
    bindings?: AlertRuleBindingsService;
    logger: FastifyBaseLogger;
}
export declare class AlertPolicyEngine {
    private readonly bindings;
    private readonly cache;
    private readonly log;
    constructor(deps: AlertPolicyEngineDeps);
    resolve(candidate: AlertCandidate, version?: number, options?: {
        requireProjectSubscription?: boolean;
    }): Promise<PolicyResolutionResult>;
    simulate(candidate: AlertCandidate, version?: number): Promise<PolicyResolutionResult>;
    invalidateRule(ruleId: string): void;
    clearCache(): void;
}
//# sourceMappingURL=policy.engine.d.ts.map