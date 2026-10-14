/**
 * Increment 1 — AlertRuntimeRepository contract tests against a real Log DB schema.
 *
 * Architecture: docs/alerting-redesign/adr/0006-database-ownership.md
 *               docs/alerting-redesign/02-data-model.md §3
 *               docs/alerting-redesign/PROGRESS.md (Increment 1 → Outstanding #3)
 *
 * These prove the guarantees the architecture depends on are enforced by the DATABASE,
 * not by application code:
 *   - exactly-once alert decisioning via uq_alert_events_v2_idem
 *   - zero duplicate notifications via uq_alert_notification_jobs_idem
 *   - throttle state derived from the append-only ledger (replaces alert_throttle_windows)
 *   - append-only tables carry no updated_at (audit C1)
 *
 * Provisioning: creates a disposable database on the configured Postgres server, applies
 * the real Log DB migrations into it, and drops it afterwards. The existing integration
 * suite uses @testcontainers/postgresql, which needs a running Docker daemon; this test
 * additionally works on a plain server, and skips entirely when neither is configured.
 */
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NotificationJobInsert } from '../../src/modules/alerting/runtime/alert-runtime.repository.js';

// Vitest sets NODE_ENV=test, which src/config/env.ts rejects (it allows only
// development|staging|production), and dotenv will not override an already-set value.
// Normalise BEFORE loading any module that validates the environment, which is why the
// two imports below are deferred rather than static.
if (process.env.NODE_ENV === 'test' || !process.env.NODE_ENV) {
  process.env.NODE_ENV = 'development';
}

const { applyLogDbMigrations } = await import('../../src/shared/logdb/migrations.js');
const { AlertRuntimeRepository } = await import(
  '../../src/modules/alerting/runtime/alert-runtime.repository.js'
);
type AlertRuntimeRepositoryType = InstanceType<typeof AlertRuntimeRepository>;

// IMPORTANT: this deliberately does NOT default to LOG_DB_PRIMARY. That Neon
// project has repeatedly run at or near its 512 MB storage quota, and this
// test creates a real scratch database via CREATE DATABASE. If the test
// process is killed or crashes mid-run (which is exactly what happens when
// the target project is already near its quota — migrations fail, the test
// throws, and afterAll may never get a chance to run), the scratch database
// is silently orphaned. That happened here: 8 databases named
// pulse_alert_rt_* (3–14 days old, 148 MB total) were found still present on
// LOG_DB_PRIMARY during an unrelated production-readiness review and had to
// be dropped by hand. DATABASE_URL (the Primary control-plane Neon project)
// is a separate host with comfortable headroom, so scratch-database-creating
// tests default there now, exactly like test/helpers/automation-scratch.ts
// and test/helpers/logdb-scratch.ts already do for the same reason. Set
// ALERTING_TEST_LOGDB_URL explicitly if you need to target LOG_DB_PRIMARY
// (e.g. once its storage is on a larger plan).
const SOURCE_URL = process.env.ALERTING_TEST_LOGDB_URL
  ?? process.env.DATABASE_URL
  ?? process.env.LOG_DB_PRIMARY;

const SCRATCH_DB = `pulse_alert_rt_${Date.now()}`;

function swapDatabase(connectionString: string, database: string): string {
  const url = new URL(connectionString);
  url.pathname = `/${database}`;
  return url.toString();
}

let adminPool: Pool | null = null;
let scratchPool: Pool | null = null;
let repo: AlertRuntimeRepositoryType;

const ORG = randomUUID();

describe.skipIf(!SOURCE_URL)('AlertRuntimeRepository (live Log DB schema)', () => {
  beforeAll(async () => {
    adminPool = new Pool({ connectionString: swapDatabase(SOURCE_URL!, 'postgres'), max: 1 });
    await adminPool.query(`CREATE DATABASE ${SCRATCH_DB}`);

    scratchPool = new Pool({ connectionString: swapDatabase(SOURCE_URL!, SCRATCH_DB), max: 4 });
    // Apply the REAL migration files, so this test fails if the DDL and the repository
    // ever drift apart.
    await applyLogDbMigrations(scratchPool);

    repo = new AlertRuntimeRepository(scratchPool);
  });

  afterAll(async () => {
    // HARDENED: each step is independently guarded so a failure in one (e.g.
    // scratchPool.end() erroring because the connection already dropped)
    // cannot skip the DROP DATABASE step below it. This is exactly the kind
    // of unguarded chain that leaves scratch databases orphaned — see the
    // comment above SOURCE_URL for the real incident this caused.
    if (scratchPool) await scratchPool.end().catch(() => undefined);
    if (adminPool) {
      await adminPool.query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
          WHERE datname = $1 AND pid <> pg_backend_pid()`,
        [SCRATCH_DB],
      ).catch(() => undefined);
      await adminPool.query(`DROP DATABASE IF EXISTS ${SCRATCH_DB}`).catch((err) => {
        // Surface this loudly — an orphaned scratch DB is exactly the failure
        // mode this hardening exists to prevent.
        console.error(`FAILED TO DROP SCRATCH DATABASE ${SCRATCH_DB} — it may need manual cleanup:`, err);
      });
      await adminPool.end().catch(() => undefined);
    }
  });

  function eventInput(overrides: Record<string, unknown> = {}) {
    const fingerprint = `fp-${randomUUID()}`;
    return {
      organizationId: ORG,
      kind: 'fired' as const,
      severity: 'error' as const,
      fingerprint,
      dedupKey: fingerprint,
      source: 'test',
      engine: 'window' as const,
      idempotencyKey: `idem-${randomUUID()}`,
      occurredAt: new Date(),
      ...overrides,
    };
  }

  // ── exactly-once decisioning ───────────────────────────────────────────────

  it('appends an alert event and returns the stored row', async () => {
    const input = eventInput({ observedValue: 12.5, thresholdValue: 5 });
    const row = await repo.appendEvent(input);

    expect(row).not.toBeNull();
    expect(row!.organization_id).toBe(ORG);
    expect(row!.kind).toBe('fired');
    expect(row!.severity).toBe('error');
    expect(Number(row!.observed_value)).toBe(12.5);
    expect(row!.engine).toBe('window');
  });

  /**
   * DEV-003 — documents ACTUAL current behaviour, which contradicts the architecture.
   *
   * `02-data-model.md` §3 states exactly-once decisioning is delivered by
   * `uq_alert_events_v2_idem`. That index is `(organization_id, idempotency_key,
   * created_at)` because PostgreSQL requires a unique index on a partitioned table to
   * include the partition key. `created_at` defaults to `now()`, so two inserts of the
   * same candidate land on different keys and NO conflict is raised.
   *
   * INVERT this assertion to `toBeNull()` once DEV-003 is resolved.
   */
  it('DEV-003: a duplicate idempotency key is NOT deduped today', async () => {
    const input = eventInput();

    const first = await repo.appendEvent(input);
    const second = await repo.appendEvent(input);

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(second!.idempotency_key).toBe(first!.idempotency_key);
  });

  it('DEV-003 root cause: the index DOES dedupe when created_at is identical', async () => {
    // Isolates the cause: the index itself is sound; including the volatile partition-key
    // default is what defeats it.
    const input = eventInput();
    const createdAt = new Date('2026-06-01T00:00:00Z');

    const insert = async () => scratchPool!.query(
      `INSERT INTO alert_events_v2 (
         organization_id, kind, severity, fingerprint, dedup_key, source, engine,
         idempotency_key, occurred_at, created_at
       ) VALUES ($1,$2::alert_event_kind,$3::logdb_severity,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [
        input.organizationId, input.kind, input.severity, input.fingerprint,
        input.dedupKey, input.source, input.engine, input.idempotencyKey,
        input.occurredAt, createdAt,
      ],
    );

    const first = await insert();
    const second = await insert();

    expect(first.rowCount).toBe(1);
    expect(second.rowCount).toBe(0);
  });

  it('allows the same fingerprint with a different idempotency key', async () => {
    const fingerprint = `fp-${randomUUID()}`;
    const a = await repo.appendEvent(eventInput({ fingerprint, dedupKey: fingerprint }));
    const b = await repo.appendEvent(eventInput({ fingerprint, dedupKey: fingerprint }));

    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
  });

  it('rejects an invalid environment string via the CHECK constraint', async () => {
    await expect(repo.appendEvent(eventInput({ environment: 'bad environment!' })))
      .rejects.toThrow();
  });

  // ── alert_event_state: the one mutable projection ──────────────────────────

  it('upserts state, preserves first_seen_at and never rewinds last_seen_at', async () => {
    const alertKey = `${ORG}:state-${randomUUID()}`;
    const event = await repo.appendEvent(eventInput());
    const t1 = new Date('2026-01-01T10:00:00Z');
    const t2 = new Date('2026-01-01T11:00:00Z');
    const older = new Date('2026-01-01T09:00:00Z');

    const created = await repo.upsertState({
      alertKey, organizationId: ORG, latestEventId: event!.id,
      state: 'firing', severity: 'error', seenAt: t1,
    });
    expect(created.state).toBe('firing');
    expect(created.first_seen_at.toISOString()).toBe(t1.toISOString());

    const advanced = await repo.upsertState({
      alertKey, organizationId: ORG, latestEventId: event!.id,
      state: 'acknowledged', severity: 'critical', seenAt: t2,
    });
    expect(advanced.state).toBe('acknowledged');
    expect(advanced.severity).toBe('critical');
    expect(advanced.first_seen_at.toISOString()).toBe(t1.toISOString());
    expect(advanced.last_seen_at.toISOString()).toBe(t2.toISOString());

    // An out-of-order redelivery must not move the alert backwards in time.
    const rewound = await repo.upsertState({
      alertKey, organizationId: ORG, latestEventId: event!.id,
      state: 'firing', severity: 'error', seenAt: older,
    });
    expect(rewound.last_seen_at.toISOString()).toBe(t2.toISOString());
  });

  it('preserves last_notified_at when a later upsert omits it', async () => {
    const alertKey = `${ORG}:notified-${randomUUID()}`;
    const event = await repo.appendEvent(eventInput());
    const notifiedAt = new Date('2026-02-01T00:00:00Z');

    await repo.upsertState({
      alertKey, organizationId: ORG, latestEventId: event!.id,
      state: 'firing', severity: 'error', seenAt: new Date(), notifiedAt,
    });
    const after = await repo.upsertState({
      alertKey, organizationId: ORG, latestEventId: event!.id,
      state: 'firing', severity: 'error', seenAt: new Date(),
    });

    expect(after.last_notified_at?.toISOString()).toBe(notifiedAt.toISOString());
  });

  it('increments duplicate_count without disturbing first_seen_at', async () => {
    const alertKey = `${ORG}:dup-${randomUUID()}`;
    const event = await repo.appendEvent(eventInput());
    const first = new Date('2026-03-01T00:00:00Z');

    await repo.upsertState({
      alertKey, organizationId: ORG, latestEventId: event!.id,
      state: 'firing', severity: 'error', seenAt: first,
    });
    await repo.incrementDuplicate(alertKey, new Date('2026-03-01T01:00:00Z'));
    const state = await repo.incrementDuplicate(alertKey, new Date('2026-03-01T02:00:00Z'));

    expect(state!.duplicate_count).toBe(2);
    expect(state!.first_seen_at.toISOString()).toBe(first.toISOString());
  });

  it('returns null when incrementing a duplicate for an unknown alert key', async () => {
    expect(await repo.incrementDuplicate(`${ORG}:missing`, new Date())).toBeNull();
  });

  it('locks the state row inside a transaction (serializes concurrent decisions)', async () => {
    const alertKey = `${ORG}:lock-${randomUUID()}`;
    const event = await repo.appendEvent(eventInput());
    await repo.upsertState({
      alertKey, organizationId: ORG, latestEventId: event!.id,
      state: 'firing', severity: 'error', seenAt: new Date(),
    });

    const locked = await repo.withTransaction((client) => repo.lockState(client, alertKey));
    expect(locked!.alert_key).toBe(alertKey);
  });

  // ── history ────────────────────────────────────────────────────────────────

  it('appends history in chronological order', async () => {
    const alertKey = `${ORG}:hist-${randomUUID()}`;
    await repo.appendHistory({
      organizationId: ORG, alertKey, action: 'triggered',
      actorType: 'worker', newState: 'firing',
    });
    await repo.appendHistory({
      organizationId: ORG, alertKey, action: 'acknowledged',
      actorType: 'user', previousState: 'firing', newState: 'acknowledged',
      metadata: { via: 'api' },
    });

    const history = await repo.listHistory(alertKey);
    expect(history.map((row) => row.action)).toEqual(['triggered', 'acknowledged']);
    expect(history[1]!.previous_state).toBe('firing');
  });

  // ── notification jobs: zero duplicate notifications ───────────────────────

  function jobInput(alertEventId: string, overrides: Partial<NotificationJobInsert> = {}): NotificationJobInsert {
    return {
      organizationId: ORG,
      alertEventId,
      alertKey: `${ORG}:job`,
      channelKind: 'email',
      severity: 'error',
      payload: { title: 't', body: 'b' },
      idempotencyKey: `job-${randomUUID()}`,
      ...overrides,
    };
  }

  it('bulk-inserts notification jobs in one statement', async () => {
    const event = await repo.appendEvent(eventInput());
    const rows = await repo.insertNotificationJobs([
      jobInput(event!.id, { channelKind: 'email' }),
      jobInput(event!.id, { channelKind: 'slack' }),
      jobInput(event!.id, { channelKind: 'sms' }),
    ]);

    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.channel_kind).sort()).toEqual(['email', 'slack', 'sms']);
    expect(rows.every((row) => row.status === 'pending')).toBe(true);
  });

  it('returns [] for an empty batch without touching the database', async () => {
    expect(await repo.insertNotificationJobs([])).toEqual([]);
  });

  /**
   * DEV-003 — the "zero duplicate notifications" success criterion is NOT met today,
   * for the same reason as alert events: `uq_alert_notification_jobs_idem` includes the
   * volatile `created_at` partition key. INVERT to `toHaveLength(0)` once resolved.
   */
  it('DEV-003: a duplicate notification job is NOT suppressed today', async () => {
    const event = await repo.appendEvent(eventInput());
    const job = jobInput(event!.id);

    const first = await repo.insertNotificationJobs([job]);
    const second = await repo.insertNotificationJobs([job]);

    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    expect(second[0]!.idempotency_key).toBe(first[0]!.idempotency_key);
  });

  it('advances job status but refuses to move a terminal job backwards', async () => {
    const event = await repo.appendEvent(eventInput());
    const [job] = await repo.insertNotificationJobs([jobInput(event!.id)]);

    expect(await repo.setNotificationJobStatus(job!.id, 'queued')).toBe(true);
    expect(await repo.setNotificationJobStatus(job!.id, 'sent')).toBe(true);
    // Already terminal: a late duplicate must not reopen it.
    expect(await repo.setNotificationJobStatus(job!.id, 'queued')).toBe(false);
  });

  // ── ledger-derived throttle state (replaces alert_throttle_windows) ────────

  it('derives throttle count and last notification time from the ledger', async () => {
    const ruleActionId = randomUUID();
    const alertKey = `${ORG}:throttle-${randomUUID()}`;

    const written = await repo.appendLedger([
      { organizationId: ORG, ruleActionId, alertKey, channelKind: 'email' },
      { organizationId: ORG, ruleActionId, alertKey, channelKind: 'slack' },
    ]);
    expect(written).toBe(2);

    const [state] = await repo.getThrottleWindowStates([ruleActionId], 3600);
    expect(state!.notificationCount).toBe(2);
    expect(state!.lastNotifiedAt).toBeInstanceOf(Date);
  });

  it('excludes ledger rows outside the throttle window', async () => {
    const ruleActionId = randomUUID();
    // Insert an old notification directly so the window boundary is exercised.
    await scratchPool!.query(
      `INSERT INTO alert_notification_ledger
         (organization_id, rule_action_id, alert_key, channel_kind, notified_at)
       VALUES ($1, $2, $3, 'email', now() - interval '2 hours')`,
      [ORG, ruleActionId, `${ORG}:old`],
    );

    expect(await repo.getThrottleWindowStates([ruleActionId], 3600)).toEqual([]);
    const [wide] = await repo.getThrottleWindowStates([ruleActionId], 86_400);
    expect(wide!.notificationCount).toBe(1);
  });

  it('returns [] when asked for no rule actions', async () => {
    expect(await repo.getThrottleWindowStates([], 3600)).toEqual([]);
  });

  // ── delivery attempts ─────────────────────────────────────────────────────

  /** DEV-003 again: `uq_alert_delivery_attempts_v2_idem` includes `created_at`. */
  it('appends delivery attempts; DEV-003: a repeated attempt number is NOT ignored today', async () => {
    const event = await repo.appendEvent(eventInput());
    const [job] = await repo.insertNotificationJobs([jobInput(event!.id)]);
    const attempt = {
      organizationId: ORG,
      alertEventId: event!.id,
      notificationJobId: job!.id,
      channelKind: 'email' as const,
      attemptNumber: 1,
      status: 'sent' as const,
      latencyMs: 42,
    };

    expect(await repo.appendDeliveryAttempts([attempt])).toBe(1);
    expect(await repo.appendDeliveryAttempts([attempt])).toBe(1); // should be 0 once DEV-003 is fixed
    expect(await repo.appendDeliveryAttempts([{ ...attempt, attemptNumber: 2, status: 'failed' }])).toBe(1);

    const rows = await repo.listDeliveryAttempts(event!.id);
    expect(rows).toHaveLength(3); // should be 2 once DEV-003 is fixed
  });

  // ── remaining append-only writers ─────────────────────────────────────────

  it('appends acknowledgment, metric and dead-letter rows', async () => {
    const alertKey = `${ORG}:misc-${randomUUID()}`;
    const event = await repo.appendEvent(eventInput());

    await repo.appendAcknowledgment({
      organizationId: ORG, alertKey, alertEventId: event!.id,
      acknowledgedBy: randomUUID(), comment: 'on it',
    });
    await repo.appendMetric({
      organizationId: ORG, metricName: 'alerts_fired',
      metricValue: 3, granularity: 'hour', bucket: new Date('2026-04-01T00:00:00Z'),
    });
    await repo.appendDeadLetter({
      organizationId: ORG, sourceQueue: 'alert.decide',
      alertEventId: event!.id, errorMessage: 'boom', attempts: 3,
    });

    const acks = await scratchPool!.query(
      'SELECT COUNT(*)::int c FROM alert_acknowledgments_v2 WHERE alert_key = $1', [alertKey],
    );
    const metrics = await scratchPool!.query(
      'SELECT COUNT(*)::int c FROM alert_metrics_v2 WHERE organization_id = $1', [ORG],
    );
    const dlq = await scratchPool!.query(
      `SELECT status FROM alert_dead_letter_events_v2 WHERE alert_event_id = $1`, [event!.id],
    );

    expect(acks.rows[0].c).toBe(1);
    expect(metrics.rows[0].c).toBeGreaterThanOrEqual(1);
    expect(dlq.rows[0].status).toBe('pending_retry');
  });

  // ── evaluator breach state ────────────────────────────────────────────────

  it('upserts rule eval state and preserves last_fired_at when omitted', async () => {
    const scopeHash = `scope-${randomUUID()}`.slice(0, 64);
    const ruleId = randomUUID();
    const firedAt = new Date('2026-05-01T00:00:00Z');

    await repo.upsertRuleEvalState({
      scopeHash, organizationId: ORG, ruleId,
      consecutiveBreaches: 1, isBreaching: true,
      evaluatedAt: new Date('2026-05-01T00:00:00Z'), firedAt,
    });
    await repo.upsertRuleEvalState({
      scopeHash, organizationId: ORG, ruleId,
      consecutiveBreaches: 0, isBreaching: false,
      evaluatedAt: new Date('2026-05-01T00:05:00Z'),
    });

    const [state] = await repo.getRuleEvalStates([scopeHash]);
    expect(state!.consecutive_breaches).toBe(0);
    expect(state!.is_breaching).toBe(false);
    expect(state!.last_fired_at?.toISOString()).toBe(firedAt.toISOString());
  });

  it('returns [] when asked for no scope hashes', async () => {
    expect(await repo.getRuleEvalStates([])).toEqual([]);
  });

  // ── append-only guarantee (audit C1) ──────────────────────────────────────

  it('append-only tables have no updated_at column; the projection does', async () => {
    const appendOnly = [
      'alert_events_v2',
      'alert_event_history_v2',
      'alert_notification_jobs',
      'alert_notification_ledger',
      'alert_delivery_attempts_v2',
      'alert_acknowledgments_v2',
      'alert_metrics_v2',
      'alert_dead_letter_events_v2',
    ];
    const result = await scratchPool!.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.columns
        WHERE table_schema = 'public' AND column_name = 'updated_at'
          AND table_name = ANY($1::text[])`,
      [appendOnly],
    );
    expect(result.rows.map((row) => row.table_name)).toEqual([]);

    const projection = await scratchPool!.query<{ c: number }>(
      `SELECT COUNT(*)::int c FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'alert_event_state'
          AND column_name = 'updated_at'`,
    );
    expect(projection.rows[0]!.c).toBe(1);
  });

  it('exposes the pool it was constructed with and passes its own boot assertion', async () => {
    expect(repo.connectionPool).toBe(scratchPool);
  });
});
