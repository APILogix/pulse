/**
 * Escalation sweep worker.
 *
 * Wires the previously schema-only escalation model into a live execution path:
 *
 *   1. Expired acknowledgments flip back to `firing` so escalation resumes.
 *   2. Firing events whose `next_escalation_at` is due are claimed with
 *      FOR UPDATE SKIP LOCKED (no two workers process the same event).
 *   3. The next active step of the event's policy is executed: connector-send
 *      jobs are enqueued for the step's connectors/routes, the event advances
 *      to that step, and the following step's wait schedules the next run.
 *   4. When steps run out, the policy's repeat config decides: repeat from
 *      step 1 (bounded by max_repeats; 0 = unlimited) or stop escalating.
 *
 * All escalation transitions write `alert_event_history` rows for audit.
 */
import type { FastifyBaseLogger } from 'fastify';
import type { AlertingRepository } from './repository.js';
import type { ConnectorRepository } from '../connectors/repository.js';
import { type ConnectorJobName } from '../connectors/job.constants.js';
type EnqueueConnectorJob = (queue: ConnectorJobName, data: Record<string, unknown>, options?: Record<string, unknown>) => Promise<unknown>;
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
    constructor(alertRepo: AlertingRepository, connectorRepo: ConnectorRepository, enqueueConnectorJob: EnqueueConnectorJob, logger: FastifyBaseLogger);
    run(limit: number): Promise<EscalationSweepResult>;
    private advanceEvent;
    private canRepeat;
    /** Enqueue connector-send jobs for every connector in the step. */
    private executeStep;
    private toPayload;
}
export {};
//# sourceMappingURL=escalation.d.ts.map