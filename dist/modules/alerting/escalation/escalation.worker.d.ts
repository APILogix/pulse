import type { FastifyBaseLogger } from 'fastify';
import type { Pool } from 'pg';
import type { EffectiveAlertPolicy } from '../policy/types.js';
import { NotificationRoutingService } from '../runtime/notification-routing.service.js';
export interface EscalationSnapshotJob {
    organizationId: string;
    projectId: string;
    ruleId: string;
    alertKey: string;
    alertEventId: string;
    notificationJobId?: string;
    policy: Pick<EffectiveAlertPolicy, 'policyId' | 'version' | 'ruleId' | 'bindingId' | 'effectiveRuleHash' | 'escalationPolicyId' | 'severity' | 'scope' | 'recipientOverrides'>;
    category: string;
    labels: Record<string, unknown>;
    step: number;
    notifyAt: string;
}
export declare class SnapshotEscalationWorker {
    private readonly logger;
    private readonly runtime;
    private readonly routing;
    constructor(logger: FastifyBaseLogger, logDb?: Pool, routing?: NotificationRoutingService);
    schedule(job: EscalationSnapshotJob): Promise<void>;
    run(job: EscalationSnapshotJob): Promise<void>;
}
export declare function runCorrelationSweep(organizationId: string): Promise<void>;
export declare function runDigestSweep(organizationId: string): Promise<void>;
//# sourceMappingURL=escalation.worker.d.ts.map