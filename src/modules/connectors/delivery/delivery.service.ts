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
import { randomUUID } from 'crypto';
import { ConnectorRepository } from '../repository.js';
import { createConnector } from '../registry.js';
import { decryptConfigAsync } from '../secrets/secret.service.js';
import {
  checkRateLimit,
  recordCircuitFailure,
  recordCircuitSuccess,
  computeBackoffMs,
} from '../runtime.js';
import type { BaseConnector } from '../shared/base.connector.js';
import {
  type ConnectorConfigRow,
  type ConnectorContext,
  type DeliveryResult,
  type DeliveryRow,
  type FailureCategory,
  type NotificationPayload,
} from '../types.js';

export interface DispatchOutcome {
  deliveryId: string;
  status: DeliveryRow['status'];
  result: DeliveryResult;
}

export class NotificationDispatcher {
  constructor(
    private readonly repository: ConnectorRepository,
    private readonly logger: FastifyBaseLogger,
    private readonly emitEvent: (event: string, payload: any) => void = () => {},
  ) {}

  /** Build a live connector instance from a stored config row. */
  async instantiate(row: ConnectorConfigRow): Promise<BaseConnector> {
    const config = await decryptConfigAsync(row.encrypted_config);
    const ctx: ConnectorContext = {
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
  async dispatch(
    row: ConnectorConfigRow,
    payload: NotificationPayload,
    opts: { routeId?: string | null } = {},
  ): Promise<DispatchOutcome> {
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
          status: 'suppressed' as any,
        });
        return {
          deliveryId: suppressed.id,
          status: 'suppressed' as any,
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
  async processRetry(row: ConnectorConfigRow, delivery: DeliveryRow): Promise<DispatchOutcome> {
    const payload = this.payloadFromStorage(delivery);
    return this.attemptDelivery(row, delivery, payload, delivery.attempts);
  }

  private circuitOpen(row: ConnectorConfigRow): boolean {
    if (row.consecutive_failures < row.failure_threshold) return false;
    const CIRCUIT_RESET_MS = 30_000;
    return Date.now() - new Date(row.updated_at).getTime() < CIRCUIT_RESET_MS;
  }

  private async attemptDelivery(
    row: ConnectorConfigRow,
    delivery: DeliveryRow,
    payload: NotificationPayload,
    priorAttempts: number,
  ): Promise<DispatchOutcome> {
    const log = this.logger.child({ connectorId: row.id, deliveryId: delivery.id, correlationId: payload.correlationId });

    // 1. Rate limit
    const rate = checkRateLimit(
      `connector:${row.id}`,
      row.rate_limit_requests,
      row.rate_limit_window_seconds,
    );
    if (!rate.allowed) {
      return this.scheduleRetryOrFail(
        row, delivery, payload, priorAttempts,
        'rate_limit', 'Local rate limit exceeded', true, rate.retryAfterMs, log,
      );
    }

    // 2. Circuit breaker
    if (this.circuitOpen(row)) {
      log.warn('Circuit open — short-circuiting delivery');
      return this.scheduleRetryOrFail(
        row, delivery, payload, priorAttempts,
        'circuit_open', 'Circuit breaker open', true, undefined, log,
      );
    }

    // 3. Deliver
    let result: DeliveryResult;
    try {
      const connector = await this.instantiate(row);
      result = await connector.send(payload);
    } catch (err) {
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
      recordCircuitSuccess(`connector:${row.id}`);
      log.info({ latencyMs: result.latencyMs }, 'Notification delivered');
      return { deliveryId: delivery.id, status: 'sent', result };
    }

    // Failure path
    recordCircuitFailure(`connector:${row.id}`, { failureThreshold: row.failure_threshold });
    await this.repository.recordFailure(row.id);

    return this.scheduleRetryOrFail(
      row, delivery, payload, priorAttempts,
      result.failureCategory ?? 'unknown',
      result.errorMessage ?? 'Delivery failed',
      result.retryable ?? false,
      undefined,
      log,
    );
  }

  private async scheduleRetryOrFail(
    row: ConnectorConfigRow,
    delivery: DeliveryRow,
    payload: NotificationPayload,
    priorAttempts: number,
    category: FailureCategory,
    message: string,
    retryable: boolean,
    explicitDelayMs: number | undefined,
    log: FastifyBaseLogger,
  ): Promise<DispatchOutcome> {
    const attemptsSoFar = priorAttempts + 1;
    const maxAttempts = row.max_retries + 1;
    const canRetry = retryable && attemptsSoFar < maxAttempts;

    if (canRetry) {
      const delayMs = explicitDelayMs ?? computeBackoffMs(
        attemptsSoFar,
        row.retry_backoff_base_ms,
        Number(row.retry_backoff_multiplier),
      );
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

  private payloadForStorage(p: NotificationPayload): Record<string, unknown> {
    // Persist the full payload so retries are self-contained. Strip undefined
    // keys so the stored JSON stays compact.
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(p)) {
      if (v !== undefined) out[k] = v;
    }
    return out;
  }

  private payloadFromStorage(delivery: DeliveryRow): NotificationPayload {
    const p = delivery.payload as Partial<NotificationPayload>;
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
  static newCorrelationId(): string {
    return randomUUID();
  }
}
