import { randomUUID } from 'crypto';
import { ConnectorRepository } from '../repository.js';
import { createConnector } from '../registry.js';
import { decryptConfig } from '../secrets/secret.service.js';
import { checkRateLimit, circuitAllows, recordCircuitFailure, recordCircuitSuccess, computeBackoffMs, } from '../runtime.js';
import {} from '../types.js';
export class NotificationDispatcher {
    repository;
    logger;
    constructor(repository, logger) {
        this.repository = repository;
        this.logger = logger;
    }
    /** Build a live connector instance from a stored config row. */
    instantiate(row) {
        const config = decryptConfig(row.encrypted_config);
        const ctx = {
            id: row.id,
            name: row.name,
            organizationId: row.organization_id,
            config,
            rateLimit: { requests: row.rate_limit_requests, windowSeconds: row.rate_limit_window_seconds },
            log: this.logger.child({ connectorId: row.id, connectorType: row.type }),
        };
        return createConnector(row.type, ctx);
    }
    /**
     * Dispatch a notification through a connector. Creates a delivery row and
     * runs the first attempt synchronously. Returns the outcome so callers
     * (e.g. the test-send endpoint) can surface immediate results.
     */
    async dispatch(row, payload, opts = {}) {
        const delivery = await this.repository.insertDelivery({
            organizationId: row.organization_id,
            connectorId: row.id,
            routeId: opts.routeId ?? null,
            notificationType: payload.notificationType,
            severity: payload.severity,
            payload: this.payloadForStorage(payload),
            maxAttempts: row.max_retries + 1,
            correlationId: payload.correlationId,
            parentDeliveryId: null,
            status: 'pending',
        });
        return this.attemptDelivery(row, delivery, payload, 0);
    }
    /** Process a single retry (invoked by the background worker). */
    async processRetry(row, delivery) {
        const payload = this.payloadFromStorage(delivery);
        return this.attemptDelivery(row, delivery, payload, delivery.attempts);
    }
    async attemptDelivery(row, delivery, payload, priorAttempts) {
        const log = this.logger.child({ connectorId: row.id, deliveryId: delivery.id, correlationId: payload.correlationId });
        // 1. Rate limit
        const rate = checkRateLimit(`connector:${row.id}`, row.rate_limit_requests, row.rate_limit_window_seconds);
        if (!rate.allowed) {
            return this.scheduleRetryOrFail(row, delivery, payload, priorAttempts, 'rate_limit', 'Local rate limit exceeded', true, rate.retryAfterMs, log);
        }
        // 2. Circuit breaker
        if (!circuitAllows(`connector:${row.id}`, { failureThreshold: row.failure_threshold })) {
            log.warn('Circuit open — short-circuiting delivery');
            return this.scheduleRetryOrFail(row, delivery, payload, priorAttempts, 'circuit_open', 'Circuit breaker open', true, undefined, log);
        }
        // 3. Deliver
        let result;
        try {
            const connector = this.instantiate(row);
            result = await connector.send(payload);
        }
        catch (err) {
            result = {
                success: false,
                errorMessage: err instanceof Error ? err.message : 'Connector instantiation failed',
                failureCategory: 'invalid_config',
                retryable: false,
                latencyMs: 0,
            };
        }
        if (result.success) {
            await this.repository.markDeliverySent(delivery.id, {
                externalMessageId: result.externalMessageId ?? null,
                responseStatusCode: result.statusCode ?? null,
                responseBody: result.responseBody ?? null,
                latencyMs: result.latencyMs,
            });
            await this.repository.recordSuccess(row.id);
            recordCircuitSuccess(`connector:${row.id}`);
            log.info({ latencyMs: result.latencyMs }, 'Notification delivered');
            return { deliveryId: delivery.id, status: 'sent', result };
        }
        // Failure path
        recordCircuitFailure(`connector:${row.id}`, { failureThreshold: row.failure_threshold });
        await this.repository.recordFailure(row.id);
        return this.scheduleRetryOrFail(row, delivery, payload, priorAttempts, result.failureCategory ?? 'unknown', result.errorMessage ?? 'Delivery failed', result.retryable ?? false, undefined, log);
    }
    async scheduleRetryOrFail(row, delivery, payload, priorAttempts, category, message, retryable, explicitDelayMs, log) {
        const attemptsSoFar = priorAttempts + 1;
        const maxAttempts = row.max_retries + 1;
        const canRetry = retryable && attemptsSoFar < maxAttempts;
        if (canRetry) {
            const delayMs = explicitDelayMs ?? computeBackoffMs(attemptsSoFar, row.retry_backoff_base_ms, Number(row.retry_backoff_multiplier));
            const nextRetryAt = new Date(Date.now() + delayMs);
            await this.repository.markDeliveryRetrying(delivery.id, nextRetryAt, message);
            log.warn({ category, attemptsSoFar, delayMs, nextRetryAt }, 'Delivery failed — scheduled for retry');
            return {
                deliveryId: delivery.id,
                status: 'retrying',
                result: { success: false, errorMessage: message, failureCategory: category, retryable: true, latencyMs: 0 },
            };
        }
        // Terminal failure → mark failed + dead-letter
        await this.repository.markDeliveryFailed(delivery.id, message, { category });
        await this.repository.insertDeadLetter({
            originalDeliveryId: delivery.id,
            organizationId: row.organization_id,
            connectorId: row.id,
            failureReason: message,
            failureCategory: category,
            errorStack: null,
            originalPayload: this.payloadForStorage(payload),
            retryAttempts: attemptsSoFar,
        });
        log.error({ category, attemptsSoFar }, 'Delivery permanently failed — moved to dead-letter');
        return {
            deliveryId: delivery.id,
            status: 'failed',
            result: { success: false, errorMessage: message, failureCategory: category, retryable: false, latencyMs: 0 },
        };
    }
    payloadForStorage(p) {
        // Persist the full payload so retries are self-contained. Strip undefined
        // keys so the stored JSON stays compact.
        const out = {};
        for (const [k, v] of Object.entries(p)) {
            if (v !== undefined)
                out[k] = v;
        }
        return out;
    }
    payloadFromStorage(delivery) {
        const p = delivery.payload;
        return {
            notificationType: p.notificationType ?? delivery.notification_type,
            severity: p.severity ?? delivery.severity,
            title: p.title ?? '',
            body: p.body ?? '',
            ...(p.fields ? { fields: p.fields } : {}),
            ...(p.url ? { url: p.url } : {}),
            ...(p.threadKey ? { threadKey: p.threadKey } : {}),
            ...(p.metadata ? { metadata: p.metadata } : {}),
            correlationId: p.correlationId ?? delivery.correlation_id,
            ...(p.dedupKey ? { dedupKey: p.dedupKey } : {}),
        };
    }
    /** Convenience for building a payload's correlation id when not supplied. */
    static newCorrelationId() {
        return randomUUID();
    }
}
//# sourceMappingURL=delivery.service.js.map