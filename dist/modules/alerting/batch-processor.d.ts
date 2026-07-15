/**
 * Alert event batch processor (CRITICAL performance path).
 *
 * Processes a batch of up to 100 alert events with STRICT concurrency rules:
 *   - ALL per-event work runs concurrently via Promise.allSettled — there is
 *     NO sequential `for`/`forEach` over events doing async work.
 *   - Connectors for the whole batch are fetched in ONE query (no N+1).
 *   - Event status updates and delivery-attempt logs are written with ONE
 *     bulk statement each (UNNEST), not per row.
 *
 * Delivery reuses the connector module by enqueuing connector-send jobs. This
 * batch processor resolves routes and records queued attempts; connector
 * pg-boss workers perform provider I/O and connector delivery bookkeeping.
 */
import type { FastifyBaseLogger } from 'fastify';
import type { AlertingRepository } from './repository.js';
import type { ConnectorRepository } from '../connectors/repository.js';
import { type ConnectorJobName } from '../connectors/job.constants.js';
export interface BatchJobData {
    batchId: string;
    organizationId: string;
}
export interface BatchProcessSummary {
    batchId: string;
    total: number;
    success: number;
    failure: number;
    skipped: number;
    durationMs: number;
    status: 'completed' | 'partial' | 'failed';
}
type EnqueueConnectorJob = (queue: ConnectorJobName, data: Record<string, unknown>, options?: Record<string, unknown>) => Promise<unknown>;
export declare class AlertBatchProcessor {
    private readonly alertRepo;
    private readonly connectorRepo;
    private readonly enqueueConnectorJob;
    private readonly logger;
    constructor(alertRepo: AlertingRepository, connectorRepo: ConnectorRepository, enqueueConnectorJob: EnqueueConnectorJob, logger: FastifyBaseLogger);
    processBatch(data: BatchJobData): Promise<BatchProcessSummary>;
    /** Deliver a single event to all routed connectors concurrently. */
    private processSingleEvent;
    private deliverToConnector;
    private toPayload;
    private uniqueConnectorIds;
    private uniqueRouteIds;
    private resolveDeliveryTargets;
    private routeMatches;
    private routeMatchContext;
    private firstString;
    private toRouteEnvironment;
}
export {};
//# sourceMappingURL=batch-processor.d.ts.map