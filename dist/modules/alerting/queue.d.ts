/**
 * Alerting pg-boss queue wiring (Alerting V2 Canonical Architecture).
 *
 * Canonical queues:
 *   - alert.telemetry-outbox-relay (relays fast telemetry outbox events)
 *   - alert.evaluate.fast          (fast path rule evaluator)
 *   - alert.evaluate.window        (periodic 5s window evaluator)
 *   - alert.evaluate.operational   (periodic 30s system metrics evaluator)
 *   - alert.evaluate.ai            (periodic 300s AI evaluator)
 *   - alert.error-group-regressed  (fast evaluation on error regressions)
 *   - alert.notification-router    (claims notification jobs & dispatches to connector queues)
 *   - alert.escalate               (snapshot escalation evaluator)
 *   - alert.escalation-sweep       (advances due escalations)
 *   - alert.cleanup                (daily retention purge)
 */
import type { FastifyBaseLogger } from 'fastify';
import type { Pool } from 'pg';
export declare const ALERT_JOBS: {
    readonly cleanup: "alert.cleanup";
    readonly escalate: "alert.escalate";
    readonly escalationSweep: "alert.escalation-sweep";
    readonly evaluateFast: "alert.evaluate.fast";
    readonly evaluateWindow: "alert.evaluate.window";
    readonly evaluateOperational: "alert.evaluate.operational";
    readonly evaluateAi: "alert.evaluate.ai";
    readonly notificationRouter: "alert.notification-router";
    readonly telemetryOutboxRelay: "alert.telemetry-outbox-relay";
    readonly errorGroupRegressed: "alert.error-group-regressed";
};
export interface AlertingWorkerConfig {
    sweepClaimLimit?: number;
    retentionResolvedEventsDays?: number;
    retentionBatchesDays?: number;
    retentionDeliveryAttemptsDays?: number;
    retentionDeadLettersDays?: number;
}
/**
 * Register all Alerting V2 pg-boss workers + timers. Idempotent per process.
 */
export declare function registerAlertingWorkers(logger: FastifyBaseLogger, config?: AlertingWorkerConfig, _projectSubscriptionResolver?: unknown, telemetryPool?: Pool): Promise<{
    stop: () => Promise<void>;
}>;
//# sourceMappingURL=queue.d.ts.map