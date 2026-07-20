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
import type { AlertEventRow, AlertEventStatus } from './types.js';
import type { ConnectorRepository } from '../connectors/repository.js';
import { type ConnectorJobName } from '../connectors/job.constants.js';
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
type EnqueueConnectorJob = (queue: ConnectorJobName, data: Record<string, unknown>, options?: Record<string, unknown>) => Promise<unknown>;
export type BatchAuthorizationResult = {
    eligible: AlertEventRow[];
    suppressedUpdates: Array<{
        id: string;
        status: AlertEventStatus;
    }>;
    suppressedAttempts: DeliveryAttemptInsert[];
};
export type BatchAuthorizationVerifier = (events: AlertEventRow[], batchId: string, organizationId: string, log: FastifyBaseLogger) => Promise<BatchAuthorizationResult>;
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
        members: {
            userId: string;
            role: string;
            email: string | null;
        }[];
    } | null>;
};
export declare class AlertBatchProcessor {
    private readonly alertRepo;
    private readonly connectorRepo;
    private readonly enqueueConnectorJob;
    private readonly logger;
    private readonly projectSubscriptionResolver?;
    private static readonly EVENT_CONCURRENCY;
    constructor(alertRepo: AlertingRepository, connectorRepo: ConnectorRepository, enqueueConnectorJob: EnqueueConnectorJob, logger: FastifyBaseLogger, projectSubscriptionResolver?: ProjectSubscriptionResolver | undefined);
    private mapBounded;
    processBatch(data: BatchJobData): Promise<BatchProcessSummary>;
    /** Deliver a single event to all routed connectors concurrently. */
    private processSingleEvent;
    /** Actions that produce direct deliveries (escalate/suppress/group do not). */
    private isDeliverAction;
    /** Throttle check: min interval between notifications and/or per-hour cap. */
    private isThrottled;
    private throttledAttempt;
    private deliverToConnector;
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
    private verifyBatchAuthorization;
    /**
     * FUTURE AI INTEGRATION POINT — post-generation, pre-delivery enrichment.
     * Gated by the per-org/project feature flag `ai_alert_analysis`; runs the
     * registered analysis hook with a hard 2s budget. Any failure, timeout, or
     * empty result leaves the payload untouched and delivery proceeds.
     */
    private enrichWithAiAnalysis;
    private toPayload;
    private uniqueConnectorIds;
    private uniqueRouteIds;
    /**
     * Merge routing-rule targets and rule-action targets, deduplicated per
     * connector+route pair. Rule-action targets win the dedup so throttle
     * accounting stays attached to the action.
     */
    private resolveDeliveryTargets;
    /** Targets produced by a single rule action (direct connector and/or route). */
    private actionTargets;
    private routeMatches;
    private routeMatchContext;
    private firstString;
    private toRouteEnvironment;
    /**
     * Filter delivery targets to only connectors the originating project has
     * explicitly subscribed to. This prevents alert leakage across projects and
     * enforces the rule: alerts are scoped by Project -> Connector Subscriptions.
     *
     * If no resolver is configured, legacy routing-rule behavior is preserved.
     * If the project has no active subscriptions, all targets are dropped.
     */
    private filterTargetsBySubscriptions;
}
export {};
//# sourceMappingURL=batch-processor.d.ts.map