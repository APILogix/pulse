/**
 * Connector background monitor.
 *
 * Two periodic loops:
 *   - Retry sweep: claims due `retrying` deliveries (SKIP LOCKED) and runs the
 *     next attempt through the dispatcher. Safe to run in multiple processes.
 *   - Health sweep: runs heartbeat checks against active/error connectors and
 *     records results so dashboards and alerting can observe connector health.
 *
 * Timers are `unref()`'d so they never keep the process alive, and the sweep
 * functions are guarded against overlapping runs.
 */
import type { FastifyBaseLogger } from 'fastify';
import { ConnectorRepository } from './repository.js';
import { NotificationDispatcher } from './delivery/delivery.service.js';
import { ConnectorService } from './service.js';
export interface MonitorOptions {
    retryIntervalMs?: number;
    healthIntervalMs?: number;
    retryBatchSize?: number;
    enableHealthChecks?: boolean;
}
export declare class ConnectorMonitor {
    private readonly repository;
    private readonly dispatcher;
    private readonly service;
    private readonly logger;
    private retryTimer;
    private healthTimer;
    private sweepTimer;
    private retrying;
    private healthChecking;
    private readonly opts;
    constructor(repository: ConnectorRepository, dispatcher: NotificationDispatcher, service: ConnectorService, logger: FastifyBaseLogger, options?: MonitorOptions);
    start(): void;
    stop(): void;
    /** Claim and process due retries. Returns the number processed. */
    processRetries(): Promise<number>;
    /** Run heartbeat checks against monitorable connectors. */
    runHealthChecks(): Promise<number>;
}
//# sourceMappingURL=monitor.d.ts.map