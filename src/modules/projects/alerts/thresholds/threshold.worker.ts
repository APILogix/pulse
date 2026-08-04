import type { FastifyBaseLogger } from "fastify";
import type { Pool } from "pg";
import { pool } from "../../../../config/database.js";
import { AlertingRepository } from "../../../alerting/repository.js";
import { EventsService } from "../../../alerting/events/events.service.js";
import { compareThreshold } from "./threshold.evaluator.js";
import type { ProjectAlertThresholdRow } from "./threshold.types.js";

interface EvaluatedThresholdRow extends ProjectAlertThresholdRow {
  current_breaches: number;
  is_breaching: boolean;
  last_evaluated_at: Date | null;
}

export interface ProjectThresholdTickSummary {
  due: number;
  evaluated: number;
  fired: number;
  recovered: number;
  failed: number;
}

type ThresholdOutcome = "fired" | "recovered" | "breaching" | "clear" | "cooldown" | "unsupported";

const METRIC_EXPRESSIONS: Readonly<Record<string, string>> = {
  total_events: "COALESCE(SUM(total_events),0)::float8",
  errors: "COALESCE(SUM(errors),0)::float8",
  ingestion_errors: "COALESCE(SUM(errors),0)::float8",
  requests: "COALESCE(SUM(requests),0)::float8",
  failed_notifications: "COALESCE(SUM(failed_notifications),0)::float8",
  rate_limit_usage: "COALESCE(SUM(rate_limit_usage),0)::float8",
  // Latency percentiles are intentionally absent: percentiles are not
  // composable across buckets, so they cannot be derived from additive usage
  // rollups. Latency SLOs must be evaluated by a mergeable-sketch pipeline.
};

export class ProjectThresholdWorker {
  private readonly repository: AlertingRepository;
  private readonly events: EventsService;
  private readonly log: FastifyBaseLogger;
  /**
   * Pool that owns TELEMETRY (`events_*`). ADR-0006 / DEV-002.
   *
   * Only the apdex metric reads telemetry. `project_usage_minute`, `ai_usage_logs`,
   * `project_alert_thresholds` and `alert_events` are control-plane owned and stay on the
   * primary pool. Defaults to the primary pool so single-database deployments are unchanged.
   */
  private readonly telemetry: Pool;
  /** When true, thresholds are evaluated and logged but no alert is emitted or resolved. */
  private readonly dryRun: boolean;

  /**
   * @param telemetryPool pool owning `events_*`; defaults to the control-plane pool
   * @param dryRun explicit override supplied by AlertRuleEvaluator. Defaults to "dry-run if the
   *   telemetry pool is a different pool", so single-database deployments are unaffected.
   */
  constructor(logger: FastifyBaseLogger, telemetryPool: Pool = pool, dryRun?: boolean) {
    this.repository = new AlertingRepository();
    this.events = new EventsService({ repository: this.repository, logger });
    this.log = logger.child({ component: "project-threshold-evaluator" });
    this.telemetry = telemetryPool;
    this.dryRun = dryRun ?? this.telemetry !== pool;
  }

  async runTick(limit = 500): Promise<ProjectThresholdTickSummary> {
    const summary: ProjectThresholdTickSummary = { due: 0, evaluated: 0, fired: 0, recovered: 0, failed: 0 };
    let due: EvaluatedThresholdRow[];
    try {
      due = await this.findDue(limit);
    } catch (err) {
      summary.failed = 1;
      this.log.error({ err }, "Unable to load due project thresholds");
      return summary;
    }
    summary.due = due.length;
    const settled = await mapBounded(due, 10, (threshold) => this.evaluateOne(threshold));
    settled.forEach((result, index) => {
      if (result.status === "rejected") {
        summary.failed += 1;
        this.log.error({ err: result.reason, thresholdId: due[index]?.id }, "Project threshold evaluation failed");
        return;
      }
      summary.evaluated += result.value === "unsupported" ? 0 : 1;
      if (result.value === "fired") summary.fired += 1;
      if (result.value === "recovered") summary.recovered += 1;
    });
    return summary;
  }

  private async findDue(limit: number): Promise<EvaluatedThresholdRow[]> {
    const result = await pool.query<EvaluatedThresholdRow>(
      `SELECT threshold.*
         FROM project_alert_thresholds threshold
         JOIN projects project
           ON project.id = threshold.project_id
          AND project.org_id = threshold.organization_id
          AND project.status = 'active'
          AND project.deleted_at IS NULL
         LEFT JOIN project_environments environment
           ON environment.id = threshold.environment_id
          AND environment.project_id = threshold.project_id
          AND environment.organization_id = threshold.organization_id
        WHERE threshold.enabled = TRUE
          AND threshold.deleted_at IS NULL
          AND (threshold.environment_id IS NULL
               OR (environment.is_active = TRUE AND environment.deleted_at IS NULL))
          AND (threshold.last_evaluated_at IS NULL
               OR threshold.last_evaluated_at
                    + threshold.evaluation_window_minutes * INTERVAL '1 minute' <= NOW())
        ORDER BY threshold.last_evaluated_at ASC NULLS FIRST, threshold.id
        LIMIT $1`,
      [Math.max(1, Math.min(limit, 1000))],
    );
    return result.rows;
  }

  private async evaluateOne(threshold: EvaluatedThresholdRow): Promise<ThresholdOutcome> {
    const actual = await this.readMetric(threshold);
    if (actual === null) {
      await this.markEvaluated(threshold, 0, false, false, false);
      this.log.debug({ thresholdId: threshold.id, metric: threshold.metric_name }, "Unsupported project threshold metric");
      return "unsupported";
    }

    const matched = compareThreshold(
      actual,
      threshold.comparison_operator,
      Number(threshold.threshold_value),
    );
    const breaches = matched ? threshold.current_breaches + 1 : 0;
    const reached = matched && breaches >= threshold.consecutive_breaches;
    const cooldownElapsed = !threshold.last_triggered_at
      || threshold.last_triggered_at.getTime() + threshold.cooldown_minutes * 60_000 <= Date.now();
    const shouldFire = reached && cooldownElapsed;
    const shouldRecover = !matched && threshold.is_breaching;

    // DEV-002 dry-run: evaluate and record breach state, but never emit or auto-resolve.
    if (this.dryRun) {
      if (shouldFire || shouldRecover) {
        this.log.warn(
          {
            thresholdId: threshold.id,
            projectId: threshold.project_id,
            thresholdKey: threshold.threshold_key,
            metric: threshold.metric_name,
            actual,
            threshold: Number(threshold.threshold_value),
            intent: shouldFire ? "fire" : "recover",
          },
          "DRY-RUN: project threshold would have emitted an alert (no alert event created)",
        );
      }
      await this.markEvaluated(threshold, breaches, reached, false, false);
      if (shouldFire) return "fired";
      if (shouldRecover) return "recovered";
      if (reached) return "cooldown";
      return matched ? "breaching" : "clear";
    }

    if (shouldFire) await this.emit(threshold, actual, false);
    if (shouldRecover) {
      await this.resolveActiveEvents(threshold);
      if (threshold.notify_on_recovery) await this.emit(threshold, actual, true);
    }
    await this.markEvaluated(threshold, breaches, reached, shouldFire, shouldRecover);

    if (shouldFire) return "fired";
    if (shouldRecover) return "recovered";
    if (reached) return "cooldown";
    return matched ? "breaching" : "clear";
  }

  private async readMetric(threshold: EvaluatedThresholdRow): Promise<number | null> {
    if (threshold.metric_name === "error_rate" || threshold.threshold_key === "ingestion_error_rate") {
      return this.readUsageExpression(
        threshold,
        "CASE WHEN SUM(requests)>0 THEN 100.0*SUM(errors)/SUM(requests) ELSE 0 END::float8",
      );
    }
    if (threshold.threshold_key === "rate_limit_usage") {
      return this.readUsageExpression(
        threshold,
        "CASE WHEN SUM(requests)+SUM(rate_limit_usage)>0 THEN 100.0*SUM(rate_limit_usage)/(SUM(requests)+SUM(rate_limit_usage)) ELSE 0 END::float8",
      );
    }
    if (threshold.metric_name === "apdex") {
      // Telemetry read (events_requests) → telemetry pool (ADR-0006 / DEV-002).
      const result = await this.telemetry.query<{ value: number | null }>(
        `SELECT CASE WHEN COUNT(*)>0 THEN
           (COUNT(*) FILTER(WHERE latency_ms<=500)
             + 0.5*COUNT(*) FILTER(WHERE latency_ms>500 AND latency_ms<=2000))/COUNT(*)
          ELSE NULL END::float8 AS value
         FROM events_requests
        WHERE organization_id=$1 AND project_id=$2
          AND timestamp>=NOW()-($3::int*INTERVAL '1 minute')`,
        [threshold.organization_id, threshold.project_id, threshold.evaluation_window_minutes],
      );
      return result.rows[0]?.value ?? null;
    }
    if (threshold.metric_name === "ai_cost") {
      const result = await pool.query<{ value: number }>(
        `SELECT COALESCE(SUM(estimated_cost_usd),0)::float8 AS value
           FROM ai_usage_logs
          WHERE organization_id=$1 AND project_id=$2
            AND occurred_at>=NOW()-($3::int*INTERVAL '1 minute')`,
        [threshold.organization_id, threshold.project_id, threshold.evaluation_window_minutes],
      );
      return Number(result.rows[0]?.value ?? 0);
    }
    if (threshold.threshold_key === "event_volume_spike" || threshold.threshold_key === "event_volume_drop") {
      const result = await pool.query<{ value: number }>(
        `WITH windows AS (
           SELECT COALESCE(SUM(total_events) FILTER(
                    WHERE bucket>=NOW()-($3::int*INTERVAL '1 minute')),0)::float8 current_value,
                  COALESCE(SUM(total_events) FILTER(
                    WHERE bucket<NOW()-($3::int*INTERVAL '1 minute')),0)::float8 previous_value
             FROM project_usage_minute
            WHERE organization_id=$1 AND project_id=$2
              AND bucket>=NOW()-(2*$3::int*INTERVAL '1 minute')
              AND ($4::uuid IS NULL OR environment_id=$4)
         ) SELECT CASE WHEN previous_value>0
                  THEN 100.0*current_value/previous_value ELSE 0 END::float8 AS value
             FROM windows`,
        [threshold.organization_id, threshold.project_id, threshold.evaluation_window_minutes, threshold.environment_id],
      );
      return Number(result.rows[0]?.value ?? 0);
    }
    if (threshold.threshold_key === "failed_notification_rate") {
      return this.readUsageExpression(
        threshold,
        "CASE WHEN SUM(connector_deliveries)>0 THEN 100.0*SUM(failed_notifications)/SUM(connector_deliveries) ELSE 0 END::float8",
      );
    }
    const expression = METRIC_EXPRESSIONS[threshold.metric_name];
    return expression ? this.readUsageExpression(threshold, expression) : null;
  }

  private async readUsageExpression(threshold: EvaluatedThresholdRow, expression: string): Promise<number> {
    const result = await pool.query<{ value: number }>(
      `SELECT ${expression} AS value
         FROM project_usage_minute
        WHERE organization_id=$1 AND project_id=$2
          AND bucket>=NOW()-($3::int*INTERVAL '1 minute')
          AND ($4::uuid IS NULL OR environment_id=$4)`,
      [threshold.organization_id, threshold.project_id, threshold.evaluation_window_minutes, threshold.environment_id],
    );
    return Number(result.rows[0]?.value ?? 0);
  }

  private async emit(threshold: EvaluatedThresholdRow, actual: number, recovery: boolean): Promise<void> {
    await this.events.ingestEvent(threshold.organization_id, {
      projectId: threshold.project_id,
      severity: recovery ? "info" : this.severity(threshold.severity),
      source: "project-threshold-evaluator",
      fingerprint: `project-threshold:${threshold.id}`,
      payload: {
        title: recovery ? `Recovered: ${threshold.threshold_key}` : `Threshold breached: ${threshold.threshold_key}`,
        message: recovery
          ? `${threshold.metric_name} recovered to ${actual}`
          : `${threshold.metric_name} ${threshold.comparison_operator} ${threshold.threshold_value} (actual ${actual})`,
        projectId: threshold.project_id,
        environmentId: threshold.environment_id,
        category: threshold.category,
        metric: threshold.metric_name,
        actual,
        threshold: Number(threshold.threshold_value),
        unit: threshold.threshold_unit,
        recovery,
      },
      labels: {
        project_id: threshold.project_id,
        threshold_id: threshold.id,
        category: threshold.category,
        ...(threshold.environment_id ? { environment_id: threshold.environment_id } : {}),
      },
      annotations: {
        thresholdKey: threshold.threshold_key,
        evaluatedAt: new Date().toISOString(),
      },
    });
  }

  private async resolveActiveEvents(threshold: EvaluatedThresholdRow): Promise<void> {
    const active = await pool.query<{ id: string }>(
      `SELECT id FROM alert_events
        WHERE organization_id=$1 AND project_id=$2 AND fingerprint=$3
          AND status IN ('firing','acknowledged','pending','processing')
        ORDER BY started_at DESC
        LIMIT 50`,
      [threshold.organization_id, threshold.project_id, `project-threshold:${threshold.id}`],
    );
    for (const row of active.rows) {
      await this.repository.resolveEvent(threshold.organization_id, row.id, null, "auto", true);
      await this.repository.insertHistory({
        eventId: row.id,
        organizationId: threshold.organization_id,
        action: "auto_resolved",
        actorId: null,
        actorType: "worker",
        metadata: { reason: "project_threshold_recovered", thresholdId: threshold.id },
      });
    }
  }

  private severity(value: string): "info" | "warning" | "error" | "critical" {
    return value === "info" || value === "warning" || value === "error" || value === "critical"
      ? value
      : "warning";
  }

  private async markEvaluated(
    threshold: EvaluatedThresholdRow,
    breaches: number,
    isBreaching: boolean,
    fired: boolean,
    recovered: boolean,
  ): Promise<void> {
    await pool.query(
      `UPDATE project_alert_thresholds
          SET current_breaches=$2,
              is_breaching=$3,
              last_evaluated_at=NOW(),
              last_triggered_at=CASE WHEN $4 THEN NOW() ELSE last_triggered_at END,
              last_recovered_at=CASE WHEN $5 THEN NOW() ELSE last_recovered_at END,
              updated_at=NOW(), version=version+1
        WHERE id=$1 AND organization_id=$6 AND project_id=$7
          AND enabled=TRUE AND deleted_at IS NULL`,
      [
        threshold.id,
        breaches,
        isBreaching,
        fired,
        recovered,
        threshold.organization_id,
        threshold.project_id,
      ],
    );
  }
}

async function mapBounded<T, R>(
  items: T[],
  limit: number,
  task: (item: T) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let cursor = 0;
  const lane = async (): Promise<void> => {
    while (cursor < items.length) {
      const index = cursor++;
      try {
        results[index] = { status: "fulfilled", value: await task(items[index]!) };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
  return results;
}
