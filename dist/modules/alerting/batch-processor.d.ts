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
 * Delivery reuses the connector module: the same NotificationDispatcher used
 * by the connectors feature instantiates a live connector and the per-connector
 * circuit breaker / rate limiter from connectors/runtime guard the external API
 * (Bulkhead: a slow connector only blocks its own events, never the batch).
 */
import type { FastifyBaseLogger } from 'fastify';
import { AlertingRepository } from './repository.js';
import { ConnectorRepository } from '../connectors/repository.js';
import { NotificationDispatcher } from '../connectors/delivery/delivery.service.js';
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
export declare class AlertBatchProcessor {
    private readonly alertRepo;
    private readonly connectorRepo;
    private readonly dispatcher;
    private readonly logger;
    constructor(alertRepo: AlertingRepository, connectorRepo: ConnectorRepository, dispatcher: NotificationDispatcher, logger: FastifyBaseLogger);
    processBatch(data: BatchJobData): Promise<BatchProcessSummary>;
    /** Deliver a single event to all routed connectors concurrently. */
    private processSingleEvent;
    private deliverToConnector;
    private toPayload;
    private uniqueConnectorIds;
}
//# sourceMappingURL=batch-processor.d.ts.map