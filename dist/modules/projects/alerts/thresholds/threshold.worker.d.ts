import type { FastifyBaseLogger } from "fastify";
import type { Pool } from "pg";
export interface ProjectThresholdTickSummary {
    due: number;
    evaluated: number;
    fired: number;
    recovered: number;
    failed: number;
}
export declare class ProjectThresholdWorker {
    private readonly repository;
    private readonly events;
    private readonly log;
    /**
     * Pool that owns TELEMETRY (`events_*`). ADR-0006 / DEV-002.
     *
     * Only the apdex metric reads telemetry. `project_usage_minute`, `ai_usage_logs`,
     * `project_alert_thresholds` and `alert_events` are control-plane owned and stay on the
     * primary pool. Defaults to the primary pool so single-database deployments are unchanged.
     */
    private readonly telemetry;
    /** When true, thresholds are evaluated and logged but no alert is emitted or resolved. */
    private readonly dryRun;
    /**
     * @param telemetryPool pool owning `events_*`; defaults to the control-plane pool
     * @param dryRun explicit override supplied by AlertRuleEvaluator. Defaults to "dry-run if the
     * telemetry pool is a different pool", so single-database deployments are unaffected.
     */
    constructor(logger: FastifyBaseLogger, telemetryPool?: Pool, dryRun?: boolean);
    runTick(limit?: number): Promise<ProjectThresholdTickSummary>;
    private findDue;
    private evaluateOne;
    private readMetric;
    private readUsageExpression;
    private emit;
    private resolveActiveEvents;
    private severity;
    private markEvaluated;
}
//# sourceMappingURL=threshold.worker.d.ts.map