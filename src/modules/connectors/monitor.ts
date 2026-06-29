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
import { NotificationDispatcher } from './dispatcher.js';
import { ConnectorService } from './service.js';
import { sweepRateLimiter } from './runtime.js';

export interface MonitorOptions {
  retryIntervalMs?: number;
  healthIntervalMs?: number;
  retryBatchSize?: number;
  enableHealthChecks?: boolean;
}

const DEFAULTS = {
  retryIntervalMs: 15_000,
  healthIntervalMs: 5 * 60_000,
  retryBatchSize: 25,
  enableHealthChecks: true,
} as const;

export class ConnectorMonitor {
  private retryTimer: NodeJS.Timeout | null = null;
  private healthTimer: NodeJS.Timeout | null = null;
  private sweepTimer: NodeJS.Timeout | null = null;
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

  start(): void {
    this.retryTimer = setInterval(() => void this.processRetries(), this.opts.retryIntervalMs);
    this.retryTimer.unref();

    if (this.opts.enableHealthChecks) {
      this.healthTimer = setInterval(() => void this.runHealthChecks(), this.opts.healthIntervalMs);
      this.healthTimer.unref();
    }

    this.sweepTimer = setInterval(() => sweepRateLimiter(), 60_000);
    this.sweepTimer.unref();

    this.logger.info({ ...this.opts }, 'Connector monitor started');
  }

  stop(): void {
    if (this.retryTimer) clearInterval(this.retryTimer);
    if (this.healthTimer) clearInterval(this.healthTimer);
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    this.retryTimer = this.healthTimer = this.sweepTimer = null;
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
