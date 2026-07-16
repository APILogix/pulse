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
 * Delivery reuses the connector module by enqueuing connector-send jobs. This
 * batch processor resolves routes and records queued attempts; connector
 * pg-boss workers perform provider I/O and connector delivery bookkeeping.
 */
import type { FastifyBaseLogger } from 'fastify';
import type { AlertingRepository, DeliveryAttemptInsert } from './repository.js';
import { resolveRouting, type RoutableAlert } from './routing.js';
import type { AlertEventRow, AlertEventStatus, AlertRoutingRuleRow } from './types.js';
import type { ConnectorRepository } from '../connectors/repository.js';
import type {
  ConnectorConfigRow,
  ConnectorRouteEnvironment,
  ConnectorRouteRow,
  NotificationPayload,
  NotificationSeverity,
} from '../connectors/types.js';
import { CONNECTOR_JOBS, CONNECTOR_PRIORITY, type ConnectorJobName } from '../connectors/job.constants.js';
import { env } from '../../config/env.js';

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

interface DeliveryTarget {
  connectorId: string;
  routeId: string | null;
}

interface RouteMatchContext {
  projectId: string | null;
  environment: ConnectorRouteEnvironment | null;
  eventType: string;
  severity: NotificationSeverity;
}

type EnqueueConnectorJob = (
  queue: ConnectorJobName,
  data: Record<string, unknown>,
  options?: Record<string, unknown>,
) => Promise<unknown>;

export class AlertBatchProcessor {
  private static readonly EVENT_CONCURRENCY = 10;

  constructor(
    private readonly alertRepo: AlertingRepository,
    private readonly connectorRepo: ConnectorRepository,
    private readonly enqueueConnectorJob: EnqueueConnectorJob,
    private readonly logger: FastifyBaseLogger,
  ) {}

  private async mapBounded<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
    const results: PromiseSettledResult<R>[] = new Array(items.length);
    let cursor = 0;
    const lane = async (): Promise<void> => {
      while (cursor < items.length) {
        const i = cursor++;
        const item = items[i]!;
        try { results[i] = { status: 'fulfilled', value: await fn(item) }; }
        catch (reason) { results[i] = { status: 'rejected', reason }; }
      }
    };
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
    return results;
  }

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
    const connectorRoutes = await this.connectorRepo.listRoutesByIds(
      data.organizationId,
      this.uniqueRouteIds(routingRules),
    );
    const connectorIds = this.uniqueConnectorIds(events, routingRules, connectorRoutes);
    const connectors = await this.connectorRepo.getByIds(connectorIds);
    const connectorMap = new Map<string, ConnectorConfigRow>(connectors.map((c) => [c.id, c]));

    // 3. Process ALL events concurrently but bounded. Promise.allSettled guarantees one
    //    failing event never aborts the batch.
    const settled = await this.mapBounded(
      events,
      AlertBatchProcessor.EVENT_CONCURRENCY,
      (event) => this.processSingleEvent(event, routingRules, connectorRoutes, connectorMap, data.batchId),
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
    connectorRoutes: ConnectorRouteRow[],
    connectorMap: Map<string, ConnectorConfigRow>,
    batchId: string,
  ): Promise<EventOutcome> {
    const routable: RoutableAlert = { severity: event.severity, source: event.source, labels: event.labels };
    const decision = resolveRouting(routable, routingRules);
    const targets = this.resolveDeliveryTargets(event, decision.connectorIds, decision.routeIds, connectorRoutes);

    if (targets.length === 0) {
      // No route matched — nothing to deliver. Event still transitions to firing.
      return { eventId: event.id, newStatus: 'firing', deliveries: [], delivered: false, skipped: true };
    }

    const payload = this.toPayload(event);

    // Fan out to every target connector concurrently (Bulkhead per connector).
    const perConnector = await Promise.allSettled(
      targets.map((target) => this.deliverToConnector(event, target, connectorMap, batchId, payload)),
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
    target: DeliveryTarget,
    connectorMap: Map<string, ConnectorConfigRow>,
    batchId: string,
    payload: NotificationPayload,
  ): Promise<{ log: DeliveryAttemptInsert; delivered: boolean }> {
    const { connectorId, routeId } = target;
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

    try {
      const queueName = `${CONNECTOR_JOBS.send}-${connector.type}` as ConnectorJobName;
      const priority = CONNECTOR_PRIORITY[event.severity] ?? 0;

      const jobId = await this.enqueueConnectorJob(
        queueName,
        {
          organizationId: event.organization_id,
          connectorId,
          payload,
          routeId,
        },
        { 
          priority,
          retryLimit: 0, 
          retryDelay: 60, 
          retryBackoff: true, 
          expireInSeconds: env.CONNECTOR_SEND_EXPIRE_SECONDS 
        },
      );
      return {
        log: {
          ...base,
          status: 'queued',
          externalMessageId: typeof jobId === 'string' ? jobId : null,
        },
        delivered: true,
      };
    } catch (err) {
      return {
        log: {
          ...base,
          status: 'failed',
          errorMessage: (err instanceof Error ? err.message : 'Connector enqueue failed').slice(0, 2000),
          errorCategory: 'queue',
        },
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

  private uniqueConnectorIds(
    events: AlertEventRow[],
    routingRules: AlertRoutingRuleRow[],
    connectorRoutes: ConnectorRouteRow[],
  ): string[] {
    const ids = new Set<string>();
    for (const event of events) {
      const decision = resolveRouting(
        { severity: event.severity, source: event.source, labels: event.labels },
        routingRules,
      );
      this.resolveDeliveryTargets(event, decision.connectorIds, decision.routeIds, connectorRoutes)
        .forEach((target) => ids.add(target.connectorId));
    }
    return [...ids];
  }

  private uniqueRouteIds(routingRules: AlertRoutingRuleRow[]): string[] {
    const ids = new Set<string>();
    for (const rule of routingRules) {
      for (const routeId of rule.target_route_ids ?? []) ids.add(routeId);
    }
    return [...ids];
  }

  private resolveDeliveryTargets(
    event: AlertEventRow,
    connectorIds: string[],
    routeIds: string[],
    connectorRoutes: ConnectorRouteRow[],
  ): DeliveryTarget[] {
    const targets = new Map<string, DeliveryTarget>();
    for (const connectorId of connectorIds) {
      targets.set(`${connectorId}:direct`, { connectorId, routeId: null });
    }

    if (routeIds.length === 0) return [...targets.values()];

    const routeIdSet = new Set(routeIds);
    const context = this.routeMatchContext(event);
    for (const route of connectorRoutes) {
      if (!routeIdSet.has(route.id)) continue;
      if (!this.routeMatches(route, context)) continue;
      targets.set(`${route.connector_id}:${route.id}`, {
        connectorId: route.connector_id,
        routeId: route.id,
      });
    }
    return [...targets.values()];
  }

  private routeMatches(route: ConnectorRouteRow, context: RouteMatchContext): boolean {
    if (route.project_id !== null && route.project_id !== context.projectId) return false;
    if (route.environment !== null && route.environment !== context.environment) return false;
    if (route.severity !== null && route.severity !== context.severity) return false;
    return route.event_type === context.eventType;
  }

  private routeMatchContext(event: AlertEventRow): RouteMatchContext {
    const payload = event.payload as Record<string, unknown>;
    const projectId = this.firstString(payload.projectId, payload.project_id, event.labels.projectId, event.labels.project_id);
    const environment = this.toRouteEnvironment(this.firstString(
      payload.environment,
      payload.env,
      event.labels.environment,
      event.labels.env,
    ));
    const eventType = this.firstString(
      payload.eventType,
      payload.event_type,
      payload.notificationType,
      payload.type,
      event.source,
    ) ?? event.source;

    return {
      projectId,
      environment,
      eventType,
      severity: event.severity as NotificationSeverity,
    };
  }

  private firstString(...values: unknown[]): string | null {
    for (const value of values) {
      if (typeof value === 'string' && value.trim().length > 0) return value.trim();
    }
    return null;
  }

  private toRouteEnvironment(value: string | null): ConnectorRouteEnvironment | null {
    return value === 'development' || value === 'staging' || value === 'production' ? value : null;
  }
}
