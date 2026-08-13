/**
 * Connector background operations.
 *
 * These methods are invoked by pg-boss workers in queue.ts. There are no
 * process-local intervals here; delivery and health cadence is database-backed.
 */
import type { FastifyBaseLogger } from 'fastify';
import { ConnectorRepository } from './repository.js';
import { NotificationDispatcher } from './delivery/delivery.service.js';
import { ConnectorService } from './service.js';
import { NotificationEntitlementService } from '../alerting/runtime/notification-entitlement.service.js';
export interface MonitorOptions {
    retryBatchSize?: number;
    enableHealthChecks?: boolean;
}
export declare class ConnectorMonitor {
    private readonly repository;
    private readonly dispatcher;
    private readonly service;
    private readonly logger;
    private readonly entitlement;
    private retrying;
    private healthChecking;
    private readonly opts;
    constructor(repository: ConnectorRepository, dispatcher: NotificationDispatcher, service: ConnectorService, logger: FastifyBaseLogger, options?: MonitorOptions, entitlement?: NotificationEntitlementService);
    stop(): void;
    /** Claim and process due retries. Returns the number processed. */
    processRetries(): Promise<number>;
    /** Run heartbeat checks against monitorable connectors. */
    runHealthChecks(): Promise<number>;
}
//# sourceMappingURL=monitor.d.ts.map