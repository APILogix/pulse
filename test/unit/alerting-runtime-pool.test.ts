/**
 * Increment 1 — ADR-0006 boot assertion tests.
 *
 * Architecture: docs/alerting-redesign/adr/0006-database-ownership.md
 *               docs/alerting-redesign/08-implementation-plan.md (Increment 1, Testing)
 *
 * These cover the behaviour that converts audit finding B1 (alerting pool attached to a
 * database with no telemetry) from a silent failure into a startup crash.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

process.env.ALERTING_RUNTIME_POOL_ASSERT = process.env.ALERTING_RUNTIME_POOL_ASSERT ?? 'true';

const envMock = { ALERTING_RUNTIME_POOL_ASSERT: true };

vi.mock('../../src/config/env.js', () => ({ env: envMock }));

const { register } = await import('../../src/config/metrics.js');
const {
  ALERTING_CONFIG_REQUIRED_TABLES,
  ALERTING_RUNTIME_REQUIRED_TABLES,
  AlertingRuntimePoolError,
  assertAlertingPool,
  inspectAlertingPool,
} = await import('../../src/modules/alerting/runtime/runtime-pool.js');

type Row = { db: string; server_version: string; resolved: (string | null)[] };

/** Minimal pg.Pool stand-in: the guard only ever issues one probe query. */
function poolStub(row: Row | undefined, capture?: { params?: unknown[] }) {
  return {
    query: vi.fn(async (_sql: string, params?: unknown[]) => {
      if (capture) capture.params = params;
      return { rows: row ? [row] : [] };
    }),
  } as unknown as import('pg').Pool;
}

function loggerStub() {
  return {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  } as unknown as import('pino').Logger;
}

describe('alerting runtime pool guard', () => {
  beforeEach(() => {
    envMock.ALERTING_RUNTIME_POOL_ASSERT = true;
    register.resetMetrics();
  });

  it('probes exactly the tables required by the runtime role', async () => {
    const capture: { params?: unknown[] } = {};
    const pool = poolStub(
      { db: 'pulse_logs', server_version: '16.2', resolved: ['events_requests', 'alert_events_v2'] },
      capture,
    );

    const target = await inspectAlertingPool(pool, 'alerting_runtime');

    expect(capture.params).toEqual([[...ALERTING_RUNTIME_REQUIRED_TABLES]]);
    expect(target.database).toBe('pulse_logs');
    expect(target.present).toEqual(['events_requests', 'alert_events_v2']);
    expect(target.missing).toEqual([]);
  });

  it('probes exactly the tables required by the config role', async () => {
    const capture: { params?: unknown[] } = {};
    const pool = poolStub(
      {
        db: 'pulse',
        server_version: '16.2',
        resolved: ['alert_rules', 'alert_rule_conditions', 'alert_rule_actions'],
      },
      capture,
    );

    await inspectAlertingPool(pool, 'alerting_config');

    expect(capture.params).toEqual([[...ALERTING_CONFIG_REQUIRED_TABLES]]);
  });

  it('reports missing tables positionally, not by presence order', async () => {
    // events_requests resolves, alert_events_v2 does not (Log DB migration not applied).
    const pool = poolStub({
      db: 'pulse_logs',
      server_version: '16.2',
      resolved: ['events_requests', null],
    });

    const target = await inspectAlertingPool(pool, 'alerting_runtime');

    expect(target.present).toEqual(['events_requests']);
    expect(target.missing).toEqual(['alert_events_v2']);
  });

  it('throws AlertingRuntimePoolError when telemetry is not visible (audit B1)', async () => {
    // This is the exact production hazard: the pool is attached to the control plane,
    // which has no events_requests, so no telemetry-driven alert could ever fire.
    const pool = poolStub({
      db: 'pulse',
      server_version: '16.2',
      resolved: [null, null],
    });

    await expect(assertAlertingPool(pool, 'alerting_runtime', loggerStub()))
      .rejects.toBeInstanceOf(AlertingRuntimePoolError);

    await expect(assertAlertingPool(pool, 'alerting_runtime', loggerStub()))
      .rejects.toThrow(/events_requests, alert_events_v2/);
  });

  it('names the attached database in the failure so the fix is obvious', async () => {
    const pool = poolStub({ db: 'pulse', server_version: '16.2', resolved: [null, 'alert_events_v2'] });

    await expect(assertAlertingPool(pool, 'alerting_runtime', loggerStub()))
      .rejects.toThrow(/attached to database "pulse"/);
  });

  it('degrades to a logged error when the assertion is explicitly disabled', async () => {
    envMock.ALERTING_RUNTIME_POOL_ASSERT = false;
    const pool = poolStub({ db: 'pulse', server_version: '16.2', resolved: [null, null] });
    const logger = loggerStub();

    const target = await assertAlertingPool(pool, 'alerting_runtime', logger);

    expect(target.missing).toEqual(['events_requests', 'alert_events_v2']);
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it('publishes alerting_runtime_pool_target=1 for a healthy pool', async () => {
    const pool = poolStub({
      db: 'pulse_logs',
      server_version: '16.2',
      resolved: ['events_requests', 'alert_events_v2'],
    });

    await assertAlertingPool(pool, 'alerting_runtime', loggerStub());

    const metric = await register.getSingleMetric('alerting_runtime_pool_target')!.get();
    expect(metric.values).toEqual([
      expect.objectContaining({
        value: 1,
        labels: { role: 'alerting_runtime', db: 'pulse_logs' },
      }),
    ]);
  });

  it('publishes alerting_runtime_pool_target=0 when the assertion is bypassed', async () => {
    envMock.ALERTING_RUNTIME_POOL_ASSERT = false;
    const pool = poolStub({ db: 'pulse', server_version: '16.2', resolved: [null, null] });

    await assertAlertingPool(pool, 'alerting_runtime', loggerStub());

    const metric = await register.getSingleMetric('alerting_runtime_pool_target')!.get();
    expect(metric.values[0]).toMatchObject({ value: 0, labels: { db: 'pulse' } });
  });

  it('is idempotent across repeated calls (metric re-registration is safe)', async () => {
    const pool = poolStub({
      db: 'pulse_logs',
      server_version: '16.2',
      resolved: ['events_requests', 'alert_events_v2'],
    });

    await assertAlertingPool(pool, 'alerting_runtime', loggerStub());
    await expect(assertAlertingPool(pool, 'alerting_runtime', loggerStub())).resolves.toBeDefined();
  });

  it('fails loudly when the probe returns no rows (unusable connection)', async () => {
    const pool = poolStub(undefined);

    await expect(inspectAlertingPool(pool, 'alerting_runtime'))
      .rejects.toThrow(/health probe returned no rows/);
  });
});
