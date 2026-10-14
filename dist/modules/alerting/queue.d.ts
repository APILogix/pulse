/**
 * Alerting pgmq queue wiring (Alerting V2 Canonical Architecture).
 *
 * Canonical queues:
 *   - alert_telemetry_outbox_relay (relays fast telemetry outbox events)
 *   - alert_evaluate_fast          (fast path rule evaluator)
 *   - alert_evaluate_window        (periodic 5s window evaluator)
 *   - alert_evaluate_operational   (periodic 30s system metrics evaluator)
 *   - alert_evaluate_ai            (periodic 300s AI evaluator)
 *   - alert_error_group_regressed  (fast evaluation on error regressions)
 *   - alert_notification_router    (claims notification jobs & dispatches to connector queues)
 *   - alert_escalate               (snapshot escalation evaluator)
 *   - alert_escalation_sweep       (advances due escalations)
 *   - alert_auto_resolve_sweep     (closes alerts past auto_resolve_at)
 *   - alert_cleanup                (daily retention purge)
 */
import type { FastifyBaseLogger } from 'fastify';
import type { Pool } from 'pg';
export { ALERT_JOBS, ALERT_DELIVERY_WORKER_JOBS } from './queue-names.js';
export type AlertingWorkerGroup = 'all' | 'alert-delivery';
export interface AlertingWorkerConfig {
    group?: AlertingWorkerGroup;
    strictQueueCreation?: boolean;
    sweepClaimLimit?: number;
    retentionResolvedEventsDays?: number;
    retentionBatchesDays?: number;
    retentionDeliveryAttemptsDays?: number;
    retentionDeadLettersDays?: number;
}
/**
 * Register all Alerting V2 PGMQ workers + dispatch intervals.
 */
export declare function registerAlertingWorkers(logger: FastifyBaseLogger, config?: AlertingWorkerConfig, _projectSubscriptionResolver?: unknown, telemetryPool?: Pool, primaryConfigPool?: Pool): Promise<{
    stop: () => Promise<void>;
}>;
//# sourceMappingURL=queue.d.ts.map