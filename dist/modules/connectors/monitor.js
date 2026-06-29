import { ConnectorRepository } from './repository.js';
import { NotificationDispatcher } from './dispatcher.js';
import { ConnectorService } from './service.js';
import { sweepRateLimiter } from './runtime.js';
const DEFAULTS = {
    retryIntervalMs: 15_000,
    healthIntervalMs: 5 * 60_000,
    retryBatchSize: 25,
    enableHealthChecks: true,
};
export class ConnectorMonitor {
    repository;
    dispatcher;
    service;
    logger;
    retryTimer = null;
    healthTimer = null;
    sweepTimer = null;
    retrying = false;
    healthChecking = false;
    opts;
    constructor(repository, dispatcher, service, logger, options = {}) {
        this.repository = repository;
        this.dispatcher = dispatcher;
        this.service = service;
        this.logger = logger;
        this.opts = { ...DEFAULTS, ...options };
    }
    start() {
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
    stop() {
        if (this.retryTimer)
            clearInterval(this.retryTimer);
        if (this.healthTimer)
            clearInterval(this.healthTimer);
        if (this.sweepTimer)
            clearInterval(this.sweepTimer);
        this.retryTimer = this.healthTimer = this.sweepTimer = null;
    }
    /** Claim and process due retries. Returns the number processed. */
    async processRetries() {
        if (this.retrying)
            return 0;
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
                }
                catch (err) {
                    this.logger.error({ err, deliveryId: delivery.id }, 'Retry processing threw');
                }
            }
            if (processed > 0)
                this.logger.debug({ processed }, 'Processed connector retries');
        }
        catch (err) {
            this.logger.error({ err }, 'Retry sweep failed');
        }
        finally {
            this.retrying = false;
        }
        return processed;
    }
    /** Run heartbeat checks against monitorable connectors. */
    async runHealthChecks() {
        if (this.healthChecking)
            return 0;
        this.healthChecking = true;
        let checked = 0;
        try {
            const rows = await this.repository.listMonitorable();
            for (const row of rows) {
                try {
                    await this.service.runHealthCheck(row);
                    checked += 1;
                }
                catch (err) {
                    this.logger.warn({ err, connectorId: row.id }, 'Health check threw');
                }
            }
            if (checked > 0)
                this.logger.debug({ checked }, 'Ran connector health checks');
        }
        catch (err) {
            this.logger.error({ err }, 'Health sweep failed');
        }
        finally {
            this.healthChecking = false;
        }
        return checked;
    }
}
//# sourceMappingURL=monitor.js.map