import type { FastifyBaseLogger } from 'fastify';
import type { RequestMeta } from '../../service.js';
import { BaseProjectService } from '../../shared/base.service.js';
import { ProjectPolicyRepository } from './project-policy.repository.js';
import type { SubscribePolicyBody, UpdatePolicyOverrideBody, UpdatePolicySubscriptionBody } from './project-policy.types.js';
export declare class ProjectPolicyService {
    private readonly repository;
    private readonly projectAccess;
    private readonly logger;
    constructor(repository: ProjectPolicyRepository, projectAccess: BaseProjectService, logger: FastifyBaseLogger);
    list(organizationId: string, projectId: string, userId: string): Promise<any[]>;
    subscribe(organizationId: string, projectId: string, meta: RequestMeta, body: SubscribePolicyBody): Promise<any>;
    updateState(organizationId: string, projectId: string, meta: RequestMeta, subscriptionId: string, body: UpdatePolicySubscriptionBody): Promise<any>;
    updateOverride(organizationId: string, projectId: string, meta: RequestMeta, subscriptionId: string, body: UpdatePolicyOverrideBody): Promise<any>;
    remove(organizationId: string, projectId: string, meta: RequestMeta, subscriptionId: string): Promise<void>;
    resolve(organizationId: string, projectId: string, policyId: string, userId: string): Promise<{
        policyId: any;
        projectId: any;
        state: any;
        effectiveThreshold: any;
        effectiveCooldownSeconds: any;
        effectiveEvaluationWindowSeconds: any;
        effectiveSeverity: any;
        effectiveChannels: any;
        effectiveEscalationPolicyId: any;
        isOverridden: boolean;
        overrides: any;
        basePolicy: {
            id: any;
            organizationId: any;
            slug: any;
            name: any;
            description: any;
            category: any;
            severity: any;
            defaultThreshold: any;
            recoveryThreshold: any;
            cooldownSeconds: any;
            evaluationWindowSeconds: any;
            currentVersion: any;
            enabled: any;
            currentDefinition: any;
        };
    }>;
    listEffective(organizationId: string, projectId: string, userId: string): Promise<{
        policyId: any;
        projectId: any;
        state: any;
        effectiveThreshold: any;
        effectiveCooldownSeconds: any;
        effectiveEvaluationWindowSeconds: any;
        effectiveSeverity: any;
        effectiveChannels: any;
        effectiveEscalationPolicyId: any;
        isOverridden: boolean;
        overrides: any;
        basePolicy: {
            id: any;
            organizationId: any;
            slug: any;
            name: any;
            description: any;
            category: any;
            severity: any;
            defaultThreshold: any;
            recoveryThreshold: any;
            cooldownSeconds: any;
            evaluationWindowSeconds: any;
            currentVersion: any;
            enabled: any;
            currentDefinition: any;
        };
    }[]>;
}
//# sourceMappingURL=project-policy.service.d.ts.map