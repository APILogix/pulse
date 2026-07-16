/**
 * Notification dispatcher.
 *
 * Responsible for actually delivering a {@link NotificationPayload} through a
 * connector while enforcing the reliability envelope:
 *   - per-connector rate limiting
 *   - circuit breaker around the external API
 *   - delivery record bookkeeping (connector_deliveries)
 *   - retry scheduling with exponential backoff + jitter
 *   - dead-letter on exhausted/non-retryable failures
 *
 * The dispatcher is transport-agnostic: a foreground call (test send) and the
 * background retry worker both funnel through `attemptDelivery`.
 */
import type { FastifyBaseLogger } from 'fastify';
import { ConnectorRepository } from '../repository.js';
import type { BaseConnector } from '../shared/base.connector.js';
import { type ConnectorConfigRow, type DeliveryResult, type DeliveryRow, type NotificationPayload } from '../types.js';
export interface DispatchOutcome {
    deliveryId: string;
    status: DeliveryRow['status'];
    result: DeliveryResult;
}
export declare class NotificationDispatcher {
    private readonly repository;
    private readonly logger;
    private readonly emitEvent;
    constructor(repository: ConnectorRepository, logger: FastifyBaseLogger, emitEvent?: (event: string, payload: any) => void);
    /** Build a live connector instance from a stored config row. */
    instantiate(row: ConnectorConfigRow): Promise<BaseConnector>;
    /**
     * Dispatch a notification through a connector. Creates a delivery row and
     * runs the first attempt synchronously. Returns the outcome so callers
     * (e.g. the test-send endpoint) can surface immediate results.
     */
    dispatch(row: ConnectorConfigRow, payload: NotificationPayload, opts?: {
        routeId?: string | null;
    }): Promise<DispatchOutcome>;
    /** Process a single retry (invoked by the background worker). */
    processRetry(row: ConnectorConfigRow, delivery: DeliveryRow): Promise<DispatchOutcome>;
    private circuitOpen;
    private attemptDelivery;
    private scheduleRetryOrFail;
    private payloadForStorage;
    private payloadFromStorage;
    /** Convenience for building a payload's correlation id when not supplied. */
    static newCorrelationId(): string;
}
//# sourceMappingURL=delivery.service.d.ts.map