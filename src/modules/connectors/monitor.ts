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

export interface MonitorOptions {
  retryBatchSize?: number;
  enableHealthChecks?: boolean;
}

const DEFAULTS = {
  retryBatchSize: 25,
  enableHealthChecks: true,
} as const;

export class ConnectorMonitor {
  private retrying = false;
  private healthChecking = false;
  private readonly opts: Required<MonitorOptions>;

  constructor(
    private readonly repository: ConnectorRepository,
    private readonly dispatcher: NotificationDispatcher,
    private readonly service: ConnectorService,
    private readonly logger: FastifyBaseLogger,
    options: MonitorOptions = {},
  ) {
    this.opts = { ...DEFAULTS, ...options };
  }

  stop(): void {
    this.retrying = false;
    this.healthChecking = false;
  }

  /** Claim and process due retries. Returns the number processed. */
  async processRetries(): Promise<number> {
    if (this.retrying) return 0;
    this.retrying = true;
    let processed = 0;
    try {
      const due = await this.repository.claimRetryableDeliveries(this.opts.retryBatchSize);
      for (const delivery of due) {
        const row = await this.repository.findByIdInternal(delivery.connector_id);
        if (!row) {
          // Connector deleted out from under a pending retry — fail it cleanly.
          await this.repository.markDeliveryFailed(delivery.id, 'Connector no longer exists', { category: 'invalid_config' });
          continue;
        }
        try {
          await this.dispatcher.processRetry(row, delivery);
          processed += 1;
        } catch (err) {
          this.logger.error({ err, deliveryId: delivery.id }, 'Retry processing threw');
        }
      }
      if (processed > 0) this.logger.debug({ processed }, 'Processed connector retries');
    } catch (err) {
      this.logger.error({ err }, 'Retry sweep failed');
    } finally {
      this.retrying = false;
    }
    return processed;
  }

  /** Run heartbeat checks against monitorable connectors. */
  async runHealthChecks(): Promise<number> {
    if (this.healthChecking) return 0;
    this.healthChecking = true;
    let checked = 0;
    try {
      const rows = await this.repository.listMonitorable();
      for (const row of rows) {
        try {
          await this.service.runHealthCheck(row);
          checked += 1;
        } catch (err) {
          this.logger.warn({ err, connectorId: row.id }, 'Health check threw');
        }
      }
      if (checked > 0) this.logger.debug({ checked }, 'Ran connector health checks');
    } catch (err) {
      this.logger.error({ err }, 'Health sweep failed');
    } finally {
      this.healthChecking = false;
    }
    return checked;
  }
}
