import type { FastifyBaseLogger } from 'fastify';
import type { EffectiveAlertPolicy } from '../policy/types.js';
export interface EscalationSnapshotJob {
    organizationId: string;
    alertKey: string;
    notificationJobId?: string;
    policy: Pick<EffectiveAlertPolicy, 'policyId' | 'version' | 'escalationPolicyId' | 'requestedChannels'>;
    step: number;
    notifyAt: string;
}
export declare class SnapshotEscalationWorker {
    private readonly logger;
    constructor(logger: FastifyBaseLogger);
    schedule(job: EscalationSnapshotJob): Promise<void>;
    run(job: EscalationSnapshotJob): Promise<void>;
}
export declare function runCorrelationSweep(organizationId: string): Promise<void>;
export declare function runDigestSweep(organizationId: string): Promise<void>;
//# sourceMappingURL=escalation.worker.d.ts.map