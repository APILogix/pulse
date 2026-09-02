export const ALERT_JOBS = {
    cleanup: 'alert.cleanup',
    escalate: 'alert.escalate',
    escalationSweep: 'alert.escalation-sweep',
    autoResolveSweep: 'alert.auto-resolve-sweep',
    evaluateFast: 'alert.evaluate.fast',
    evaluateWindow: 'alert.evaluate.window',
    evaluateOperational: 'alert.evaluate.operational',
    evaluateAi: 'alert.evaluate.ai',
    notificationRouter: 'alert.notification-router',
    telemetryOutboxRelay: 'alert.telemetry-outbox-relay',
    errorGroupRegressed: 'alert.error-group-regressed',
    // Relays alert lifecycle domain events (fired/resolved) out of the outbox
    // and into automation, via ALERT_DOMAIN_OUTBOX_JOB (a separate, automation-
    // owned pg-boss job created lazily by pgboss.send - not created here, since
    // this alerting queue list only owns alerting-side queues).
    alertDomainOutboxRelay: 'alert.domain-outbox-relay',
};
export const ALERT_DELIVERY_WORKER_JOBS = [
    ALERT_JOBS.escalate,
    ALERT_JOBS.escalationSweep,
    // Alert lifecycle correctness, not just delivery: without this sweep a
    // configured `autoResolveAfterMinutes` never takes effect.
    ALERT_JOBS.autoResolveSweep,
    ALERT_JOBS.evaluateFast,
    ALERT_JOBS.evaluateWindow,
    ALERT_JOBS.evaluateOperational,
    ALERT_JOBS.evaluateAi,
    ALERT_JOBS.notificationRouter,
    ALERT_JOBS.telemetryOutboxRelay,
    ALERT_JOBS.errorGroupRegressed,
    // Publishing automation events is alert-lifecycle-adjacent, not delivery, but
    // it must run wherever alert decisions are made (decide() writes the outbox
    // row), so it belongs in every worker group, not just 'all'.
    ALERT_JOBS.alertDomainOutboxRelay,
];
//# sourceMappingURL=queue-names.js.map