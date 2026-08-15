import { randomUUID } from 'crypto';
import { pgboss } from '../../../lib/pgboss.js';
import { ConnectorRepository } from '../repository.js';
import { createConnector } from '../registry.js';
import { decryptConfigAsync } from '../secrets/secret.service.js';
import { computeBackoffMs } from '../runtime.js';
import {} from '../types.js';
export class NotificationDispatcher {
    repository;
    logger;
    emitEvent;
    constructor(repository, logger, emitEvent = () => { }) {
        this.repository = repository;
        this.logger = logger;
        this.emitEvent = emitEvent;
    }
    /** Build a live connector instance from a stored config row. */
    async instantiate(row) {
        const config = await decryptConfigAsync(row.encrypted_config);
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
        // BUG-09: Deduplication / suppression window
        if (payload.dedupKey) {
            const recent = await this.repository.findDeliveryByDedupKey(row.id, payload.dedupKey, 5);
            if (recent) {
                this.logger.info({ dedupKey: payload.dedupKey }, 'Delivery suppressed due to recent identical payload');
                const suppressed = await this.repository.insertDelivery({
                    organizationId: row.organization_id,
                    connectorId: row.id,
                    routeId: opts.routeId ?? null,
                    notificationType: payload.notificationType,
                    severity: payload.severity,
                    payload: this.payloadForStorage(payload),
                    maxAttempts: 1,
                    correlationId: payload.correlationId,
                    parentDeliveryId: null,
                    status: 'suppressed',
                });
                return {
                    deliveryId: suppressed.id,
                    status: 'suppressed',
                    result: { success: true, latencyMs: 0 },
                };
            }
        }
        // BUG-03: Idempotent dispatch
        const { row: delivery, existed } = await this.repository.insertDeliveryIdempotent({
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
        if (existed && delivery.status === 'sent') {
            return { deliveryId: delivery.id, status: 'sent', result: { success: true, latencyMs: 0 } };
        }
        return this.attemptDelivery(row, delivery, payload, existed ? delivery.attempts : 0);
    }
    /** Process a single retry (invoked by the background worker). */
    async processRetry(row, delivery) {
        const payload = this.payloadFromStorage(delivery);
        return this.attemptDelivery(row, delivery, payload, delivery.attempts);
    }
    async attemptDelivery(row, delivery, payload, priorAttempts) {
        const log = this.logger.child({ connectorId: row.id, deliveryId: delivery.id, correlationId: payload.correlationId });
        // 1. Rate limit
        const rate = typeof this.repository.consumeRateLimitToken === 'function'
            ? await this.repository.consumeRateLimitToken(row.id, row.rate_limit_requests ?? 100, row.rate_limit_window_seconds ?? 60)
            : { allowed: true, retryAfterMs: 0 };
        if (!rate.allowed) {
            return this.scheduleRetryOrFail(row, delivery, payload, priorAttempts, 'rate_limit', 'Global rate limit exceeded', true, rate.retryAfterMs, log);
        }
        const CIRCUIT_RESET_MS = 30_000;
        const circuitAllowed = typeof this.repository.circuitAllows === 'function'
            ? await this.repository.circuitAllows(row.id, CIRCUIT_RESET_MS)
            : true;
        if (!circuitAllowed) {
            log.warn('Circuit open — short-circuiting delivery');
            return this.scheduleRetryOrFail(row, delivery, payload, priorAttempts, 'circuit_open', 'Circuit breaker open', true, undefined, log);
        }
        // 3. Deliver
        let result;
        try {
            const connector = await this.instantiate(row);
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
            if (typeof this.repository.recordSuccess === 'function')
                await this.repository.recordSuccess(row.id);
            await this.recordUsage(row, payload, log);
            await this.repository.insertAuditLog({
                organizationId: row.organization_id,
                connectorId: row.id,
                action: 'delivery.sent',
                actorId: null,
                changesSummary: {
                    deliveryId: delivery.id,
                    statusCode: result.statusCode ?? null,
                    latencyMs: result.latencyMs,
                    externalMessageId: result.externalMessageId ?? null,
                },
            });
            if (typeof this.repository.recordCircuitSuccess === 'function')
                await this.repository.recordCircuitSuccess(row.id);
            log.info({ latencyMs: result.latencyMs }, 'Notification delivered');
            return { deliveryId: delivery.id, status: 'sent', result };
        }
        // Failure path
        const circuitState = typeof this.repository.recordCircuitFailure === 'function'
            ? await this.repository.recordCircuitFailure(row.id, row.failure_threshold ?? 5)
            : 'closed';
        if (typeof this.repository.recordFailure === 'function')
            await this.repository.recordFailure(row.id);
        if (circuitState === 'open') {
            await this.enqueueConnectorFailureAlert(row, delivery.id, result.errorMessage ?? 'Delivery failed', log);
        }
        return this.scheduleRetryOrFail(row, delivery, payload, priorAttempts, result.failureCategory ?? 'unknown', result.errorMessage ?? 'Delivery failed', result.retryable ?? false, undefined, log);
    }
    async enqueueConnectorFailureAlert(row, deliveryId, errorMessage, log) {
        try {
            await pgboss.send('alert.evaluate.fast', {
                organizationId: row.organization_id,
                projectId: row.project_id,
                signals: [{
                        projectId: row.project_id,
                        source: 'connector',
                        kind: 'open_circuit',
                        labels: { connector_id: row.id, connector_type: row.type },
                        evidence: {
                            connectorId: row.id,
                            connectorType: row.type,
                            deliveryId,
                            errorMessage,
                        },
                    }],
            }, {
                singletonKey: `connector-open-circuit:${row.id}:${Math.floor(Date.now() / 30_000)}`,
                expireInSeconds: 60,
                retryLimit: 1,
                retryDelay: 5,
            });
        }
        catch (err) {
            log.warn({ err, connectorId: row.id }, 'Failed to enqueue connector open-circuit alert');
        }
    }
    async scheduleRetryOrFail(row, delivery, payload, priorAttempts, category, message, retryable, explicitDelayMs, log) {
        const attemptsSoFar = priorAttempts + 1;
        const maxAttempts = row.max_retries + 1;
        const isPermanent = category === 'auth_error' || category === 'invalid_config' || category === 'invalid_payload';
        const canRetry = retryable && !isPermanent && attemptsSoFar < maxAttempts;
        if (canRetry) {
            const delayMs = explicitDelayMs ?? computeBackoffMs(attemptsSoFar, row.retry_backoff_base_ms, Number(row.retry_backoff_multiplier));
            const nextRetryAt = new Date(Date.now() + delayMs);
            await this.repository.markDeliveryRetrying(delivery.id, nextRetryAt, message);
            await this.repository.insertAuditLog({
                organizationId: row.organization_id,
                connectorId: row.id,
                action: 'delivery.retry_scheduled',
                actorId: null,
                changesSummary: {
                    deliveryId: delivery.id,
                    category,
                    attemptsSoFar,
                    nextRetryAt: nextRetryAt.toISOString(),
                },
            });
            log.warn({ category, attemptsSoFar, delayMs, nextRetryAt }, 'Delivery failed — scheduled for retry');
            return {
                deliveryId: delivery.id,
                status: 'retrying',
                result: { success: false, errorMessage: message, failureCategory: category, retryable: true, latencyMs: 0 },
            };
        }
        // Terminal failure → mark failed + dead-letter
        await this.repository.markDeliveryFailed(delivery.id, message, { category });
        await this.repository.insertAuditLog({
            organizationId: row.organization_id,
            connectorId: row.id,
            action: 'delivery.failed',
            actorId: null,
            changesSummary: {
                deliveryId: delivery.id,
                category,
                attemptsSoFar,
                retryable,
            },
        });
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
        this.emitEvent('connector.dead_letter', {
            orgId: row.organization_id,
            connectorId: row.id,
            deliveryId: delivery.id,
            category,
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
    async recordUsage(row, payload, log) {
        try {
            const projectId = typeof payload.metadata?.projectId === 'string'
                ? payload.metadata.projectId
                : typeof payload.metadata?.project_id === 'string' ? payload.metadata.project_id : null;
            await this.repository.recordSuccessfulDeliveryUsage(row.organization_id, projectId, row.type);
        }
        catch (err) {
            log.error({ err }, 'Connector delivery usage accounting failed');
        }
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