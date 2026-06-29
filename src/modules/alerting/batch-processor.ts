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
import { AlertingRepository, type DeliveryAttemptInsert } from './repository.js';
import { resolveRouting, type RoutableAlert } from './routing.js';
import type { AlertEventRow, AlertEventStatus, AlertRoutingRuleRow } from './types.js';
import { ConnectorRepository } from '../connectors/repository.js';
import { NotificationDispatcher } from '../connectors/dispatcher.js';
import {
  circuitAllows,
  recordCircuitFailure,
  recordCircuitSuccess,
} from '../connectors/runtime.js';
import type { ConnectorConfigRow, NotificationPayload, NotificationSeverity } from '../connectors/types.js';

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

/** Outcome of attempting to deliver one event to its routed connectors. */
interface EventOutcome {
  eventId: string;
  newStatus: AlertEventStatus;
  deliveries: DeliveryAttemptInsert[];
  delivered: boolean;
  skipped: boolean;
}

export class AlertBatchProcessor {
  constructor(
    private readonly alertRepo: AlertingRepository,
    private readonly connectorRepo: ConnectorRepository,
    private readonly dispatcher: NotificationDispatcher,
    private readonly logger: FastifyBaseLogger,
  ) {}

  async processBatch(data: BatchJobData): Promise<BatchProcessSummary> {
    const start = Date.now();
    const log = this.logger.child({ batchId: data.batchId, orgId: data.organizationId });

    // 1. Fetch batch + its events in a single query.
    const loaded = await this.alertRepo.getBatchWithEvents(data.batchId, data.organizationId);
    if (!loaded) {
      log.warn('Batch not found — nothing to process');
      return { batchId: data.batchId, total: 0, success: 0, failure: 0, skipped: 0, durationMs: 0, status: 'completed' };
    }
    const { events } = loaded;

    // 2. Load routing rules + every referenced connector in single queries.
    const routingRules = await this.alertRepo.listRoutingRules(data.organizationId);
    const connectorIds = this.uniqueConnectorIds(events, routingRules);
    const connectors = await this.connectorRepo.getByIds(connectorIds);
    const connectorMap = new Map<string, ConnectorConfigRow>(connectors.map((c) => [c.id, c]));

    // 3. Process ALL events concurrently. Promise.allSettled guarantees one
    //    failing event never aborts the batch.
    const settled = await Promise.allSettled(
      events.map((event) => this.processSingleEvent(event, routingRules, connectorMap, data.batchId)),
    );

    // 4. Fold results into bulk-update + bulk-insert payloads.
    const statusUpdates: Array<{ id: string; status: AlertEventStatus }> = [];
    const deliveryLogs: DeliveryAttemptInsert[] = [];
    let success = 0, failure = 0, skipped = 0;

    settled.forEach((res, i) => {
      const event = events[i]!;
      if (res.status === 'fulfilled') {
        const outcome = res.value;
        statusUpdates.push({ id: outcome.eventId, status: outcome.newStatus });
        deliveryLogs.push(...outcome.deliveries);
        if (outcome.skipped) skipped += 1;
        else if (outcome.delivered) success += 1;
        else failure += 1;
      } else {
        // Unexpected throw inside processing — mark event errored, count failure.
        statusUpdates.push({ id: event.id, status: 'error' });
        failure += 1;
        log.error({ err: res.reason, eventId: event.id }, 'Event processing rejected');
      }
    });

    // 5 + 6. Bulk update statuses and insert delivery attempts (one query each).
    await this.alertRepo.bulkUpdateEventStatus(data.organizationId, statusUpdates);
    await this.alertRepo.bulkInsertDeliveryAttempts(deliveryLogs);

    // 7. Mark the batch complete.
    const durationMs = Date.now() - start;
    const status: BatchProcessSummary['status'] = failure === 0 ? 'completed' : success === 0 ? 'failed' : 'partial';
    await this.alertRepo.completeBatch(
      data.batchId, { success, failure, skipped }, durationMs, status,
      failure > 0 ? `${failure}/${events.length} deliveries failed` : null,
    );

    log.info({ total: events.length, success, failure, skipped, durationMs, status }, 'Batch processed');
    return { batchId: data.batchId, total: events.length, success, failure, skipped, durationMs, status };
  }

  /** Deliver a single event to all routed connectors concurrently. */
  private async processSingleEvent(
    event: AlertEventRow,
    routingRules: AlertRoutingRuleRow[],
    connectorMap: Map<string, ConnectorConfigRow>,
    batchId: string,
  ): Promise<EventOutcome> {
    const routable: RoutableAlert = { severity: event.severity, source: event.source, labels: event.labels };
    const decision = resolveRouting(routable, routingRules);

    if (decision.connectorIds.length === 0) {
      // No route matched — nothing to deliver. Event still transitions to firing.
      return { eventId: event.id, newStatus: 'firing', deliveries: [], delivered: false, skipped: true };
    }

    const payload = this.toPayload(event);

    // Fan out to every target connector concurrently (Bulkhead per connector).
    const perConnector = await Promise.allSettled(
      decision.connectorIds.map((cid) => this.deliverToConnector(event, cid, connectorMap, decision.matchedRuleId, batchId, payload)),
    );

    const deliveries: DeliveryAttemptInsert[] = [];
    let anyDelivered = false;
    perConnector.forEach((res) => {
      if (res.status === 'fulfilled') {
        deliveries.push(res.value.log);
        if (res.value.delivered) anyDelivered = true;
      }
    });

    return {
      eventId: event.id,
      newStatus: anyDelivered ? 'firing' : 'error',
      deliveries,
      delivered: anyDelivered,
      skipped: false,
    };
  }

  private async deliverToConnector(
    event: AlertEventRow,
    connectorId: string,
    connectorMap: Map<string, ConnectorConfigRow>,
    routeId: string | null,
    batchId: string,
    payload: NotificationPayload,
  ): Promise<{ log: DeliveryAttemptInsert; delivered: boolean }> {
    const base: DeliveryAttemptInsert = {
      organizationId: event.organization_id,
      eventId: event.id,
      connectorId,
      routeId,
      batchId,
      status: 'pending',
      responseStatusCode: null,
      errorMessage: null,
      errorCategory: null,
      latencyMs: null,
      externalMessageId: null,
    };

    const connector = connectorMap.get(connectorId);
    if (!connector) {
      return { log: { ...base, status: 'failed', errorMessage: 'Connector not found or deleted', errorCategory: 'config' }, delivered: false };
    }

    // Circuit breaker (shared with the connectors feature).
    const cbKey = `connector:${connectorId}`;
    if (!circuitAllows(cbKey, { failureThreshold: connector.failure_threshold })) {
      return { log: { ...base, status: 'failed', errorMessage: 'Circuit breaker open', errorCategory: 'circuit_open' }, delivered: false };
    }

    try {
      const instance = this.dispatcher.instantiate(connector);
      const result = await instance.send(payload);
      if (result.success) {
        recordCircuitSuccess(cbKey);
        await this.connectorRepo.recordSuccess(connectorId);
        return {
          log: {
            ...base,
            status: 'sent',
            responseStatusCode: result.statusCode ?? null,
            latencyMs: result.latencyMs,
            externalMessageId: result.externalMessageId ?? null,
          },
          delivered: true,
        };
      }
      recordCircuitFailure(cbKey, { failureThreshold: connector.failure_threshold });
      await this.connectorRepo.recordFailure(connectorId);
      return {
        log: {
          ...base,
          status: 'failed',
          responseStatusCode: result.statusCode ?? null,
          errorMessage: (result.errorMessage ?? 'Delivery failed').slice(0, 2000),
          errorCategory: result.failureCategory ?? 'unknown',
          latencyMs: result.latencyMs,
        },
        delivered: false,
      };
    } catch (err) {
      recordCircuitFailure(cbKey, { failureThreshold: connector.failure_threshold });
      return {
        log: { ...base, status: 'failed', errorMessage: (err instanceof Error ? err.message : 'Unknown error').slice(0, 2000), errorCategory: 'unknown' },
        delivered: false,
      };
    }
  }

  private toPayload(event: AlertEventRow): NotificationPayload {
    const p = event.payload as Record<string, unknown>;
    const title = typeof p.title === 'string' ? p.title : `Alert: ${event.source}`;
    const body = typeof p.message === 'string' ? p.message
      : typeof p.body === 'string' ? p.body
      : `Severity ${event.severity} alert from ${event.source}`;
    return {
      notificationType: 'alert',
      severity: event.severity as NotificationSeverity,
      title,
      body,
      correlationId: event.id,
      dedupKey: event.fingerprint,
      metadata: { eventId: event.id, ruleId: event.rule_id, source: event.source, labels: event.labels },
    };
  }

  private uniqueConnectorIds(events: AlertEventRow[], routingRules: AlertRoutingRuleRow[]): string[] {
    const ids = new Set<string>();
    for (const event of events) {
      const decision = resolveRouting(
        { severity: event.severity, source: event.source, labels: event.labels },
        routingRules,
      );
      decision.connectorIds.forEach((id) => ids.add(id));
    }
    return [...ids];
  }
}
