import type { Pool } from 'pg';
import type { UpdatePolicyOverrideBody, UpdatePolicySubscriptionBody } from './project-policy.types.js';
export declare class ProjectPolicyRepository {
    private readonly db;
    constructor(db?: Pool);
    findPolicyIdentity(organizationId: string, policyId: string): Promise<{
        slug: string;
    } | null>;
    list(organizationId: string, projectId: string): Promise<any[]>;
    create(organizationId: string, projectId: string, policyId: string, userId: string): Promise<any>;
    updateState(organizationId: string, projectId: string, subscriptionId: string, userId: string, body: UpdatePolicySubscriptionBody): Promise<any>;
    updateOverride(organizationId: string, projectId: string, subscriptionId: string, userId: string, body: UpdatePolicyOverrideBody): Promise<any>;
    remove(organizationId: string, projectId: string, subscriptionId: string, userId: string): Promise<boolean>;
    resolve(organizationId: string, projectId: string, policyId: string): Promise<{
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
    } | null>;
}
//# sourceMappingURL=project-policy.repository.d.ts.map