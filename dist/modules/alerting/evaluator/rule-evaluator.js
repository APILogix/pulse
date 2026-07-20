import { pool } from '../../../config/database.js';
import { AlertingRepository } from '../repository.js';
import { EventsService } from '../events/events.service.js';
import { evaluateRule } from '../evaluator.js';
import { seedDefaultPresetsForOrg } from './presets.js';
const EVAL_SOURCE = 'rule-evaluator';
const RULE_BATCH_LIMIT = 500;
const RULE_CONCURRENCY = 10;
/** Hard cap for the log-pattern scan (LIMIT guard) so a noisy window stays cheap. */
const LOG_SCAN_LIMIT = 10_000;
export class AlertRuleEvaluator {
    repo = new AlertingRepository();
    eventsService;
    log;
    constructor(logger) {
        this.log = logger.child({ component: 'alert-rule-evaluator' });
        this.eventsService = new EventsService({ repository: this.repo, logger });
    }
    /** One evaluator tick: rule evaluation + preset seeding. Never throws. */
    async runTick(limit = RULE_BATCH_LIMIT) {
        const summary = {
            rulesDue: 0, evaluated: 0, fired: 0, recovered: 0, cooldownSkipped: 0, failed: 0, orgsSeeded: 0,
        };
        const due = await this.findDueRules(limit);
        summary.rulesDue = due.length;
        await mapBounded(due, RULE_CONCURRENCY, async (rule) => {
            try {
                const outcome = await this.evaluateOneRule(rule);
                summary.evaluated += 1;
                if (outcome === 'fired')
                    summary.fired += 1;
                else if (outcome === 'recovered')
                    summary.recovered += 1;
                else if (outcome === 'cooldown')
                    summary.cooldownSkipped += 1;
            }
            catch (err) {
                // Query/transient error: last_evaluated_at is intentionally NOT
                // advanced so the rule is retried on the next tick.
                summary.failed += 1;
                this.log.error({ err, ruleId: rule.id, orgId: rule.organization_id }, 'Rule evaluation failed');
            }
        });
        summary.orgsSeeded = await this.seedPresetsForActiveOrgs();
        if (summary.evaluated > 0 || summary.fired > 0 || summary.orgsSeeded > 0 || summary.failed > 0) {
            this.log.info({ ...summary }, 'Rule evaluation tick finished');
        }
        return summary;
    }
    /** Enabled rules due for evaluation, oldest watermark first, bounded. */
    async findDueRules(limit) {
        const r = await pool.query(`SELECT * FROM alert_rules
       WHERE enabled AND deleted_at IS NULL
         AND (last_evaluated_at IS NULL
              OR last_evaluated_at + evaluation_interval_seconds * interval '1 second' <= now())
       ORDER BY last_evaluated_at ASC NULLS FIRST
       LIMIT $1`, [limit]);
        return r.rows;
    }
    /**
     * Evaluate one rule end-to-end. Returns the outcome for tick metrics.
     * Throws on query error (the caller catches and leaves the watermark).
     */
    async evaluateOneRule(rule) {
        const [conditions] = await Promise.all([this.repo.getRuleConditions(rule.id)]);
        if (conditions.length === 0) {
            await this.markEvaluated(rule.id, 0);
            return 'no_conditions';
        }
        // 1–2. Evaluate each condition (bounded single-round-trip queries).
        const outcomes = [];
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
        const payload = {};
        const evaluable = [];
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
        const metadata = (rule.metadata ?? {});
        const required = toPositiveInt(metadata.consecutiveBreachesRequired ?? rule.annotations?.consecutiveBreaches, 1);
        const previous = toNonNegativeInt(metadata.consecutiveBreaches, 0);
        if (matched) {
            const current = previous + 1;
            await this.markEvaluated(rule.id, current);
            if (current < required)
                return 'breaching';
            // 4. Cooldown: an active event with the same fingerprint inside the
            //    cooldown window suppresses re-firing.
            const fingerprint = this.fingerprintFor(rule);
            const existing = await this.repo.findActiveEventByFingerprint(rule.organization_id, fingerprint, rule.cooldown_seconds, rule.project_id);
            if (existing)
                return 'cooldown';
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
    async markEvaluated(ruleId, consecutiveBreaches) {
        await pool.query(`UPDATE alert_rules
       SET last_evaluated_at = now(),
           metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{consecutiveBreaches}', to_jsonb($2::int), true)
       WHERE id = $1`, [ruleId, consecutiveBreaches]);
    }
    /** Dedup/cooldown fingerprint: rule.id + ':' + (project_id ?? 'org') + ':' + source. */
    fingerprintFor(rule) {
        return `${rule.id}:${rule.project_id ?? 'org'}:${EVAL_SOURCE}`;
    }
    /** Fire the rule via EventsService.ingestEvent (dedup/silence/pending persist). */
    async fire(rule, fingerprint, outcomes, consecutiveBreaches) {
        const lookbackMinutes = Math.max(1, ...outcomes.map((o) => o.condition.lookback_minutes ?? 1));
        const conditionSummaries = outcomes.map((o) => ({
            fieldPath: o.condition.field_path,
            operator: o.operator,
            threshold: o.threshold,
            actual: o.actual,
            evaluated: o.evaluated,
        }));
        const breaching = outcomes.find((o) => o.evaluated);
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
        this.log.info({ ruleId: rule.id, orgId: rule.organization_id, projectId: rule.project_id, consecutiveBreaches }, 'Alert rule fired');
    }
    /** Resolve all active events carrying the rule fingerprint (auto-recovery). */
    async recover(rule) {
        const active = await pool.query(`SELECT id FROM alert_events
       WHERE organization_id = $1 AND fingerprint = $2
         AND status IN ('firing', 'acknowledged', 'pending', 'processing')
         AND ($3::uuid IS NULL OR project_id = $3)
       ORDER BY started_at DESC
       LIMIT 50`, [rule.organization_id, this.fingerprintFor(rule), rule.project_id]);
        for (const row of active.rows) {
            await this.repo.resolveEvent(rule.organization_id, row.id, null, 'auto', true);
            await this.repo.insertHistory({
                eventId: row.id, organizationId: rule.organization_id,
                action: 'auto_resolved', actorId: null, actorType: 'worker',
                metadata: { reason: 'condition_cleared', ruleId: rule.id },
            });
        }
        if (active.rows.length > 0) {
            this.log.info({ ruleId: rule.id, orgId: rule.organization_id, resolved: active.rows.length }, 'Alert rule recovered');
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
    //   metric:<name>      aggregateFunction over events_metrics.value
    async evaluateCondition(rule, condition) {
        const base = {
            condition, evaluated: false, actual: null,
            operator: condition.operator, threshold: condition.threshold_value,
        };
        const lookback = Math.max(1, condition.lookback_minutes ?? 5);
        const kind = mapFieldPathToKind(condition.field_path, condition.aggregate_function);
        if (!kind) {
            this.log.debug({ ruleId: rule.id, conditionId: condition.id, fieldPath: condition.field_path }, 'Condition fieldPath not mappable to an event query — skipping (fail-open)');
            return base;
        }
        const params = [lookback, rule.organization_id, rule.project_id];
        let sql;
        // Log-pattern conditions compare count >= 1; the pattern is the threshold value.
        let operator = condition.operator;
        let threshold = condition.threshold_value;
        const scope = `organization_id = $2
       AND timestamp >= now() - (GREATEST($1::int, 1) || ' minutes')::interval
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
                sql = `SELECT COALESCE(EXTRACT(EPOCH FROM (now() - max(timestamp))) / 60.0, 1e9)::float8 AS value
               FROM events_requests WHERE ${scope}`;
                break;
            case 'metric': {
                const metricName = kind.metricName;
                if (!metricName)
                    return base;
                params.push(metricName);
                const agg = metricAggregateSql(condition.aggregate_function);
                sql = `SELECT ${agg} AS value FROM events_metrics WHERE ${scope} AND metric_name = $4`;
                break;
            }
            default:
                return base;
        }
        const r = await pool.query(sql, params);
        return { ...base, evaluated: true, actual: r.rows[0]?.value ?? null, operator, threshold };
    }
    // ── Preset seeding ──────────────────────────────────────────────────────
    /**
     * Seed default presets for orgs that have observability traffic in the last
     * 24h but zero preset rules. One grouped query, then seed each org.
     */
    async seedPresetsForActiveOrgs() {
        let orgIds;
        try {
            const r = await pool.query(`SELECT t.organization_id
         FROM (
           SELECT organization_id FROM events_requests WHERE timestamp >= now() - interval '24 hours'
           UNION
           SELECT organization_id FROM events_errors WHERE timestamp >= now() - interval '24 hours'
         ) t
         WHERE NOT EXISTS (
           SELECT 1 FROM alert_rules ar
           WHERE ar.organization_id = t.organization_id
             AND ar.preset_key IS NOT NULL AND ar.deleted_at IS NULL
         )
         GROUP BY t.organization_id
         LIMIT 100`);
            orgIds = r.rows.map((row) => row.organization_id);
        }
        catch (err) {
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
            }
            catch (err) {
                this.log.error({ err, orgId }, 'Preset seeding failed for org');
            }
        }
        return seeded;
    }
}
const FIELD_PATH_KINDS = {
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
};
function mapFieldPathToKind(fieldPath, aggregateFunction) {
    const normalized = fieldPath.trim().toLowerCase();
    if (normalized.startsWith('metrics.'))
        return { name: 'metric', metricName: fieldPath.trim().slice('metrics.'.length) };
    if (normalized.startsWith('metric.'))
        return { name: 'metric', metricName: fieldPath.trim().slice('metric.'.length) };
    const kind = FIELD_PATH_KINDS[normalized];
    if (!kind)
        return null;
    // An explicit p99 aggregate upgrades the plain avg latency mapping.
    if (kind === 'latency_avg' && aggregateFunction === 'p99')
        return { name: 'latency_p99' };
    return { name: kind };
}
/** Aggregate SQL for events_metrics.value; whitelist only (no interpolation of user input). */
function metricAggregateSql(aggregateFunction) {
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
function escapeLike(pattern) {
    return pattern.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}
/** Set a dotted path on a nested object (mirrors evaluator.ts readPath). */
function setPath(obj, path, value) {
    const segments = path.split('.');
    let cur = obj;
    for (let i = 0; i < segments.length - 1; i++) {
        const seg = segments[i];
        const next = cur[seg];
        if (next === null || typeof next !== 'object' || Array.isArray(next)) {
            cur[seg] = {};
        }
        cur = cur[seg];
    }
    cur[segments[segments.length - 1]] = value;
}
function toPositiveInt(value, fallback) {
    const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
    return Number.isInteger(n) && n >= 1 ? n : fallback;
}
function toNonNegativeInt(value, fallback) {
    const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
    return Number.isInteger(n) && n >= 0 ? n : fallback;
}
function formatActual(actual) {
    return typeof actual === 'number' ? actual.toFixed(2) : String(actual ?? 'n/a');
}
/** Bounded-concurrency map (same shape as queue.ts — one failure never aborts). */
async function mapBounded(items, limit, fn) {
    const results = new Array(items.length);
    let cursor = 0;
    const lane = async () => {
        while (cursor < items.length) {
            const i = cursor++;
            const item = items[i];
            try {
                results[i] = { status: 'fulfilled', value: await fn(item) };
            }
            catch (reason) {
                results[i] = { status: 'rejected', reason };
            }
        }
    };
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
    return results;
}
//# sourceMappingURL=rule-evaluator.js.map