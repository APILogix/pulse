export const ALERT_JOBS = {
  cleanup: 'alert_cleanup',
  escalate: 'alert_escalate',
  escalationSweep: 'alert_escalation_sweep',
  autoResolveSweep: 'alert_auto_resolve_sweep',
  evaluateFast: 'alert_evaluate_fast',
  evaluateWindow: 'alert_evaluate_window',
  evaluateOperational: 'alert_evaluate_operational',
  evaluateAi: 'alert_evaluate_ai',
  notificationRouter: 'alert_notification_router',
  telemetryOutboxRelay: 'alert_telemetry_outbox_relay',
  errorGroupRegressed: 'alert_error_group_regressed',
  alertDomainOutboxRelay: 'alert_domain_outbox_relay',
} as const;

export const ALERT_DELIVERY_WORKER_JOBS = [
  ALERT_JOBS.escalate,
  ALERT_JOBS.escalationSweep,
  ALERT_JOBS.autoResolveSweep,
  ALERT_JOBS.evaluateFast,
  ALERT_JOBS.evaluateWindow,
  ALERT_JOBS.evaluateOperational,
  ALERT_JOBS.evaluateAi,
  ALERT_JOBS.notificationRouter,
  ALERT_JOBS.telemetryOutboxRelay,
  ALERT_JOBS.errorGroupRegressed,
  ALERT_JOBS.alertDomainOutboxRelay,
] as const;
