import type { FastifyBaseLogger } from 'fastify';
import type { AlertingRepository } from './repository.js';
import type { ConnectorRepository } from '../connectors/repository.js';
import { type ConnectorJobName } from '../connectors/job.constants.js';
import { AlertRuntimeRepository } from './runtime/alert-runtime.repository.js';
import { NotificationEntitlementService } from './runtime/notification-entitlement.service.js';
type EnqueueConnectorJob = (queue: ConnectorJobName, data: Record<string, unknown>, options?: Record<string, unknown>) => Promise<unknown>;
/** Hands a created notification job to the canonical notification router. */
type EnqueueNotificationJob = (notificationJobId: string) => Promise<unknown>;
export interface EscalationSweepResult {
    resumedAcknowledgments: number;
    claimed: number;
    escalated: number;
    repeated: number;
    exhausted: number;
    failed: number;
}
export declare class AlertEscalationSweep {
    private readonly alertRepo;
    private readonly connectorRepo;
    private readonly enqueueConnectorJob;
    private readonly logger;
    private readonly entitlement;
    /** Log DB runtime repository - owns alert_notification_jobs. */
    private readonly runtime;
    private readonly enqueueNotificationJob;
    constructor(alertRepo: AlertingRepository, connectorRepo: ConnectorRepository, enqueueConnectorJob: EnqueueConnectorJob, logger: FastifyBaseLogger, entitlement?: NotificationEntitlementService, 
    /** Log DB runtime repository - owns alert_notification_jobs. */
    runtime?: AlertRuntimeRepository, enqueueNotificationJob?: EnqueueNotificationJob);
    run(limit: number): Promise<EscalationSweepResult>;
    private advanceEvent;
    private canRepeat;
    /** Enqueue canonical V2 transport jobs for every connector in the step. */
    private executeStep;
    private toPayload;
}
export {};
//# sourceMappingURL=escalation.d.ts.map