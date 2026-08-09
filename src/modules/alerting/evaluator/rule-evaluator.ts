/**
 * Scheduled alert-rule evaluation engine (worker path ONLY — never HTTP).
 *
 * Driven by the pg-boss cron queue `alert.evaluate-rules` (see
 * alerting/queue.ts). Each tick:
 *   1. Selects enabled rules whose evaluation interval has elapsed
 *      (watermark: alert_rules.last_evaluated_at), bounded + oldest-first.
 *   2. Evaluates every condition of a rule against the observability event
 *      tables with a single bounded query per condition (see CONDITION SQL
 *      below). Unmappable conditions are skipped (debug log, fail-open).
 *   3. Combines condition outcomes with the shared grouping semantics of
 *      alerting/evaluator.ts (groups OR'd, ungrouped AND'd).
 *   4. Consecutive-breach counting in alert_rules.metadata->>'consecutiveBreaches'
 *      (required count from metadata.consecutiveBreachesRequired /
 *      annotations.consecutiveBreaches, default 1).
 *   5. Cooldown: an active alert_events row with the same fingerprint within
 *      cooldown_seconds suppresses re-firing.
 *   6. FIRE via EventsService.ingestEvent (the single ingestion entry point —
 *      fingerprint/dedup/silence/pending persist all stay in one place).
 *   7. RECOVERY: when a previously-breaching rule evaluates clear, any active
 *      event with the rule's fingerprint is resolved (resolution_reason
 *      'auto') so the alert auto-resolves.
 *   8. last_evaluated_at advances on success (incl. mapped-skip) but NOT on
 *      query error, so a failed rule is retried on the next tick.
 *
 * One bad rule never breaks the tick: every rule runs inside its own
 * try/catch and the tick processes rules with bounded concurrency.
 */
import type { FastifyBaseLogger } from 'fastify';
import type { Pool } from 'pg';
import { pool } from '../../../config/database.js';
import { AlertingRepository } from '../repository.js';
import { EventsService } from '../events/events.service.js';
import { evaluateRule, type EvaluableCondition } from '../evaluator.js';
import { seedDefaultPresetsForOrg } from './presets.js';
import { ProjectThresholdWorker } from '../../projects/alerts/thresholds/threshold.worker.js';
import { isEnabled } from '../../feature-flags/service.js';
import { FEATURE_FLAGS } from '../../feature-flags/types.js';
import type { AlertRuleConditionRow, AlertRuleRow } from '../types.js';

const EVAL_SOURCE = 'rule-evaluator';
const RULE_BATCH_LIMIT = 500;
const RULE_CONCURRENCY = 10;
/** Hard cap for the log-pattern scan (LIMIT guard) so a noisy window stays cheap. */
const LOG_SCAN_LIMIT = 10_000;

export interface EvaluatorTickSummary {
  rulesDue: number;
  evaluated: number;
  fired: number;
  recovered: number;
  cooldownSkipped: number;
  failed: number;
  orgsSeeded: number;
}

interface ConditionOutcome {
  condition: AlertRuleConditionRow;
  /** Whether the condition could be mapped + queried. */
  evaluated: boolean;
  /** The computed scalar (null when the query yielded no data). */
  actual: unknown;
  /** Operator/threshold actually compared (log matches are normalized). */
  operator: AlertRuleConditionRow['operator'];
  threshold: unknown;
}

export class AlertRuleEvaluator {
  private readonly repo = new AlertingRepository();
  private readonly eventsService: EventsService;
  private readonly projectThresholds: ProjectThresholdWorker;
  private readonly log: FastifyBaseLogger;
  /**
   * Pool that owns TELEMETRY (`events_*`). ADR-0006 / DEV-002: ingestion persists telemetry
   * through the Log DB pool, so the evaluator must read it through the same pool. Defaults to
   * the control-plane pool so single-database deployments behave exactly as before.
   *
   * NOTE: `ai_usage_logs`, `alert_rules` and `alert_events` are NOT telemetry — they stay on
   * the control-plane pool. Only `events_*` reads are routed here.
   */
  private readonly telemetry: Pool;
  /** When true, conditions are evaluated and logged but no alert is fired or auto-resolved. */
  private readonly dryRun: boolean;

  /**
   * @param telemetryPool pool owning `events_*`; defaults to the control-plane pool
   * @param dryRun explicit override. When omitted it defaults to "dry-run if the telemetry pool
   *   is a different pool", so single-database deployments keep firing exactly as before.
   *   The environment-driven value is resolved by the worker registration (see
   *   `resolveEvaluatorDryRun`) and passed in, keeping this class free of env coupling.
   */
  constructor(logger: FastifyBaseLogger, telemetryPool: Pool = pool, dryRun?: boolean) {
    this.log = logger.child({ component: 'alert-rule-evaluator' });
    this.eventsService = new EventsService({ repository: this.repo, logger });
    this.telemetry = telemetryPool;

    const poolsDiffer = this.telemetry !== pool;
    this.dryRun = dryRun ?? poolsDiffer;
    this.projectThresholds = new ProjectThresholdWorker(logger, telemetryPool, this.dryRun);

    this.log.info(
      {
        telemetryPoolIsSeparate: poolsDiffer,
        dryRun: this.dryRun,
        dryRunSource: dryRun === undefined ? 'auto' : 'explicit',
      },
      this.dryRun
        ? 'Alert rule evaluator running in DRY-RUN: conditions are evaluated but no alert will '
          + 'fire or auto-resolve (DEV-002). Set ALERTING_EVAL_DRY_RUN=false after parity validation.'
        : 'Alert rule evaluator will fire alerts',
    );
  }

  /** One evaluator tick: alert rules, project thresholds, and preset seeding. */
  async runTick(limit: number = RULE_BATCH_LIMIT): Promise<EvaluatorTickSummary> {
    const summary: EvaluatorTickSummary = {
      rulesDue: 0, evaluated: 0, fired: 0, recovered: 0, cooldownSkipped: 0, failed: 0, orgsSeeded: 0,
    };

    const [due, thresholdSummary] = await Promise.all([
      this.findDueRules(limit),
      this.projectThresholds.runTick(limit),
    ]);
    summary.rulesDue = due.length + thresholdSummary.due;
    summary.evaluated += thresholdSummary.evaluated;
    summary.fired += thresholdSummary.fired;
    summary.recovered += thresholdSummary.recovered;
    summary.failed += thresholdSummary.failed;

    await mapBounded(due, RULE_CONCURRENCY, async (rule) => {
      try {
        const outcome = await this.evaluateOneRule(rule);
        summary.evaluated += 1;
        if (outcome === 'fired') summary.fired += 1;
        else if (outcome === 'recovered') summary.recovered += 1;
        else if (outcome === 'cooldown') summary.cooldownSkipped += 1;
      } catch (err) {
        // Query/transient error: last_evaluated_at is intentionally NOT
        // advanced so the rule is retried on the next tick.
        summary.failed += 1;
        this.log.error({ err, ruleId: rule.id, orgId: rule.organization_id }, 'Rule evaluation failed');
      }
    });

    summary.orgsSeeded = await this.seedPresetsForActiveOrgs();
    if (summary.evaluated > 0 || summary.fired > 0 || summary.orgsSeeded > 0 || summary.failed > 0) {
      this.log.info({ ...summary }, 'Rule and project-threshold evaluation tick finished');
    }
    return summary;
  }

  /** Enabled rules due for evaluation, oldest watermark first, bounded. */
  private async findDueRules(limit: number): Promise<AlertRuleRow[]> {
    const r = await pool.query<AlertRuleRow>(
      `SELECT * FROM alert_rules
       WHERE enabled AND deleted_at IS NULL
         AND (last_evaluated_at IS NULL
              OR last_evaluated_at + evaluation_interval_seconds * interval '1 second' <= now())
       ORDER BY last_evaluated_at ASC NULLS FIRST
       LIMIT $1`,
      [limit],
    );
    const rows = await Promise.all(r.rows.map(async (rule) => ({
      rule,
      v2: await isEnabled(FEATURE_FLAGS.ALERTING_V2_EVALUATION, {
        organizationId: rule.organization_id,
        projectId: rule.project_id,
      }, false),
    })));
    return rows.filter((entry) => !entry.v2).map((entry) => entry.rule);
  }

  /**
   * Evaluate one rule end-to-end. Returns the outcome for tick metrics.
   * Throws on query error (the caller catches and leaves the watermark).
   */
  private async evaluateOneRule(rule: AlertRuleRow): Promise<'fired' | 'breaching' | 'cooldown' | 'recovered' | 'clear' | 'no_conditions'> {
    const [conditions] = await Promise.all([this.repo.getRuleConditions(rule.id)]);
    if (conditions.length === 0) {
      await this.markEvaluated(rule.id, 0);
      return 'no_conditions';
    }

    // 1–2. Evaluate each condition (bounded single-round-trip queries).
    const outcomes: ConditionOutcome[] = [];
    for (const condition of conditions) {
      outcomes.push(await this.evaluateCondition(rule, condition));
    }
    const evaluated = outcomes.filter((o) => o.evaluated);
    if (evaluated.length === 0) {
      // Every condition was unmappable — mapped-skip still advances the watermark.
      await this.markEvaluated(rule.id, 0);
      return 'no_conditions';
    }

    // Combine via the shared grouping semantics (groups OR, ungrouped AND).
    const payload: Record<string, unknown> = {};
    const evaluable: EvaluableCondition[] = [];
    for (const o of evaluated) {
      setPath(payload, o.condition.field_path, o.actual);
      evaluable.push({
        id: o.condition.id,
        conditionGroupId: o.condition.condition_group_id,
        fieldPath: o.condition.field_path,
        operator: o.operator,
        thresholdValue: o.threshold,
        isRequired: o.condition.is_required,
      });
    }
    const matched = evaluateRule(payload, evaluable).matched;

    // 3. Consecutive-breach accounting.
    const metadata = (rule.metadata ?? {}) as Record<string, unknown>;
    const required = toPositiveInt(
      metadata.consecutiveBreachesRequired ?? (rule.annotations as Record<string, unknown> | undefined)?.consecutiveBreaches,
      1,
    );
    const previous = toNonNegativeInt(metadata.consecutiveBreaches, 0);

    if (matched) {
      const current = previous + 1;
      await this.markEvaluated(rule.id, current);
      if (current < required) return 'breaching';

      // 4. Cooldown: an active event with the same fingerprint inside the
      //    cooldown window suppresses re-firing.
      const fingerprint = this.fingerprintFor(rule);
      const existing = await this.repo.findActiveEventByFingerprint(
        rule.organization_id, fingerprint, rule.cooldown_seconds, rule.project_id,
      );
      if (existing) return 'cooldown';

      // 5. FIRE through the single ingestion entry point.
      await this.fire(rule, fingerprint, outcomes, current);
      return 'fired';
    }

    // Clear: reset the breach counter + advance the watermark.
    await this.markEvaluated(rule.id, 0);

    // 6. RECOVERY: resolve previously-firing events for this rule fingerprint.
    if (previous > 0) {
      const resolved = await this.recover(rule);
      return resolved > 0 ? 'recovered' : 'clear';
    }
    return 'clear';
  }

  /** Advance the watermark + persist the consecutive-breach counter atomically. */
  private async markEvaluated(ruleId: string, consecutiveBreaches: number): Promise<void> {
    await pool.query(
      `UPDATE alert_rules
       SET last_evaluated_at = now(),
           metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{consecutiveBreaches}', to_jsonb($2::int), true)
       WHERE id = $1`,
      [ruleId, consecutiveBreaches],
    );
  }

  /** Dedup/cooldown fingerprint: rule.id + ':' + (project_id ?? 'org') + ':' + source. */
  private fingerprintFor(rule: AlertRuleRow): string {
    return `${rule.id}:${rule.project_id ?? 'org'}:${EVAL_SOURCE}`;
  }

  /** Fire the rule via EventsService.ingestEvent (dedup/silence/pending persist). */
  private async fire(
    rule: AlertRuleRow,
    fingerprint: string,
    outcomes: ConditionOutcome[],
    consecutiveBreaches: number,
  ): Promise<void> {
    const lookbackMinutes = Math.max(1, ...outcomes.map((o) => o.condition.lookback_minutes ?? 1));
    const conditionSummaries = outcomes.map((o) => ({
      fieldPath: o.condition.field_path,
      operator: o.operator,
      threshold: o.threshold,
      actual: o.actual,
      evaluated: o.evaluated,
    }));
    const breaching = outcomes.find((o) => o.evaluated);

    // DEV-002 dry-run: the breach is real and fully evaluated, but no alert event is created,
    // so no notification can be delivered. This is what prevents an alert storm when the
    // evaluator starts seeing telemetry it could not previously read.
    if (this.dryRun) {
      this.log.warn(
        {
          ruleId: rule.id,
          orgId: rule.organization_id,
          projectId: rule.project_id,
          fingerprint,
          consecutiveBreaches,
          actual: breaching?.actual ?? null,
          threshold: breaching?.threshold ?? null,
          lookbackMinutes,
        },
        'DRY-RUN: alert rule would have fired (no alert event created)',
      );
      return;
    }

    await this.eventsService.ingestEvent(rule.organization_id, {
      ruleId: rule.id,
      projectId: rule.project_id ?? undefined,
      severity: rule.severity,
      source: EVAL_SOURCE,
      fingerprint,
      payload: {
        title: `Alert: ${rule.name}`,
        message: `${rule.name} breached its threshold (value ${formatActual(breaching?.actual)}, window ${lookbackMinutes}m)`,
        value: breaching?.actual ?? null,
        threshold: breaching?.threshold ?? null,
        window: { lookbackMinutes },
        conditions: conditionSummaries,
        rule: { id: rule.id, name: rule.name, presetKey: rule.preset_key, projectId: rule.project_id },
        projectId: rule.project_id,
      },
      labels: {
        rule_id: rule.id,
        ...(rule.project_id ? { project_id: rule.project_id } : {}),
        ...(rule.preset_key ? { preset_key: rule.preset_key } : {}),
        source: EVAL_SOURCE,
      },
      annotations: { consecutiveBreaches, evaluatedAt: new Date().toISOString() },
    });
    this.log.info(
      { ruleId: rule.id, orgId: rule.organization_id, projectId: rule.project_id, consecutiveBreaches },
      'Alert rule fired',
    );
  }

  /** Resolve all active events carrying the rule fingerprint (auto-recovery). */
  private async recover(rule: AlertRuleRow): Promise<number> {
    // DEV-002 dry-run: auto-resolve is also a state mutation, so it is suppressed too.
    // Resolving alerts that a dry-run evaluator never fired would corrupt real alert state.
    if (this.dryRun) return 0;

    // alert_events is control-plane owned in this increment (legacy runtime), so this
    // deliberately stays on the primary pool — only `events_*` moved to the telemetry pool.
    const active = await pool.query<{ id: string }>(
      `SELECT id FROM alert_events
       WHERE organization_id = $1 AND fingerprint = $2
         AND status IN ('firing', 'acknowledged', 'pending', 'processing')
         AND ($3::uuid IS NULL OR project_id = $3)
       ORDER BY started_at DESC
       LIMIT 50`,
      [rule.organization_id, this.fingerprintFor(rule), rule.project_id],
    );
    for (const row of active.rows) {
      await this.repo.resolveEvent(rule.organization_id, row.id, null, 'auto', true);
      await this.repo.insertHistory({
        eventId: row.id, organizationId: rule.organization_id,
        action: 'auto_resolved', actorId: null, actorType: 'worker',
        metadata: { reason: 'condition_cleared', ruleId: rule.id },
      });
    }
    if (active.rows.length > 0) {
      this.log.info(
        { ruleId: rule.id, orgId: rule.organization_id, resolved: active.rows.length },
        'Alert rule recovered',
      );
    }
    return active.rows.length;
  }

  // ── Condition → SQL mapping ─────────────────────────────────────────────
  //
  // Every query shares the same scope fragment:
  //   organization_id = $2
  //   AND timestamp >= now() - (GREATEST($1::int, 1) || ' minutes')::interval
  //   AND ($3::uuid IS NULL OR project_id = $3)
  // where $1 = lookbackMinutes, $2 = rule.organization_id, $3 = rule.project_id.
  //
  // kinds:
  //   error_count        events_errors count
  //   error_rate         100 * errors / NULLIF(requests, 0)  (CTE, both tables)
  //   request_count      events_requests count
  //   latency_avg        avg(latency_ms)
  //   latency_p95/p99    percentile_cont(0.95/0.99) WITHIN GROUP (ORDER BY latency_ms)
  //   5xx_rate           100 * count(status_code >= 500) / count(*)
  //   degraded_rate      100 * count(status_code >= 500 OR latency_ms >= 10000) / count(*)
  //   cron_failures      events_cron_checkins count(status = 'error')
  //   log_error_count    events_logs count(level = 'error')
  //   log_matches        events_logs count(message ILIKE/~ pattern) w/ LIMIT guard
  //   inactivity_minutes minutes since last events_requests row (1e9 when none)
  //   ai_failed_requests ai_usage_logs count(status != success)
  //   ai_duration_p95    percentile_cont(0.95) over ai_usage_logs.duration_ms
  //   ai_credits_used    sum(ai_usage_logs.credits_used)
  //   ai_cost_usd        sum(ai_usage_logs.estimated_cost_usd)
  //   ai_tokens_used     sum(ai_usage_logs.total_tokens)
  //   metric:<name>      aggregateFunction over events_metrics.value

  private async evaluateCondition(rule: AlertRuleRow, condition: AlertRuleConditionRow): Promise<ConditionOutcome> {
    const base: ConditionOutcome = {
      condition, evaluated: false, actual: null,
      operator: condition.operator, threshold: condition.threshold_value,
    };
    const lookback = Math.max(1, condition.lookback_minutes ?? 5);
    const kind = mapFieldPathToKind(condition.field_path, condition.aggregate_function);
    if (!kind) {
      this.log.debug(
        { ruleId: rule.id, conditionId: condition.id, fieldPath: condition.field_path },
        'Condition fieldPath not mappable to an event query — skipping (fail-open)',
      );
      return base;
    }

    const params: unknown[] = [lookback, rule.organization_id, rule.project_id];
    let sql: string;
    // Log-pattern conditions compare count >= 1; the pattern is the threshold value.
    let operator: ConditionOutcome['operator'] = condition.operator;
    let threshold: unknown = condition.threshold_value;

    const scope = `organization_id = $2
       AND occurred_at >= now() - (GREATEST($1::int, 1) || ' minutes')::interval
       AND ($3::uuid IS NULL OR project_id = $3)`;

    switch (kind.name) {
      case 'error_count':
        sql = `SELECT count(*)::float8 AS value FROM events_errors WHERE ${scope}`;
        break;
      case 'error_rate':
        sql = `WITH e AS (SELECT count(*)::float8 AS n FROM events_errors WHERE ${scope}),
                    r AS (SELECT count(*)::float8 AS n FROM events_requests WHERE ${scope})
               SELECT CASE WHEN r.n > 0 THEN 100.0 * e.n / r.n ELSE NULL END AS value FROM e, r`;
        break;
      case 'request_count':
        sql = `SELECT count(*)::float8 AS value FROM events_requests WHERE ${scope}`;
        break;
      case 'latency_avg':
        sql = `SELECT avg(latency_ms)::float8 AS value FROM events_requests WHERE ${scope}`;
        break;
      case 'latency_p95':
        sql = `SELECT percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms)::float8 AS value FROM events_requests WHERE ${scope}`;
        break;
      case 'latency_p99':
        sql = `SELECT percentile_cont(0.99) WITHIN GROUP (ORDER BY latency_ms)::float8 AS value FROM events_requests WHERE ${scope}`;
        break;
      case '5xx_rate':
        sql = `SELECT CASE WHEN count(*) > 0
                      THEN 100.0 * count(*) FILTER (WHERE status_code >= 500) / count(*)
                      ELSE NULL END AS value
               FROM events_requests WHERE ${scope}`;
        break;
      case 'degraded_rate':
        sql = `SELECT CASE WHEN count(*) > 0
                      THEN 100.0 * count(*) FILTER (WHERE status_code >= 500 OR latency_ms >= 10000) / count(*)
                      ELSE NULL END AS value
               FROM events_requests WHERE ${scope}`;
        break;
      case 'cron_failures':
        sql = `SELECT count(*)::float8 AS value FROM events_cron_checkins WHERE ${scope} AND status = 'error'`;
        break;
      case 'log_error_count':
        sql = `SELECT count(*)::float8 AS value FROM events_logs WHERE ${scope} AND level = 'error'`;
        break;
      case 'log_matches': {
        const pattern = typeof condition.threshold_value === 'string' ? condition.threshold_value : null;
        if (!pattern) {
          this.log.debug({ ruleId: rule.id, conditionId: condition.id }, 'log_matches condition has no string pattern — skipping');
          return base;
        }
        const useRegex = condition.operator === 'regex';
        params.push(useRegex ? pattern : `%${escapeLike(pattern)}%`);
        sql = `SELECT count(*)::float8 AS value FROM (
                 SELECT 1 FROM events_logs
                 WHERE ${scope} AND message ${useRegex ? '~' : 'ILIKE'} $4
                 LIMIT ${LOG_SCAN_LIMIT}
               ) scan`;
        operator = 'gte';
        threshold = 1;
        break;
      }
      case 'inactivity_minutes':
        sql = `SELECT COALESCE(EXTRACT(EPOCH FROM (now() - max(occurred_at))) / 60.0, 1e9)::float8 AS value
               FROM events_requests WHERE ${scope}`;
        break;
      case 'ai_failed_requests':
        sql = `SELECT count(*)::float8 AS value
               FROM ai_usage_logs
               WHERE organization_id = $2
                 AND occurred_at >= now() - (GREATEST($1::int, 1) || ' minutes')::interval
                 AND ($3::uuid IS NULL OR project_id = $3)
                 AND status IN ('failed', 'timeout', 'cancelled')`;
        break;
      case 'ai_duration_p95':
        sql = `SELECT percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms)::float8 AS value
               FROM ai_usage_logs
               WHERE organization_id = $2
                 AND occurred_at >= now() - (GREATEST($1::int, 1) || ' minutes')::interval
                 AND ($3::uuid IS NULL OR project_id = $3)
                 AND duration_ms IS NOT NULL`;
        break;
      case 'ai_credits_used':
        sql = `SELECT COALESCE(sum(credits_used), 0)::float8 AS value
               FROM ai_usage_logs
               WHERE organization_id = $2
                 AND occurred_at >= now() - (GREATEST($1::int, 1) || ' minutes')::interval
                 AND ($3::uuid IS NULL OR project_id = $3)`;
        break;
      case 'ai_cost_usd':
        sql = `SELECT COALESCE(sum(estimated_cost_usd), 0)::float8 AS value
               FROM ai_usage_logs
               WHERE organization_id = $2
                 AND occurred_at >= now() - (GREATEST($1::int, 1) || ' minutes')::interval
                 AND ($3::uuid IS NULL OR project_id = $3)`;
        break;
      case 'ai_tokens_used':
        sql = `SELECT COALESCE(sum(total_tokens), 0)::float8 AS value
               FROM ai_usage_logs
               WHERE organization_id = $2
                 AND occurred_at >= now() - (GREATEST($1::int, 1) || ' minutes')::interval
                 AND ($3::uuid IS NULL OR project_id = $3)`;
        break;
      case 'metric': {
        const metricName = kind.metricName;
        if (!metricName) return base;
        params.push(metricName);
        const agg = metricAggregateSql(condition.aggregate_function);
        sql = `SELECT ${agg} AS value FROM events_metrics WHERE ${scope} AND metric_name = $4`;
        break;
      }
      default:
        return base;
    }

    // ADR-0006 / DEV-002: `events_*` live in the Log DB; `ai_usage_logs` is control-plane.
    // Route each condition query to the pool that actually owns its table.
    const db = kind.name.startsWith('ai_') ? pool : this.telemetry;
    const r = await db.query<{ value: number | null }>(sql, params);
    return { ...base, evaluated: true, actual: r.rows[0]?.value ?? null, operator, threshold };
  }

  // ── Preset seeding ──────────────────────────────────────────────────────

  /**
   * Seed default presets for orgs that have observability traffic in the last
   * 24h but zero preset rules. One grouped query, then seed each org.
   */
  private async seedPresetsForActiveOrgs(): Promise<number> {
    // DEV-002: this was ONE query joining telemetry (`events_*`) to configuration
    // (`alert_rules`). That is only possible when both live in the same database. With the
    // Log DB separated it must be two queries — telemetry first, then a configuration filter.
    let orgIds: string[];
    try {
      const active = await this.telemetry.query<{ organization_id: string }>(
        `SELECT t.organization_id
         FROM (
           SELECT organization_id FROM events_requests WHERE occurred_at >= now() - interval '24 hours'
           UNION
           SELECT organization_id FROM events_errors WHERE occurred_at >= now() - interval '24 hours'
         ) t
         GROUP BY t.organization_id
         LIMIT 500`,
      );
      const activeOrgIds = active.rows.map((row) => row.organization_id);
      if (activeOrgIds.length === 0) return 0;

      const unseeded = await pool.query<{ organization_id: string }>(
        `SELECT candidate.organization_id
         FROM unnest($1::uuid[]) AS candidate(organization_id)
         WHERE NOT EXISTS (
           SELECT 1 FROM alert_rules ar
           WHERE ar.organization_id = candidate.organization_id
             AND ar.preset_key IS NOT NULL AND ar.deleted_at IS NULL
         )
         LIMIT 100`,
        [activeOrgIds],
      );
      orgIds = unseeded.rows.map((row) => row.organization_id);
    } catch (err) {
      this.log.error({ err }, 'Preset seed scan failed');
      return 0;
    }

    let seeded = 0;
    for (const orgId of orgIds) {
      try {
        const count = await seedDefaultPresetsForOrg(pool, orgId);
        if (count > 0) {
          seeded += 1;
          this.log.info({ orgId, presets: count }, 'Seeded default alert presets');
        }
      } catch (err) {
        this.log.error({ err, orgId }, 'Preset seeding failed for org');
      }
    }
    return seeded;
  }
}

// ── Field-path mapping helpers ────────────────────────────────────────────

type ConditionKind =
  | { name: 'error_count' | 'error_rate' | 'request_count' | 'latency_avg' | 'latency_p95' | 'latency_p99' | '5xx_rate' | 'degraded_rate' | 'cron_failures' | 'log_error_count' | 'log_matches' | 'inactivity_minutes' | 'ai_failed_requests' | 'ai_duration_p95' | 'ai_credits_used' | 'ai_cost_usd' | 'ai_tokens_used'; metricName?: never }
  | { name: 'metric'; metricName: string };

const FIELD_PATH_KINDS: Record<string, Exclude<ConditionKind, { name: 'metric' }>['name']> = {
  'errors.count': 'error_count',
  'error.count': 'error_count',
  'errors.rate': 'error_rate',
  'error.rate': 'error_rate',
  'errors.error_rate': 'error_rate',
  'requests.count': 'request_count',
  'traffic.count': 'request_count',
  'requests.latency.avg': 'latency_avg',
  'requests.duration.avg': 'latency_avg',
  'latency.avg': 'latency_avg',
  'duration.avg': 'latency_avg',
  'requests.latency.p95': 'latency_p95',
  'latency.p95': 'latency_p95',
  'duration.p95': 'latency_p95',
  'requests.latency.p99': 'latency_p99',
  'latency.p99': 'latency_p99',
  'duration.p99': 'latency_p99',
  'requests.error_rate': '5xx_rate',
  'requests.5xx_rate': '5xx_rate',
  '5xx.rate': '5xx_rate',
  'errors.5xx_rate': '5xx_rate',
  'requests.degraded_rate': 'degraded_rate',
  'availability.degraded_rate': 'degraded_rate',
  'cron.failures': 'cron_failures',
  'cron.failed': 'cron_failures',
  'crons.failures': 'cron_failures',
  'logs.error_count': 'log_error_count',
  'logs.matches': 'log_matches',
  'logs.pattern': 'log_matches',
  'log.matches': 'log_matches',
  'requests.inactivity_minutes': 'inactivity_minutes',
  'service.inactivity_minutes': 'inactivity_minutes',
  'ai.requests.failed': 'ai_failed_requests',
  'ai.failures': 'ai_failed_requests',
  'ai.duration.p95': 'ai_duration_p95',
  'ai.latency.p95': 'ai_duration_p95',
  'ai.credits.used': 'ai_credits_used',
  'ai.cost.usd': 'ai_cost_usd',
  'ai.tokens.used': 'ai_tokens_used',
};

function mapFieldPathToKind(fieldPath: string, aggregateFunction: string | null): ConditionKind | null {
  const normalized = fieldPath.trim().toLowerCase();
  if (normalized.startsWith('metrics.')) return { name: 'metric', metricName: fieldPath.trim().slice('metrics.'.length) };
  if (normalized.startsWith('metric.')) return { name: 'metric', metricName: fieldPath.trim().slice('metric.'.length) };
  const kind = FIELD_PATH_KINDS[normalized];
  if (!kind) return null;
  // An explicit p99 aggregate upgrades the plain avg latency mapping.
  if (kind === 'latency_avg' && aggregateFunction === 'p99') return { name: 'latency_p99' };
  return { name: kind };
}

/** Aggregate SQL for events_metrics.value; whitelist only (no interpolation of user input). */
function metricAggregateSql(aggregateFunction: string | null): string {
  switch (aggregateFunction) {
    case 'sum': return 'sum(value)::float8';
    case 'count': return 'count(*)::float8';
    case 'max': return 'max(value)::float8';
    case 'min': return 'min(value)::float8';
    case 'p99': return 'percentile_cont(0.99) WITHIN GROUP (ORDER BY value)::float8';
    case 'avg':
    default: return 'avg(value)::float8';
  }
}

function escapeLike(pattern: string): string {
  return pattern.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/** Set a dotted path on a nested object (mirrors evaluator.ts readPath). */
function setPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const segments = path.split('.');
  let cur: Record<string, unknown> = obj;
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i]!;
    const next = cur[seg];
    if (next === null || typeof next !== 'object' || Array.isArray(next)) {
      cur[seg] = {};
    }
    cur = cur[seg] as Record<string, unknown>;
  }
  cur[segments[segments.length - 1]!] = value;
}

function toPositiveInt(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isInteger(n) && n >= 1 ? n : fallback;
}

function toNonNegativeInt(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isInteger(n) && n >= 0 ? n : fallback;
}

function formatActual(actual: unknown): string {
  return typeof actual === 'number' ? actual.toFixed(2) : String(actual ?? 'n/a');
}

/** Bounded-concurrency map (same shape as queue.ts — one failure never aborts). */
async function mapBounded<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
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
