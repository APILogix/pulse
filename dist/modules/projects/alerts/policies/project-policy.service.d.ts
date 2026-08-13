import type { FastifyBaseLogger } from 'fastify';
import type { RequestMeta } from '../../service.js';
import { BaseProjectService } from '../../shared/base.service.js';
import { ProjectPolicyRepository } from './project-policy.repository.js';
import { AlertConfigRepository } from '../../../alerting/config/alert-config.repository.js';
import { AlertRuleBindingsRepository } from '../../../alerting/config/bindings.repository.js';
import type { SubscribePolicyBody, UpdatePolicyOverrideBody, UpdatePolicySubscriptionBody } from './project-policy.types.js';
export declare class ProjectPolicyService {
    private readonly repository;
    private readonly projectAccess;
    private readonly logger;
    private readonly config;
    private readonly bindings;
    constructor(repository: ProjectPolicyRepository, projectAccess: BaseProjectService, logger: FastifyBaseLogger, config?: AlertConfigRepository, bindings?: AlertRuleBindingsRepository);
    list(organizationId: string, projectId: string, userId: string): Promise<Record<string, unknown>[]>;
    subscribe(organizationId: string, projectId: string, meta: RequestMeta, body: SubscribePolicyBody): Promise<Record<string, unknown>>;
    updateState(organizationId: string, projectId: string, meta: RequestMeta, subscriptionId: string, body: UpdatePolicySubscriptionBody): Promise<Record<string, unknown>>;
    updateOverride(organizationId: string, projectId: string, meta: RequestMeta, subscriptionId: string, body: UpdatePolicyOverrideBody): Promise<Record<string, unknown>>;
    remove(organizationId: string, projectId: string, meta: RequestMeta, subscriptionId: string): Promise<void>;
    resolve(organizationId: string, projectId: string, policyId: string, userId: string): Promise<Record<string, unknown>>;
    listEffective(organizationId: string, projectId: string, userId: string): Promise<Record<string, unknown>[]>;
    private requireCanonicalRule;
    private requireBinding;
    private bindingDto;
}
//# sourceMappingURL=project-policy.service.d.ts.map