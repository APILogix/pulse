import { describe, expect, it, vi } from 'vitest';
import { AlertRuntimeRepository } from '../../src/modules/alerting/runtime/alert-runtime.repository.js';
import { alertFingerprint } from '../../src/modules/alerting/decision/decision.engine.js';
import {
  alertIdentityHash,
  computeAlertFingerprint,
} from '../../src/modules/alerting/runtime/alert-fingerprint.js';
import type { Pool } from 'pg';

const ORG = '00000000-0000-4000-8000-000000000001';
const PROJECT = '00000000-0000-4000-8000-000000000002';
const RULE = '00000000-0000-4000-8000-000000000003';

/**
 * In-memory Postgres stand-in that emulates the SERIALIZED semantics of
 * `claimBreachDecision`'s single atomic statement.
 *
 * The real guarantee comes from `INSERT .. ON CONFLICT DO UPDATE` taking a row
 * lock that the outer UPDATE holds for the remainder of the statement. Here we
 * reproduce that by serializing statements through a promise chain, which is the
 * behaviour Postgres exhibits for concurrent writers to the same row.
 */
function serializedEvalStateDb() {
  const store = new Map<string, {
    consecutive_breaches: number;
    is_breaching: boolean;
    last_fired_at: Date | null;
  }>();
  let tail: Promise<unknown> = Promise.resolve();
  let concurrentStatements = 0;
  let maxObservedConcurrency = 0;

  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    const run = async () => {
      concurrentStatements += 1;
      maxObservedConcurrency = Math.max(maxObservedConcurrency, concurrentStatements);
      try {
        // Yield to the event loop so any non-atomic implementation would
        // interleave here and expose a lost update.
        await new Promise((resolve) => setImmediate(resolve));

        if (sql.includes('alert_rule_eval_state') && sql.includes('WITH locked') && params.length === 11) {
          const scopeHash = params[0] as string;
          const evaluatedAt = new Date(params[8] as string | Date);
          const requiredBreaches = Number(params[9]);
          const cooldownSeconds = Number(params[10]);

          const prev = store.get(scopeHash);
          const prevBreaching = prev?.is_breaching === true;
          const prevFiredAt = prev?.last_fired_at ?? null;

          const nextBreaches = prevBreaching ? prev!.consecutive_breaches + 1 : 1;
          const cooldownElapsed = cooldownSeconds <= 0
            || prevFiredAt === null
            || prevFiredAt.getTime() <= evaluatedAt.getTime() - cooldownSeconds * 1000;
          const fired = nextBreaches >= requiredBreaches && cooldownElapsed;

          store.set(scopeHash, {
            consecutive_breaches: nextBreaches,
            is_breaching: true,
            last_fired_at: fired ? evaluatedAt : prevFiredAt,
          });

          return {
            rows: [{
              consecutive_breaches: nextBreaches,
              fired,
              last_fired_at: fired ? evaluatedAt : prevFiredAt,
            }],
          };
        }

        if (sql.includes('alert_rule_eval_state') && sql.includes('WITH locked') && params.length === 9) {
          const scopeHash = params[0] as string;
          const prev = store.get(scopeHash);
          const recovered = prev?.is_breaching === true;
          if (prev) store.set(scopeHash, { ...prev, consecutive_breaches: 0, is_breaching: false });
          return { rows: [{ recovered }] };
        }

        return { rows: [] };
      } finally {
        concurrentStatements -= 1;
      }
    };

    // Serialize: each statement waits for the previous one to complete.
    const next = tail.then(run, run);
    tail = next.catch(() => undefined);
    return next;
  });

  return {
    pool: { query } as unknown as Pool,
    store,
    stats: () => ({ maxObservedConcurrency }),
  };
}

function scopeIdentity(scopeHash: string) {
  return {
    scopeHash,
    organizationId: ORG,
    ruleId: RULE,
    bindingId: null,
    projectId: PROJECT,
    environment: 'production',
    service: 'api',
    endpoint: '/data',
  };
}

describe('cooldown concurrency safety (claimBreachDecision)', () => {
  it('grants exactly ONE fire to 2 concurrent evaluations of the same scope', async () => {
    const db = serializedEvalStateDb();
    const repo = new AlertRuntimeRepository(db.pool);
    const now = new Date('2026-01-01T00:00:00.000Z');

    const results = await Promise.all([
      repo.claimBreachDecision({ ...scopeIdentity('scope-a'), evaluatedAt: now, requiredBreaches: 1, cooldownSeconds: 300 }),
      repo.claimBreachDecision({ ...scopeIdentity('scope-a'), evaluatedAt: now, requiredBreaches: 1, cooldownSeconds: 300 }),
    ]);

    expect(results.filter((r) => r.fired)).toHaveLength(1);
  });

  it('grants exactly ONE fire to 10 concurrent evaluations of the same scope', async () => {
    const db = serializedEvalStateDb();
    const repo = new AlertRuntimeRepository(db.pool);
    const now = new Date('2026-01-01T00:00:00.000Z');

    const results = await Promise.all(
      Array.from({ length: 10 }, () => repo.claimBreachDecision({
        ...scopeIdentity('scope-b'),
        evaluatedAt: now,
        requiredBreaches: 1,
        cooldownSeconds: 300,
      })),
    );

    // This is the duplicate-alert guarantee. Before the atomic claim, all 10
    // could read the same stale last_fired_at and all 10 could fire.
    expect(results.filter((r) => r.fired)).toHaveLength(1);
    // Every evaluation is still counted - none are silently dropped.
    expect(results).toHaveLength(10);
  });

  it('does not lose consecutive-breach increments under 10-way concurrency', async () => {
    const db = serializedEvalStateDb();
    const repo = new AlertRuntimeRepository(db.pool);
    const now = new Date('2026-01-01T00:00:00.000Z');

    // requiredBreaches high enough that nothing fires; we only measure counting.
    await Promise.all(
      Array.from({ length: 10 }, () => repo.claimBreachDecision({
        ...scopeIdentity('scope-c'),
        evaluatedAt: now,
        requiredBreaches: 1_000_000,
        cooldownSeconds: 0,
      })),
    );

    // 10 breaches must count as exactly 10. A read-modify-write implementation
    // would undercount here (lost updates).
    expect(db.store.get('scope-c')?.consecutive_breaches).toBe(10);
  });

  it('fires again only after the cooldown window has fully elapsed', async () => {
    const db = serializedEvalStateDb();
    const repo = new AlertRuntimeRepository(db.pool);
    const t0 = new Date('2026-01-01T00:00:00.000Z');

    const first = await repo.claimBreachDecision({ ...scopeIdentity('scope-d'), evaluatedAt: t0, requiredBreaches: 1, cooldownSeconds: 300 });
    expect(first.fired).toBe(true);

    // 1ms before the window closes -> still suppressed.
    const justBefore = new Date(t0.getTime() + 300_000 - 1);
    expect((await repo.claimBreachDecision({ ...scopeIdentity('scope-d'), evaluatedAt: justBefore, requiredBreaches: 1, cooldownSeconds: 300 })).fired).toBe(false);

    // Exactly at the boundary -> allowed (documented inclusive boundary).
    const atBoundary = new Date(t0.getTime() + 300_000);
    expect((await repo.claimBreachDecision({ ...scopeIdentity('scope-d'), evaluatedAt: atBoundary, requiredBreaches: 1, cooldownSeconds: 300 })).fired).toBe(true);
  });

  it('requires N consecutive breaches before firing, and counting is exact', async () => {
    const db = serializedEvalStateDb();
    const repo = new AlertRuntimeRepository(db.pool);
    const t0 = new Date('2026-01-01T00:00:00.000Z');

    const first = await repo.claimBreachDecision({ ...scopeIdentity('scope-e'), evaluatedAt: t0, requiredBreaches: 3, cooldownSeconds: 0 });
    expect(first.consecutiveBreaches).toBe(1);
    expect(first.fired).toBe(false);

    const second = await repo.claimBreachDecision({ ...scopeIdentity('scope-e'), evaluatedAt: t0, requiredBreaches: 3, cooldownSeconds: 0 });
    expect(second.consecutiveBreaches).toBe(2);
    expect(second.fired).toBe(false);

    const third = await repo.claimBreachDecision({ ...scopeIdentity('scope-e'), evaluatedAt: t0, requiredBreaches: 3, cooldownSeconds: 0 });
    expect(third.consecutiveBreaches).toBe(3);
    expect(third.fired).toBe(true);
  });

  it('resets the breach counter on recovery and reports the edge exactly once', async () => {
    const db = serializedEvalStateDb();
    const repo = new AlertRuntimeRepository(db.pool);
    const t0 = new Date('2026-01-01T00:00:00.000Z');

    await repo.claimBreachDecision({ ...scopeIdentity('scope-f'), evaluatedAt: t0, requiredBreaches: 1, cooldownSeconds: 0 });

    const recoveries = await Promise.all([
      repo.claimRecovery({ ...scopeIdentity('scope-f'), evaluatedAt: t0 }),
      repo.claimRecovery({ ...scopeIdentity('scope-f'), evaluatedAt: t0 }),
    ]);

    // Exactly one caller observes the breaching -> healthy edge, so exactly one
    // recovery notification is emitted.
    expect(recoveries.filter((r) => r.recovered)).toHaveLength(1);
    expect(db.store.get('scope-f')?.consecutive_breaches).toBe(0);
    expect(db.store.get('scope-f')?.is_breaching).toBe(false);
  });

  it('keeps distinct scopes independent (one scope in cooldown never suppresses another)', async () => {
    const db = serializedEvalStateDb();
    const repo = new AlertRuntimeRepository(db.pool);
    const now = new Date('2026-01-01T00:00:00.000Z');

    const a = await repo.claimBreachDecision({ ...scopeIdentity('scope-x'), evaluatedAt: now, requiredBreaches: 1, cooldownSeconds: 300 });
    const b = await repo.claimBreachDecision({ ...scopeIdentity('scope-y'), evaluatedAt: now, requiredBreaches: 1, cooldownSeconds: 300 });

    expect(a.fired).toBe(true);
    expect(b.fired).toBe(true);
  });

  it('fails closed (never fires) when evaluation state is indeterminate', async () => {
    // A pool that returns no rows simulates the row vanishing concurrently
    // (retention purge / manual delete). We must refuse to fire on unknown state.
    const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) } as unknown as Pool;
    const repo = new AlertRuntimeRepository(pool);

    const decision = await repo.claimBreachDecision({
      ...scopeIdentity('scope-missing'),
      evaluatedAt: new Date(),
      requiredBreaches: 1,
      cooldownSeconds: 300,
    });

    expect(decision.fired).toBe(false);
    expect(decision.indeterminate).toBe(true);
  });
});

describe('canonical alert identity', () => {
  it('is derived from a single hash implementation', () => {
    // computeAlertFingerprint must produce exactly what alertIdentityHash does
    // for the same inputs - proving there is only one hashing implementation.
    const grouped = computeAlertFingerprint({
      organizationId: ORG,
      projectId: PROJECT,
      environment: 'production',
      ruleId: RULE,
      policyId: `${ORG}:${RULE}:1`,
      groupBy: null,
      groupingEnabled: false,
      severity: 'critical',
    });

    expect(grouped.dimensionKey).toBe('global');
    expect(grouped.fingerprint).toBe(alertIdentityHash({
      organizationId: ORG,
      projectId: PROJECT,
      environment: 'production',
      ruleId: RULE,
      policyId: `${ORG}:${RULE}:1`,
      dimensionKey: 'global',
    }));
  });

  it('same logical alert -> same identity (stable across calls)', () => {
    const input = {
      organizationId: ORG,
      projectId: PROJECT,
      environment: 'production',
      ruleId: RULE,
      policyId: `${ORG}:${RULE}:1`,
      groupBy: ['route'],
      groupingEnabled: true,
      scope: { organizationId: ORG, projectId: PROJECT, environment: 'production', endpoint: '/users/123' },
    } as Parameters<typeof computeAlertFingerprint>[0];

    expect(computeAlertFingerprint(input).fingerprint).toBe(computeAlertFingerprint({ ...input }).fingerprint);
  });

  it('different logical alert -> different identity', () => {
    const base = {
      organizationId: ORG,
      projectId: PROJECT,
      environment: 'production',
      ruleId: RULE,
      policyId: `${ORG}:${RULE}:1`,
      dimensionKey: 'global',
    };
    const fp = alertIdentityHash(base);

    expect(alertIdentityHash({ ...base, organizationId: '00000000-0000-4000-8000-0000000000ff' })).not.toBe(fp);
    expect(alertIdentityHash({ ...base, projectId: '00000000-0000-4000-8000-0000000000fe' })).not.toBe(fp);
    expect(alertIdentityHash({ ...base, environment: 'staging' })).not.toBe(fp);
    expect(alertIdentityHash({ ...base, ruleId: '00000000-0000-4000-8000-0000000000fd' })).not.toBe(fp);
    expect(alertIdentityHash({ ...base, dimensionKey: 'route=/x' })).not.toBe(fp);
  });

  it('decision-engine identity includes every scope component', () => {
    const base = {
      organizationId: ORG,
      projectId: PROJECT,
      environment: 'production',
      service: 'api',
      endpoint: '/data',
      dimension: null,
      policy: { policyId: `${ORG}:${RULE}:1`, ruleId: RULE } as never,
    };

    const fp = alertFingerprint(base);
    expect(alertFingerprint({ ...base })).toBe(fp);
    // Changing ANY scope component must change identity, otherwise two genuinely
    // different alerts would collapse onto one dedup key.
    expect(alertFingerprint({ ...base, service: 'worker' })).not.toBe(fp);
    expect(alertFingerprint({ ...base, endpoint: '/other' })).not.toBe(fp);
    expect(alertFingerprint({ ...base, environment: 'staging' })).not.toBe(fp);
    expect(alertFingerprint({ ...base, dimension: 'route=/z' })).not.toBe(fp);
  });

  it('normalizes dynamic route segments so one alert per route TEMPLATE', () => {
    const make = (endpoint: string) => alertFingerprint({
      organizationId: ORG,
      projectId: PROJECT,
      environment: 'production',
      service: 'api',
      endpoint,
      dimension: null,
      policy: { policyId: `${ORG}:${RULE}:1`, ruleId: RULE } as never,
    });

    // /users/123 and /users/456 are the same logical endpoint -> one alert.
    expect(make('/users/123')).toBe(make('/users/456'));
    // A genuinely different route is a different alert.
    expect(make('/users/123')).not.toBe(make('/orders/123'));
  });
});
