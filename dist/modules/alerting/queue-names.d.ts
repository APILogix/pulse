export declare const ALERT_JOBS: {
    readonly cleanup: "alert.cleanup";
    readonly escalate: "alert.escalate";
    readonly escalationSweep: "alert.escalation-sweep";
    readonly autoResolveSweep: "alert.auto-resolve-sweep";
    readonly evaluateFast: "alert.evaluate.fast";
    readonly evaluateWindow: "alert.evaluate.window";
    readonly evaluateOperational: "alert.evaluate.operational";
    readonly evaluateAi: "alert.evaluate.ai";
    readonly notificationRouter: "alert.notification-router";
    readonly telemetryOutboxRelay: "alert.telemetry-outbox-relay";
    readonly errorGroupRegressed: "alert.error-group-regressed";
    readonly alertDomainOutboxRelay: "alert.domain-outbox-relay";
};
export declare const ALERT_DELIVERY_WORKER_JOBS: readonly ["alert.escalate", "alert.escalation-sweep", "alert.auto-resolve-sweep", "alert.evaluate.fast", "alert.evaluate.window", "alert.evaluate.operational", "alert.evaluate.ai", "alert.notification-router", "alert.telemetry-outbox-relay", "alert.error-group-regressed", "alert.domain-outbox-relay"];
//# sourceMappingURL=queue-names.d.ts.map