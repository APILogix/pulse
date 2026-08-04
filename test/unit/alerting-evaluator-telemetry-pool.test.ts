/**
 * DEV-002 — telemetry pool routing and dry-run gating.
 *
 * Architecture: docs/alerting-redesign/DEVIATIONS.md DEV-002 (option 2)
 *               docs/alerting-redesign/adr/0006-database-ownership.md
 *
 * What these lock down:
 *   1. `events_*` reads go to the INJECTED telemetry pool.
 *   2. `ai_usage_logs` reads stay on the control-plane pool (it does not exist in the Log DB).
 *   3. `alert_rules` / `alert_events` reads stay on the control-plane pool.
 *   4. Preset seeding no longer issues a cross-database join.
 *   5. Firing is suppressed by default when the pools differ, and NOT suppressed when they are
 *      the same object (single-database deployments keep their existing behaviour).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** Records every query so we can assert which pool received which table. */
interface Recorded { sql: string; params?: unknown[] }

function poolStub(label: string, log: Array<Recorded & { pool: string }>) {
  return {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      log.push({ pool: label, sql, params });
      // Shapes below satisfy every caller in the evaluator under test.
      // Branches are pattern-based rather than call-ordered so that every query is still
      // recorded; mockResolvedValueOnce would replace this implementation and lose the record.
      if (/FROM alert_rules\b/i.test(sql) && /last_evaluated_at/i.test(sql)) return { rows: [] };
      // Config-side preset filter: return no org so real preset seeding is never invoked.
      if (/unnest\(\$1::uuid\[\]\)/i.test(sql)) return { rows: [] };
      // Telemetry-side active-org scan.
      if (/events_requests[\s\S]*UNION/i.test(sql)) return { rows: [{ organization_id: 'org1' }] };
      if (/FROM alert_events/i.test(sql)) return { rows: [{ id: 'e1' }] };
      return { rows: [{ value: 1 }] };
    }),
    connect: vi.fn(),
  };
}

const primaryLog: Array<Recorded & { pool: string }> = [];
const primary = poolStub('primary', primaryLog);

vi.mock('../../src/config/database.js', () => ({ pool: primary }));
vi.mock('../../src/modules/alerting/repository.js', () => ({
  AlertingRepository: class {
    getRuleConditions = vi.fn(async () => []);
    resolveEvent = vi.fn();
    insertHistory = vi.fn();
    findActiveEventByFingerprint = vi.fn(async () => null);
  },
}));
const ingestEvent = vi.fn(async () => ({}));
vi.mock('../../src/modules/alerting/events/events.service.js', () => ({
  EventsService: class { ingestEvent = ingestEvent; },
}));
const thresholdTick = vi.fn(async () => ({ due: 0, evaluated: 0, fired: 0, recovered: 0, failed: 0 }));
let thresholdPool: unknown;
vi.mock('../../src/modules/projects/alerts/thresholds/threshold.worker.js', () => ({
  ProjectThresholdWorker: class {
    constructor(_logger: unknown, telemetryPool?: unknown) { thresholdPool = telemetryPool; }
    runTick = thresholdTick;
  },
}));

const { AlertRuleEvaluator } = await import(
  '../../src/modules/alerting/evaluator/rule-evaluator.js'
);
const { resolveEvaluatorDryRun } = await import(
  '../../src/modules/alerting/evaluator/dry-run.js'
);

function logger() {
  const l: Record<string, unknown> = {};
  l.child = () => l;
  l.info = vi.fn(); l.warn = vi.fn(); l.error = vi.fn(); l.debug = vi.fn();
  return l as never;
}

describe('DEV-002 evaluator telemetry pool routing', () => {
  let telemetryLog: Array<Recorded & { pool: string }>;
  let telemetry: ReturnType<typeof poolStub>;

  beforeEach(() => {
    primaryLog.length = 0;
    telemetryLog = [];
    telemetry = poolStub('telemetry', telemetryLog);
    ingestEvent.mockClear();
    thresholdPool = undefined;
  });

  function evaluator(pool?: unknown, dryRun?: boolean) {
    return new AlertRuleEvaluator(logger(), pool as never, dryRun);
  }

  function condition(fieldPath: string) {
    return {
      id: 'c1', rule_id: 'r1', condition_type: 'threshold', condition_group_id: null,
      field_path: fieldPath, operator: 'gte', threshold_value: 1,
      lookback_minutes: 5, aggregate_function: null, sub_query: {},
      is_required: true, order_index: 0,
    };
  }

  const rule = {
    id: 'r1', organization_id: 'org1', project_id: null, name: 'r',
    severity: 'error', enabled: true, cooldown_seconds: 0,
    deduplication_window_seconds: 3600, evaluation_interval_seconds: 60,
    metadata: {}, annotations: {}, preset_key: null,
  };

  /** Reach the private condition evaluator directly: routing is the unit under test. */
  async function evaluateCondition(ev: unknown, fieldPath: string) {
    return (ev as { evaluateCondition: (r: unknown, c: unknown) => Promise<unknown> })
      .evaluateCondition(rule, condition(fieldPath));
  }

  it('routes events_* condition queries to the injected telemetry pool', async () => {
    const ev = evaluator(telemetry);
    await evaluateCondition(ev, 'errors.count');

    expect(telemetryLog).toHaveLength(1);
    expect(telemetryLog[0]!.sql).toMatch(/FROM events_errors/);
    expect(primaryLog.filter((q) => /events_errors/.test(q.sql))).toHaveLength(0);
  });

  it.each([
    ['errors.rate', /events_errors[\s\S]*events_requests/],
    ['requests.latency.p95', /percentile_cont[\s\S]*events_requests/],
    ['logs.error_count', /FROM events_logs/],
    ['cron.failures', /FROM events_cron_checkins/],
    ['requests.inactivity_minutes', /FROM events_requests/],
  ])('routes %s to the telemetry pool', async (fieldPath, pattern) => {
    const ev = evaluator(telemetry);
    await evaluateCondition(ev, fieldPath);

    expect(telemetryLog).toHaveLength(1);
    expect(telemetryLog[0]!.sql).toMatch(pattern);
  });

  it.each([
    'ai.requests.failed',
    'ai.duration.p95',
    'ai.credits.used',
    'ai.cost.usd',
  ])('keeps %s on the control-plane pool (ai_usage_logs is not in the Log DB)', async (fieldPath) => {
    const ev = evaluator(telemetry);
    await evaluateCondition(ev, fieldPath);

    expect(telemetryLog).toHaveLength(0);
    expect(primaryLog).toHaveLength(1);
    expect(primaryLog[0]!.sql).toMatch(/FROM ai_usage_logs/);
  });

  it('reads due rules from the control-plane pool, never the telemetry pool', async () => {
    const ev = evaluator(telemetry);
    await (ev as { findDueRules: (n: number) => Promise<unknown> }).findDueRules(10);

    expect(primaryLog.some((q) => /FROM alert_rules/.test(q.sql))).toBe(true);
    expect(telemetryLog).toHaveLength(0);
  });

  it('splits preset seeding into telemetry then configuration (no cross-database join)', async () => {
    const ev = evaluator(telemetry);

    await (ev as { seedPresetsForActiveOrgs: () => Promise<number> }).seedPresetsForActiveOrgs();

    // Telemetry side selects active orgs and must NOT mention alert_rules.
    expect(telemetryLog).toHaveLength(1);
    expect(telemetryLog[0]!.sql).toMatch(/events_requests[\s\S]*events_errors/);
    expect(telemetryLog[0]!.sql).not.toMatch(/alert_rules/);

    // Configuration side filters by org id and must NOT mention events_*.
    const configQuery = primaryLog.find((q) => /alert_rules/.test(q.sql));
    expect(configQuery).toBeDefined();
    expect(configQuery!.sql).not.toMatch(/events_requests|events_errors/);
    expect(configQuery!.params).toEqual([['org1']]);
  });

  it('passes the telemetry pool down to the project threshold worker', () => {
    evaluator(telemetry);
    expect(thresholdPool).toBe(telemetry);
  });

  // ── dry-run gating ─────────────────────────────────────────────────────────

  it('defaults to dry-run when the telemetry pool differs from the config pool', async () => {
    const ev = evaluator(telemetry);
    await (ev as { fire: (...a: unknown[]) => Promise<void> }).fire(rule, 'fp', [], 1);

    expect(ingestEvent).not.toHaveBeenCalled();
  });

  it('does NOT dry-run when both pools are the same object (single-database deployment)', async () => {
    const ev = evaluator(primary);
    await (ev as { fire: (...a: unknown[]) => Promise<void> }).fire(rule, 'fp', [], 1);

    expect(ingestEvent).toHaveBeenCalledTimes(1);
  });

  it('does not dry-run when no telemetry pool is injected at all', async () => {
    const ev = evaluator(undefined);
    await (ev as { fire: (...a: unknown[]) => Promise<void> }).fire(rule, 'fp', [], 1);

    expect(ingestEvent).toHaveBeenCalledTimes(1);
  });

  it('an explicit dryRun=false forces firing even with separate pools', async () => {
    const ev = evaluator(telemetry, false);
    await (ev as { fire: (...a: unknown[]) => Promise<void> }).fire(rule, 'fp', [], 1);

    expect(ingestEvent).toHaveBeenCalledTimes(1);
  });

  it('an explicit dryRun=true forces dry-run even on a single database', async () => {
    const ev = evaluator(primary, true);
    await (ev as { fire: (...a: unknown[]) => Promise<void> }).fire(rule, 'fp', [], 1);

    expect(ingestEvent).not.toHaveBeenCalled();
  });

  // The env → flag mapping lives in one pure function so it is testable without
  // importing environment validation into the evaluator (that coupling caused a regression).
  it.each([
    ['true' as const, false, true],
    ['true' as const, true, true],
    ['false' as const, true, false],
    ['false' as const, false, false],
    [undefined, true, true],
    [undefined, false, false],
  ])('resolveEvaluatorDryRun(%s, poolsDiffer=%s) = %s', (envValue, poolsDiffer, expected) => {
    expect(resolveEvaluatorDryRun(envValue, poolsDiffer)).toBe(expected);
  });

  it('suppresses auto-resolve in dry-run so real alert state is never mutated', async () => {
    const ev = evaluator(telemetry);
    const resolved = await (ev as { recover: (r: unknown) => Promise<number> }).recover(rule);

    expect(resolved).toBe(0);
    // No alert_events lookup should even be attempted.
    expect(primaryLog.some((q) => /FROM alert_events/.test(q.sql))).toBe(false);
  });

  it('performs auto-resolve when firing is enabled', async () => {
    const ev = evaluator(telemetry, false);

    const resolved = await (ev as { recover: (r: unknown) => Promise<number> }).recover(rule);

    expect(resolved).toBe(1);
    expect(primaryLog.some((q) => /FROM alert_events/.test(q.sql))).toBe(true);
  });
});
