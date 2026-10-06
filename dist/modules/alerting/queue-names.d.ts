export declare const ALERT_JOBS: {
    readonly cleanup: "alert_cleanup";
    readonly escalate: "alert_escalate";
    readonly escalationSweep: "alert_escalation_sweep";
    readonly autoResolveSweep: "alert_auto_resolve_sweep";
    readonly evaluateFast: "alert_evaluate_fast";
    readonly evaluateWindow: "alert_evaluate_window";
    readonly evaluateOperational: "alert_evaluate_operational";
    readonly evaluateAi: "alert_evaluate_ai";
    readonly notificationRouter: "alert_notification_router";
    readonly telemetryOutboxRelay: "alert_telemetry_outbox_relay";
    readonly errorGroupRegressed: "alert_error_group_regressed";
    readonly alertDomainOutboxRelay: "alert_domain_outbox_relay";
};
export declare const ALERT_DELIVERY_WORKER_JOBS: readonly ["alert_escalate", "alert_escalation_sweep", "alert_auto_resolve_sweep", "alert_evaluate_fast", "alert_evaluate_window", "alert_evaluate_operational", "alert_evaluate_ai", "alert_notification_router", "alert_telemetry_outbox_relay", "alert_error_group_regressed", "alert_domain_outbox_relay"];
//# sourceMappingURL=queue-names.d.ts.map