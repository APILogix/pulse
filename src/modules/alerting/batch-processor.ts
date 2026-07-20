/**
 * Alert event batch processor (CRITICAL performance path).
 *
 * Processes a batch of up to 100 alert events with STRICT concurrency rules:
 *   - ALL per-event work runs concurrently via a bounded lane map — there is
 *     NO sequential `for`/`forEach` over events doing async work.
 *   - Routing rules, rule actions, connectors, routes, escalation steps and
 *     throttle windows are fetched in ONE bulk query each (no N+1).
 *   - Event status updates and delivery-attempt logs are written with ONE
 *     bulk statement each (UNNEST), not per row.
 *
 * Delivery model (enterprise):
 *   - Targets come from BOTH the rule's own actions (notify/webhook with
 *     connector/route refs) and the org's routing rules, deduplicated per
 *     connector+route pair.
 *   - Rule actions with throttle settings are enforced via
 *     `alert_throttle_windows`; throttled targets are skipped and logged as
 *     cancelled attempts (error_category 'throttled').
 *   - When an event fires and its rule has an `escalate` action, escalation
 *     tracking is initialized (policy + first-step wait) so the
 *     `alert.escalation-sweep` worker can advance it.
 *
 * Delivery reuses the connector module by enqueuing connector-send jobs. This
 * batch processor resolves routes and records queued attempts; connector
 * pg-boss workers perform provider I/O and connector delivery bookkeeping.
 */
import type { FastifyBaseLogger } from 'fastify';
import type { AlertingRepository, DeliveryAttemptInsert } from './repository.js';
import { resolveRouting, type RoutableAlert } from './routing.js';
import type {
  AlertEscalationStepRow,
  AlertEventRow,
  AlertEventStatus,
  AlertRoutingRuleRow,
  AlertRuleActionRow,
  AlertThrottleWindowRow,
} from './types.js';
import type { ConnectorRepository } from '../connectors/repository.js';
import type {
  ConnectorConfigRow,
  ConnectorRouteEnvironment,
  ConnectorRouteRow,
  NotificationPayload,
  NotificationSeverity,
} from '../connectors/types.js';
import { CONNECTOR_JOBS, CONNECTOR_PRIORITY, type ConnectorJobName } from '../connectors/job.constants.js';
import { pool } from '../../config/database.js';
import { env } from '../../config/env.js';
import { FEATURE_FLAGS, isEnabled } from '../feature-flags/service.js';
import { getAlertAnalysisHook } from './ai/alert-analysis.js';

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
  throttled: number;
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
  throttled: boolean;
  escalationPolicyId: string | null;
  nextEscalationAt: Date | null;
  deliveredActionIds: string[];
}

interface DeliveryTarget {
  connectorId: string;
  routeId: string | null;
  /** Rule action that produced this target (null when from routing rules). */
  actionId: string | null;
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

export type BatchAuthorizationResult = {
  eligible: AlertEventRow[];
  suppressedUpdates: Array<{ id: string; status: AlertEventStatus }>;
  suppressedAttempts: DeliveryAttemptInsert[];
};

export type BatchAuthorizationVerifier = (
  events: AlertEventRow[],
  batchId: string,
  organizationId: string,
  log: FastifyBaseLogger,
) => Promise<BatchAuthorizationResult>;

export type ProjectSubscriptionResolver = {
  resolveByProjectId(projectId: string): Promise<{
    projectId: string;
    organizationId: string;
    environmentId: string | null;
    apiKeyId: string;
    subscriptions: {
      subscriptionId: string;
      connectorId: string;
      enabled: boolean;
      alertCategories: string[];
      severityThreshold: string;
      memberIds: string[];
      channelOverrides: Record<string, unknown>;
    }[];
    members: { userId: string; role: string; email: string | null }[];
  } | null>;
};

export class AlertBatchProcessor {
  private static readonly EVENT_CONCURRENCY = 10;

  constructor(
    private readonly alertRepo: AlertingRepository,
    private readonly connectorRepo: ConnectorRepository,
    private readonly enqueueConnectorJob: EnqueueConnectorJob,
    private readonly logger: FastifyBaseLogger,
    private readonly projectSubscriptionResolver?: ProjectSubscriptionResolver,
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
      return { batchId: data.batchId, total: 0, success: 0, failure: 0, skipped: 0, throttled: 0, durationMs: 0, status: 'completed' };
    }
    const { batch, events } = loaded;

    // Idempotency guard: a re-driven or duplicate job for an already-terminal
    // batch is a no-op (dead-letter retry + orphan recovery both rely on this).
    if (batch.status !== 'processing') {
      log.info({ batchStatus: batch.status }, 'Batch already terminal — skipping');
      return { batchId: data.batchId, total: 0, success: 0, failure: 0, skipped: 0, throttled: 0, durationMs: 0, status: 'completed' };
    }

    // Authorization re-verification, straight from the database on every run
    // (never cached): the organization and every event's project must still
    // exist and be eligible BEFORE any delivery side effect. Ineligible events
    // are suppressed and audited, never delivered.
    const authz = await this.verifyBatchAuthorization(events, data.batchId, data.organizationId, log);
    const authorizedEvents = authz.eligible;

    // 1b. Pre-load project connector subscriptions so delivery targets can be gated
    // by project membership. A project with no subscriptions falls back to the
    // legacy routing-rule behavior (soft rollout); a missing project suppresses.
    const projectIds = [...new Set(authorizedEvents.map((e) => e.project_id).filter((id): id is string => id !== null))];
    const projectSubscriptions = new Map<string, Awaited<ReturnType<ProjectSubscriptionResolver['resolveByProjectId']>>>();
    if (this.projectSubscriptionResolver) {
      for (const projectId of projectIds) {
        projectSubscriptions.set(projectId, await this.projectSubscriptionResolver.resolveByProjectId(projectId));
      }
    }

    // 2. Load routing rules, rule actions, connectors, routes, escalation steps
    //    and throttle windows — each in ONE bulk query (no N+1).
    const ruleIds = [...new Set(authorizedEvents.map((e) => e.rule_id).filter((id): id is string => id !== null))];
    const ruleActions = await this.alertRepo.getRuleActionsByRuleIds(ruleIds);
    const actionsByRuleId = new Map<string, AlertRuleActionRow[]>();
    for (const action of ruleActions) {
      const list = actionsByRuleId.get(action.rule_id) ?? [];
      list.push(action);
      actionsByRuleId.set(action.rule_id, list);
    }

    const routingRules = await this.alertRepo.listRoutingRules(data.organizationId);
    const connectorRoutes = await this.connectorRepo.listRoutesByIds(
      data.organizationId,
      this.uniqueRouteIds(routingRules, ruleActions),
    );
    const connectorIds = this.uniqueConnectorIds(authorizedEvents, routingRules, actionsByRuleId, connectorRoutes);
    const connectors = await this.connectorRepo.getByIds(connectorIds);
    const connectorMap = new Map<string, ConnectorConfigRow>(connectors.map((c) => [c.id, c]));

    const escalationPolicyIds = [...new Set(
      ruleActions.map((a) => a.escalation_policy_id).filter((id): id is string => id !== null),
    )];
    const escalationSteps = await this.alertRepo.listEscalationStepsByPolicyIds(escalationPolicyIds);
    const firstStepByPolicyId = new Map<string, AlertEscalationStepRow>();
    for (const step of escalationSteps) {
      if (!firstStepByPolicyId.has(step.policy_id)) firstStepByPolicyId.set(step.policy_id, step);
    }

    const throttleStates = await this.alertRepo.getThrottleStates(
      ruleActions
        .filter((a) => a.throttle_duration_seconds > 0 || a.max_notifications_per_hour !== null)
        .map((a) => a.id),
    );
    const throttleByActionId = new Map<string, AlertThrottleWindowRow>(throttleStates.map((t) => [t.rule_action_id, t]));

    // 3. Process ALL events concurrently but bounded. mapBounded guarantees one
    //    failing event never aborts the batch.
    const settled = await this.mapBounded(
      authorizedEvents,
      AlertBatchProcessor.EVENT_CONCURRENCY,
      (event) => this.processSingleEvent(
        event, routingRules, actionsByRuleId, connectorRoutes, connectorMap,
        firstStepByPolicyId, throttleByActionId, data.batchId, projectSubscriptions,
      ),
    );

    // 4. Fold results into bulk-update + bulk-insert payloads. Events dropped
    //    by the authorization re-check are pre-seeded here as suppressed.
    const statusUpdates: Array<{
      id: string; status: AlertEventStatus;
      escalationPolicyId?: string | null; escalationStepNumber?: number | null; nextEscalationAt?: Date | null;
    }> = [...authz.suppressedUpdates];
    const deliveryLogs: DeliveryAttemptInsert[] = [...authz.suppressedAttempts];
    const deliveredActionIds = new Set<string>();
    let success = 0, failure = 0, skipped = authz.suppressedUpdates.length, throttled = 0;

    settled.forEach((res, i) => {
      const event = authorizedEvents[i]!;
      if (res.status === 'fulfilled') {
        const outcome = res.value;
        statusUpdates.push({
          id: outcome.eventId,
          status: outcome.newStatus,
          escalationPolicyId: outcome.escalationPolicyId,
          escalationStepNumber: outcome.escalationPolicyId !== null ? 0 : null,
          nextEscalationAt: outcome.nextEscalationAt,
        });
        deliveryLogs.push(...outcome.deliveries);
        outcome.deliveredActionIds.forEach((id) => deliveredActionIds.add(id));
        if (outcome.throttled) throttled += 1;
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

    // 5 + 6. Bulk update statuses, insert delivery attempts, record throttle
    //    usage (one query each).
    await this.alertRepo.bulkUpdateEventStatus(data.organizationId, statusUpdates);
    await this.alertRepo.bulkInsertDeliveryAttempts(deliveryLogs);
    await this.alertRepo.recordThrottleNotifications([...deliveredActionIds]);

    // 7. Mark the batch complete.
    const durationMs = Date.now() - start;
    const status: BatchProcessSummary['status'] = failure === 0 ? 'completed' : success === 0 && skipped === 0 ? 'failed' : 'partial';
    await this.alertRepo.completeBatch(
      data.batchId, { success, failure, skipped }, durationMs, status,
      failure > 0 ? `${failure}/${events.length} deliveries failed` : null,
    );

    log.info({ total: events.length, success, failure, skipped, throttled, durationMs, status }, 'Batch processed');
    return { batchId: data.batchId, total: events.length, success, failure, skipped, throttled, durationMs, status };
  }

  /** Deliver a single event to all routed connectors concurrently. */
  private async processSingleEvent(
    event: AlertEventRow,
    routingRules: AlertRoutingRuleRow[],
    actionsByRuleId: Map<string, AlertRuleActionRow[]>,
    connectorRoutes: ConnectorRouteRow[],
    connectorMap: Map<string, ConnectorConfigRow>,
    firstStepByPolicyId: Map<string, AlertEscalationStepRow>,
    throttleByActionId: Map<string, AlertThrottleWindowRow>,
    batchId: string,
    projectSubscriptions: Map<string, Awaited<ReturnType<ProjectSubscriptionResolver['resolveByProjectId']>>>,
  ): Promise<EventOutcome> {
    const noEscalation = { escalationPolicyId: null, nextEscalationAt: null };
    const routable: RoutableAlert = { severity: event.severity, source: event.source, labels: event.labels };
    const decision = resolveRouting(routable, routingRules);
    const ruleActions = event.rule_id ? actionsByRuleId.get(event.rule_id) ?? [] : [];

    // Split rule actions into deliverable (throttle-passing) and throttled.
    const now = Date.now();
    const deliverableActions: AlertRuleActionRow[] = [];
    const throttledActions: AlertRuleActionRow[] = [];
    for (const action of ruleActions) {
      if (!this.isDeliverAction(action)) continue;
      if (this.isThrottled(action, throttleByActionId.get(action.id), now)) throttledActions.push(action);
      else deliverableActions.push(action);
    }

    const targets = this.resolveDeliveryTargets(event, decision, deliverableActions, connectorRoutes);
    const filteredTargets = this.filterTargetsBySubscriptions(event, targets, projectSubscriptions);

    const deliveries: DeliveryAttemptInsert[] = [];
    // Throttled targets are skipped but audited as cancelled attempts.
    for (const action of throttledActions) {
      for (const target of this.actionTargets(event, action, connectorRoutes)) {
        deliveries.push(this.throttledAttempt(event, target, batchId));
      }
    }

    if (filteredTargets.length === 0) {
      // No route matched or no subscribed connector — nothing to deliver.
      return {
        eventId: event.id, newStatus: 'firing', deliveries, delivered: false,
        skipped: true, throttled: throttledActions.length > 0, ...noEscalation, deliveredActionIds: [],
      };
    }

    const payload = this.toPayload(event, decision.templateId);

    // Optional AI enrichment (post-generation, pre-delivery): flag-gated,
    // non-blocking, never fatal — see enrichWithAiAnalysis.
    await this.enrichWithAiAnalysis(event, payload);

    // Fan out to every target connector concurrently (Bulkhead per connector).
    const perConnector = await Promise.allSettled(
      filteredTargets.map((target) => this.deliverToConnector(event, target, connectorMap, batchId, payload)),
    );

    let anyDelivered = false;
    const deliveredActionIds = new Set<string>();
    perConnector.forEach((res, i) => {
      if (res.status === 'fulfilled') {
        deliveries.push(res.value.log);
        if (res.value.delivered) {
          anyDelivered = true;
          const actionId = targets[i]!.actionId;
          if (actionId) deliveredActionIds.add(actionId);
        }
      }
    });

    // Initialize escalation tracking when the event fires and the rule has an
    // escalate action with an active first step.
    let escalationPolicyId: string | null = null;
    let nextEscalationAt: Date | null = null;
    if (anyDelivered) {
      const escalateAction = ruleActions.find((a) => a.action_type === 'escalate' && a.escalation_policy_id !== null);
      if (escalateAction?.escalation_policy_id) {
        const firstStep = firstStepByPolicyId.get(escalateAction.escalation_policy_id);
        if (firstStep) {
          escalationPolicyId = escalateAction.escalation_policy_id;
          nextEscalationAt = new Date(now + firstStep.wait_minutes * 60_000);
        }
      }
    }

    return {
      eventId: event.id,
      newStatus: anyDelivered ? 'firing' : 'error',
      deliveries,
      delivered: anyDelivered,
      skipped: false,
      throttled: throttledActions.length > 0,
      escalationPolicyId,
      nextEscalationAt,
      deliveredActionIds: [...deliveredActionIds],
    };
  }

  /** Actions that produce direct deliveries (escalate/suppress/group do not). */
  private isDeliverAction(action: AlertRuleActionRow): boolean {
    return (action.action_type === 'notify' || action.action_type === 'webhook')
      && (action.connector_id !== null || action.route_id !== null);
  }

  /** Throttle check: min interval between notifications and/or per-hour cap. */
  private isThrottled(action: AlertRuleActionRow, window: AlertThrottleWindowRow | undefined, nowMs: number): boolean {
    if (action.throttle_duration_seconds <= 0 && action.max_notifications_per_hour === null) return false;
    if (!window) return false;
    if (
      action.throttle_duration_seconds > 0
      && window.last_notified_at !== null
      && new Date(window.last_notified_at).getTime() + action.throttle_duration_seconds * 1000 > nowMs
    ) {
      return true;
    }
    return action.max_notifications_per_hour !== null && window.notification_count >= action.max_notifications_per_hour;
  }

  private throttledAttempt(event: AlertEventRow, target: DeliveryTarget, batchId: string): DeliveryAttemptInsert {
    return {
      organizationId: event.organization_id,
      eventId: event.id,
      connectorId: target.connectorId,
      routeId: target.routeId,
      batchId,
      status: 'cancelled',
      responseStatusCode: null,
      errorMessage: 'throttled by rule action rate limits',
      errorCategory: 'throttled',
      latencyMs: null,
      externalMessageId: null,
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
          expireInSeconds: env.CONNECTOR_SEND_EXPIRE_SECONDS,
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

  /**
   * Re-verify, straight from the database on every run (never cached), that
   * the organization still exists and that every event's project still exists,
   * belongs to the organization and is active. Events failing the check are
   * suppressed instead of delivered, with a cancelled delivery attempt
   * (error_category 'authz') recorded for audit.
   *
   * NOTE: delivery targets in this pipeline are connectors, not individual
   * users — there is no per-user recipient materialization, so organization +
   * project eligibility is the maximal recipient-level filter available here.
   */
  private async verifyBatchAuthorization(
    events: AlertEventRow[],
    batchId: string,
    organizationId: string,
    log: FastifyBaseLogger,
  ): Promise<{
    eligible: AlertEventRow[];
    suppressedUpdates: Array<{ id: string; status: AlertEventStatus }>;
    suppressedAttempts: DeliveryAttemptInsert[];
  }> {
    const orgResult = await pool.query(
      'SELECT 1 FROM organizations WHERE id = $1 AND deleted_at IS NULL',
      [organizationId],
    );
    const orgEligible = (orgResult.rowCount ?? 0) > 0;

    const projectIds = [...new Set(events.map((e) => e.project_id).filter((id): id is string => id !== null))];
    const activeProjects = new Set<string>();
    if (orgEligible && projectIds.length > 0) {
      const projectsResult = await pool.query<{ id: string }>(
        `SELECT id FROM projects
          WHERE id = ANY($2::uuid[]) AND org_id = $1 AND deleted_at IS NULL AND status = 'active'`,
        [organizationId, projectIds],
      );
      for (const row of projectsResult.rows) activeProjects.add(row.id);
    }

    const eligible: AlertEventRow[] = [];
    const suppressedUpdates: Array<{ id: string; status: AlertEventStatus }> = [];
    const suppressedAttempts: DeliveryAttemptInsert[] = [];
    for (const event of events) {
      if (orgEligible && (event.project_id === null || activeProjects.has(event.project_id))) {
        eligible.push(event);
        continue;
      }
      suppressedUpdates.push({ id: event.id, status: 'suppressed' });
      suppressedAttempts.push({
        organizationId: event.organization_id,
        eventId: event.id,
        connectorId: null,
        routeId: null,
        batchId,
        status: 'cancelled',
        responseStatusCode: null,
        errorMessage: 'delivery dropped: organization or project no longer eligible',
        errorCategory: 'authz',
        latencyMs: null,
        externalMessageId: null,
      });
    }
    if (suppressedUpdates.length > 0) {
      log.info(
        { dropped: suppressedUpdates.length, total: events.length },
        'alert delivery: events suppressed by authorization re-check',
      );
    }
    return { eligible, suppressedUpdates, suppressedAttempts };
  }

  /**
   * FUTURE AI INTEGRATION POINT — post-generation, pre-delivery enrichment.
   * Gated by the per-org/project feature flag `ai_alert_analysis`; runs the
   * registered analysis hook with a hard 2s budget. Any failure, timeout, or
   * empty result leaves the payload untouched and delivery proceeds.
   */
  private async enrichWithAiAnalysis(event: AlertEventRow, payload: NotificationPayload): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const enabled = await isEnabled(FEATURE_FLAGS.AI_ALERT_ANALYSIS, {
        organizationId: event.organization_id,
        projectId: event.project_id,
      });
      if (!enabled) return;

      const result = await Promise.race([
        getAlertAnalysisHook().analyze({
          alertEventId: event.id,
          organizationId: event.organization_id,
          projectId: event.project_id,
          payload: event.payload,
        }),
        new Promise<null>((resolve) => {
          timer = setTimeout(() => resolve(null), 2000);
        }),
      ]);
      if (result !== null) {
        payload.metadata = { ...payload.metadata, ai: result };
      }
    } catch (err) {
      this.logger.debug({ err, alertEventId: event.id }, 'AI alert analysis skipped (non-fatal)');
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  private toPayload(event: AlertEventRow, templateId: string | null): NotificationPayload {
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
      metadata: { eventId: event.id, ruleId: event.rule_id, source: event.source, labels: event.labels, templateId },
    };
  }

  private uniqueConnectorIds(
    events: AlertEventRow[],
    routingRules: AlertRoutingRuleRow[],
    actionsByRuleId: Map<string, AlertRuleActionRow[]>,
    connectorRoutes: ConnectorRouteRow[],
  ): string[] {
    const ids = new Set<string>();
    for (const event of events) {
      const decision = resolveRouting(
        { severity: event.severity, source: event.source, labels: event.labels },
        routingRules,
      );
      const actions = event.rule_id ? actionsByRuleId.get(event.rule_id) ?? [] : [];
      this.resolveDeliveryTargets(event, decision, actions.filter((a) => this.isDeliverAction(a)), connectorRoutes)
        .forEach((target) => ids.add(target.connectorId));
    }
    return [...ids];
  }

  private uniqueRouteIds(routingRules: AlertRoutingRuleRow[], ruleActions: AlertRuleActionRow[]): string[] {
    const ids = new Set<string>();
    for (const rule of routingRules) {
      for (const routeId of rule.target_route_ids ?? []) ids.add(routeId);
    }
    for (const action of ruleActions) {
      if (action.route_id) ids.add(action.route_id);
    }
    return [...ids];
  }

  /**
   * Merge routing-rule targets and rule-action targets, deduplicated per
   * connector+route pair. Rule-action targets win the dedup so throttle
   * accounting stays attached to the action.
   */
  private resolveDeliveryTargets(
    event: AlertEventRow,
    decision: { connectorIds: string[]; routeIds: string[] },
    actions: AlertRuleActionRow[],
    connectorRoutes: ConnectorRouteRow[],
  ): DeliveryTarget[] {
    const targets = new Map<string, DeliveryTarget>();

    for (const connectorId of decision.connectorIds) {
      targets.set(`${connectorId}:direct`, { connectorId, routeId: null, actionId: null });
    }

    const context = this.routeMatchContext(event);
    const routeIdSet = new Set(decision.routeIds);
    for (const route of connectorRoutes) {
      if (!routeIdSet.has(route.id)) continue;
      if (!this.routeMatches(route, context)) continue;
      targets.set(`${route.connector_id}:${route.id}`, {
        connectorId: route.connector_id,
        routeId: route.id,
        actionId: null,
      });
    }

    for (const action of actions) {
      for (const target of this.actionTargets(event, action, connectorRoutes)) {
        targets.set(`${target.connectorId}:${target.routeId ?? 'direct'}`, target);
      }
    }

    return [...targets.values()];
  }

  /** Targets produced by a single rule action (direct connector and/or route). */
  private actionTargets(
    event: AlertEventRow,
    action: AlertRuleActionRow,
    connectorRoutes: ConnectorRouteRow[],
  ): DeliveryTarget[] {
    const targets: DeliveryTarget[] = [];
    if (action.connector_id) {
      targets.push({ connectorId: action.connector_id, routeId: null, actionId: action.id });
    }
    if (action.route_id) {
      const route = connectorRoutes.find((r) => r.id === action.route_id);
      if (route && this.routeMatches(route, this.routeMatchContext(event))) {
        targets.push({ connectorId: route.connector_id, routeId: route.id, actionId: action.id });
      }
    }
    return targets;
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

  /**
   * Filter delivery targets to only connectors the originating project has
   * explicitly subscribed to. This prevents alert leakage across projects and
   * enforces the rule: alerts are scoped by Project -> Connector Subscriptions.
   *
   * If no resolver is configured, legacy routing-rule behavior is preserved.
   * If the project has no active subscriptions, all targets are dropped.
   */
  private filterTargetsBySubscriptions(
    event: AlertEventRow,
    targets: DeliveryTarget[],
    projectSubscriptions: Map<string, Awaited<ReturnType<ProjectSubscriptionResolver['resolveByProjectId']>>>,
  ): DeliveryTarget[] {
    if (!this.projectSubscriptionResolver) return targets;
    if (!event.project_id) return targets;

    const routing = projectSubscriptions.get(event.project_id);
    if (!routing) return [];

    const allowedConnectorIds = new Set(
      routing.subscriptions.filter((s) => s.enabled).map((s) => s.connectorId),
    );
    if (allowedConnectorIds.size === 0) return [];

    return targets.filter((target) => allowedConnectorIds.has(target.connectorId));
  }
}
