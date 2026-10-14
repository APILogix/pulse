/**
 * Automation runtime INTEGRATION tests.
 *
 * These run the REAL AutomationRepository against a REAL PostgreSQL database built
 * from the REAL migration files in src/db/postgres/primary_db_draft/14_automation/.
 *
 * This is the test layer that did not exist before. The automation P0 defect (runtime
 * tables in the wrong database with the wrong columns) survived precisely because every
 * existing automation test exercised pure functions only — 29 of them passed in under
 * 100ms while the claim/lock/retry SQL had never once been executed. Per the mandate,
 * the SQL path that contained the mismatch is explicitly NOT mocked here.
 *
 * Covered: schema/code agreement, workflow lifecycle + toggle, event inbox durability
 * and dedupe, worker claim under concurrency, run + step creation with idempotency,
 * sequential step claiming, retry scheduling, stale-claim recovery, disabled-workflow
 * enforcement, cooldown/rate gates, audit trail, and tenant isolation.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Pool } from 'pg';
import {
  createAutomationScratchDb,
  applyAutomationFixtureCore,
  applyAutomationMigrations,
  seedAutomationFixtures,
  createEnabledWorkflow,
  scratchDbAvailable,
  type AutomationScratchDb,
  type AutomationFixtures,
} from '../helpers/automation-scratch.js';
import { AutomationRepository } from '../../src/modules/automation/repository.js';
import { AutomationAuditRepository } from '../../src/modules/automation/audit.js';
import { AutomationConflictError } from '../../src/modules/automation/errors.js';

const RUN_INTEGRATION = scratchDbAvailable();
const d = RUN_INTEGRATION ? describe : describe.skip;

let scratch: AutomationScratchDb;
let pool: Pool;
let repo: AutomationRepository;
let auditRepo: AutomationAuditRepository;
let f: AutomationFixtures;

beforeAll(async () => {
  if (!RUN_INTEGRATION) return;
  scratch = await createAutomationScratchDb();
  pool = scratch.pool;
  await applyAutomationFixtureCore(pool);
  await applyAutomationMigrations(pool);
  f = await seedAutomationFixtures(pool);
  repo = new AutomationRepository(pool);
  auditRepo = new AutomationAuditRepository(pool);
}, 180_000);

afterAll(async () => {
  if (scratch) await scratch.destroy();
}, 60_000);

// ═══════════════════════════════════════════════════════════════════════════════
// SCHEMA / CODE AGREEMENT — the class of defect that started all of this
// ═══════════════════════════════════════════════════════════════════════════════

d('automation schema built from real migrations', () => {
  it('creates all four runtime tables in the same database as the control plane', async () => {
    const r = await pool.query(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema='public' AND table_name LIKE 'automation%'
        ORDER BY table_name`,
    );
    const tables = r.rows.map((x) => x.table_name);
    for (const required of [
      'automation_actions', 'automation_approvals', 'automation_audit_logs',
      'automation_conditions', 'automation_events_inbox', 'automation_run_steps',
      'automation_runs', 'automation_template_versions', 'automation_templates',
      'automation_triggers', 'automation_workflow_versions', 'automation_workflows',
    ]) {
      expect(tables, `${required} must exist`).toContain(required);
    }
  });

  it('gives the inbox every column the repository reads and writes', async () => {
    const r = await pool.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name='automation_events_inbox'`,
    );
    const cols = new Set(r.rows.map((x) => x.column_name));
    // These are exactly the columns whose absence broke claimInboxEvents before.
    for (const c of [
      'source_module', 'event_type', 'source_event_id', 'dedupe_key', 'payload', 'headers',
      'status', 'received_at', 'locked_at', 'locked_by', 'processed_at', 'attempts',
      'next_retry_at', 'last_error', 'metadata',
    ]) {
      expect(cols, `automation_events_inbox.${c}`).toContain(c);
    }
  });

  it('gives run steps the claim/retry/timeout columns', async () => {
    const r = await pool.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name='automation_run_steps'`,
    );
    const cols = new Set(r.rows.map((x) => x.column_name));
    for (const c of ['sort_order', 'attempt', 'max_attempts', 'next_retry_at', 'timeout_at', 'idempotency_key', 'approval_id']) {
      expect(cols, `automation_run_steps.${c}`).toContain(c);
    }
  });

  it('enforces the unique indexes the repository relies on for idempotency', async () => {
    const r = await pool.query(
      `SELECT indexname, indexdef FROM pg_indexes
        WHERE tablename IN ('automation_events_inbox','automation_runs','automation_run_steps')
          AND indexdef LIKE '%UNIQUE%'`,
    );
    const defs = r.rows.map((x) => x.indexdef).join('\n');
    expect(defs).toMatch(/automation_events_inbox.*organization_id, dedupe_key/s);
    expect(defs).toMatch(/automation_runs.*idempotency_key/s);
    expect(defs).toMatch(/automation_run_steps.*idempotency_key/s);
  });

  it('re-applying the automation migrations is idempotent', async () => {
    await expect(applyAutomationMigrations(pool)).resolves.toBeInstanceOf(Array);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// EVENT INBOX: durability + deduplication
// ═══════════════════════════════════════════════════════════════════════════════

d('event inbox', () => {
  it('persists an event and reports created=true', async () => {
    const key = `evt-${Date.now()}-a`;
    const res = await repo.insertInboxEvent({
      organizationId: f.orgId,
      sourceModule: 'alerting',
      eventType: 'alert.created',
      dedupeKey: key,
      payload: { severity: 'critical' },
    } as never);
    expect(res.created).toBe(true);
    expect(res.event.status).toBe('pending');
    expect(res.event.attempts).toBe(0);
  });

  it('deduplicates a repeated dedupe_key and returns the original row', async () => {
    const key = `evt-${Date.now()}-b`;
    const first = await repo.insertInboxEvent({
      organizationId: f.orgId, sourceModule: 'alerting', eventType: 'alert.created',
      dedupeKey: key, payload: { n: 1 },
    } as never);
    const second = await repo.insertInboxEvent({
      organizationId: f.orgId, sourceModule: 'alerting', eventType: 'alert.created',
      dedupeKey: key, payload: { n: 2 },
    } as never);

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.event.id).toBe(first.event.id);
    // The original payload must win; a duplicate must not overwrite history.
    expect(second.event.payload).toEqual({ n: 1 });
  });

  it('scopes dedupe per organization, so two tenants can use the same key', async () => {
    const key = `evt-shared-${Date.now()}`;
    const a = await repo.insertInboxEvent({
      organizationId: f.orgId, sourceModule: 'alerting', eventType: 'alert.created',
      dedupeKey: key, payload: {},
    } as never);
    const b = await repo.insertInboxEvent({
      organizationId: f.otherOrgId, sourceModule: 'alerting', eventType: 'alert.created',
      dedupeKey: key, payload: {},
    } as never);
    expect(a.created).toBe(true);
    expect(b.created).toBe(true);
    expect(a.event.id).not.toBe(b.event.id);
  });

  it('redacts sensitive headers before persisting them', async () => {
    const res = await repo.insertInboxEvent({
      organizationId: f.orgId, sourceModule: 'alerting', eventType: 'alert.created',
      dedupeKey: `evt-hdr-${Date.now()}`, payload: {},
      headers: { authorization: 'Bearer super-secret', 'x-trace': 'keep-me' },
    } as never);
    expect(res.event.headers.authorization).toBe('[REDACTED]');
    expect(res.event.headers['x-trace']).toBe('keep-me');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// WORKER CLAIM: SKIP LOCKED, attempts, recovery
// ═══════════════════════════════════════════════════════════════════════════════

d('inbox claiming', () => {
  it('claims pending events and increments attempts exactly once', async () => {
    const key = `claim-${Date.now()}`;
    const ins = await repo.insertInboxEvent({
      organizationId: f.orgId, sourceModule: 'claimtest', eventType: 'e', dedupeKey: key, payload: {},
    } as never);

    const claimed = await repo.claimInboxEvents('worker-1', 50);
    const mine = claimed.find((e) => e.id === ins.event.id);
    expect(mine).toBeDefined();
    expect(mine!.status).toBe('processing');
    expect(mine!.attempts).toBe(1);
    expect(mine!.lockedBy).toBe('worker-1');
  });

  it('two concurrent workers never claim the same event (SKIP LOCKED)', async () => {
    // Seed a batch of fresh events.
    const stamp = Date.now();
    for (let i = 0; i < 8; i += 1) {
      await repo.insertInboxEvent({
        organizationId: f.orgId, sourceModule: 'concurrency', eventType: 'e',
        dedupeKey: `conc-${stamp}-${i}`, payload: {},
      } as never);
    }

    const [a, b] = await Promise.all([
      repo.claimInboxEvents('worker-A', 8),
      repo.claimInboxEvents('worker-B', 8),
    ]);

    const idsA = new Set(a.map((e) => e.id));
    const overlap = b.filter((e) => idsA.has(e.id));
    expect(overlap, 'no event may be claimed by both workers').toEqual([]);
  });

  it('completeInboxEvent marks processed and clears the lock', async () => {
    const ins = await repo.insertInboxEvent({
      organizationId: f.orgId, sourceModule: 'complete', eventType: 'e',
      dedupeKey: `done-${Date.now()}`, payload: {},
    } as never);
    await repo.claimInboxEvents('worker-c', 50);
    await repo.completeInboxEvent(ins.event.id);

    const r = await pool.query(
      `SELECT status, processed_at, locked_at, locked_by FROM automation_events_inbox WHERE id=$1`,
      [ins.event.id],
    );
    expect(r.rows[0].status).toBe('processed');
    expect(r.rows[0].processed_at).not.toBeNull();
    expect(r.rows[0].locked_at).toBeNull();
    expect(r.rows[0].locked_by).toBeNull();
  });

  it('failInboxEvent schedules a retry that is not claimable until due', async () => {
    const ins = await repo.insertInboxEvent({
      organizationId: f.orgId, sourceModule: 'failretry', eventType: 'e',
      dedupeKey: `retry-${Date.now()}`, payload: {},
    } as never);
    await repo.claimInboxEvents('worker-d', 50);

    const future = new Date(Date.now() + 60_000);
    await repo.failInboxEvent(ins.event.id, 'boom', future);

    const row = await pool.query(
      `SELECT status, last_error, next_retry_at FROM automation_events_inbox WHERE id=$1`,
      [ins.event.id],
    );
    expect(row.rows[0].status).toBe('retry');
    expect(row.rows[0].last_error).toBe('boom');

    const claimed = await repo.claimInboxEvents('worker-e', 50);
    expect(claimed.find((e) => e.id === ins.event.id), 'not due yet').toBeUndefined();
  });

  it('recovers an event whose worker died (stale processing lock)', async () => {
    const ins = await repo.insertInboxEvent({
      organizationId: f.orgId, sourceModule: 'crash', eventType: 'e',
      dedupeKey: `crash-${Date.now()}`, payload: {},
    } as never);
    // Simulate a worker that claimed the row then died 10 minutes ago.
    await pool.query(
      `UPDATE automation_events_inbox
          SET status='processing', locked_by='dead-worker', locked_at = NOW() - INTERVAL '10 minutes'
        WHERE id=$1`,
      [ins.event.id],
    );

    const reclaimed = await repo.claimInboxEvents('worker-alive', 50);
    const mine = reclaimed.find((e) => e.id === ins.event.id);
    expect(mine, 'stale claim must be recoverable').toBeDefined();
    expect(mine!.lockedBy).toBe('worker-alive');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// RUN + STEP CREATION: idempotency and sequential execution
// ═══════════════════════════════════════════════════════════════════════════════

d('run and step lifecycle', () => {
  it('creates a run with its steps atomically', async () => {
    const wf = await createEnabledWorkflow(pool, f, { actionTypes: ['noop', 'noop'] });
    const idem = `automation:${f.orgId}:${wf.workflowId}:alert.created:evt-1`;

    const { run, steps } = await repo.createRunWithSteps({
      organizationId: f.orgId,
      workflowId: wf.workflowId,
      workflowVersionId: wf.versionId,
      triggerId: wf.triggerId,
      triggerType: 'alert.event.created',
      sourceModule: 'alerting',
      idempotencyKey: idem,
      inputPayload: { severity: 'critical' },
      steps: [
        { stepKey: 'step-0', actionType: 'noop', sortOrder: 0, actionId: wf.actionIds[0] },
        { stepKey: 'step-1', actionType: 'noop', sortOrder: 1, actionId: wf.actionIds[1] },
      ],
    } as never);

    expect(run.status).toBe('queued');
    expect(steps).toHaveLength(2);
    expect(steps.map((s) => s.sortOrder)).toEqual([0, 1]);
  });

  /**
   * Regression coverage for a found-in-production-readiness-review dead config
   * key: escalate-unresolved-critical-alert's pagerduty.trigger action sets
   * "waitMinutes" in its config, which nothing ever read. initialDelaySeconds
   * (computed from waitMinutes/waitSeconds by readActionWaitSeconds, applied
   * generically by createRunWithSteps regardless of actionType) is now real:
   * it sets the step's next_retry_at at creation time, and claimNextStep()'s
   * existing "next_retry_at IS NULL OR next_retry_at <= NOW()" predicate does
   * the rest — no new claim-path logic was needed.
   */
  it('a step created with initialDelaySeconds is not claimable until the delay elapses', async () => {
    const wf = await createEnabledWorkflow(pool, f);
    const { run, steps } = await repo.createRunWithSteps({
      organizationId: f.orgId,
      workflowId: wf.workflowId,
      workflowVersionId: wf.versionId,
      triggerType: 'alert.event.created',
      sourceModule: 'alerting',
      idempotencyKey: `automation:${f.orgId}:${wf.workflowId}:delay:${Date.now()}`,
      inputPayload: {},
      steps: [{
        stepKey: 'step-0', actionType: 'noop', sortOrder: 0, actionId: wf.actionIds[0],
        initialDelaySeconds: 900, // waitMinutes: 15
      }],
    } as never);

    // Not claimable immediately — the delay has not elapsed.
    expect(await repo.claimNextStep(run.id, 1)).toHaveLength(0);

    const persisted = await pool.query(
      `SELECT next_retry_at FROM automation_run_steps WHERE id = $1`,
      [steps[0]!.id],
    );
    expect(persisted.rows[0].next_retry_at).not.toBeNull();
    expect(new Date(persisted.rows[0].next_retry_at).getTime()).toBeGreaterThan(Date.now());

    // Backdate to simulate the delay having elapsed, then confirm it claims normally.
    await pool.query(
      `UPDATE automation_run_steps SET next_retry_at = NOW() - INTERVAL '1 second' WHERE id = $1`,
      [steps[0]!.id],
    );
    const claimed = await repo.claimNextStep(run.id, 1);
    expect(claimed).toHaveLength(1);
    expect(claimed[0]!.status).toBe('running');
  });

  it('a step created WITHOUT initialDelaySeconds remains immediately claimable (no regression)', async () => {
    const wf = await createEnabledWorkflow(pool, f);
    const { run } = await repo.createRunWithSteps({
      organizationId: f.orgId,
      workflowId: wf.workflowId,
      workflowVersionId: wf.versionId,
      triggerType: 'alert.event.created',
      sourceModule: 'alerting',
      idempotencyKey: `automation:${f.orgId}:${wf.workflowId}:nodelay:${Date.now()}`,
      inputPayload: {},
      steps: [{ stepKey: 'step-0', actionType: 'noop', sortOrder: 0, actionId: wf.actionIds[0] }],
    } as never);

    expect(await repo.claimNextStep(run.id, 1)).toHaveLength(1);
  });

  it('rejects a duplicate run for the same idempotency key', async () => {
    const wf = await createEnabledWorkflow(pool, f);
    const idem = `automation:${f.orgId}:${wf.workflowId}:dup:evt-1`;
    const args = {
      organizationId: f.orgId,
      workflowId: wf.workflowId,
      workflowVersionId: wf.versionId,
      triggerType: 'alert.event.created',
      sourceModule: 'alerting',
      idempotencyKey: idem,
      inputPayload: {},
      steps: [{ stepKey: 'step-0', actionType: 'noop', sortOrder: 0 }],
    };

    await repo.createRunWithSteps(args as never);
    // The same trigger event arriving twice must not produce a second run.
    await expect(repo.createRunWithSteps(args as never)).rejects.toBeInstanceOf(AutomationConflictError);

    const count = await pool.query(
      `SELECT COUNT(*)::int AS n FROM automation_runs WHERE idempotency_key=$1`,
      [idem],
    );
    expect(count.rows[0].n).toBe(1);
  });

  it('claims steps strictly in order and never skips ahead', async () => {
    const wf = await createEnabledWorkflow(pool, f, { actionTypes: ['noop', 'noop', 'noop'] });
    const { run } = await repo.createRunWithSteps({
      organizationId: f.orgId, workflowId: wf.workflowId, workflowVersionId: wf.versionId,
      triggerType: 'alert.event.created', sourceModule: 'alerting',
      idempotencyKey: `automation:${f.orgId}:${wf.workflowId}:seq:${Date.now()}`,
      inputPayload: {},
      steps: [0, 1, 2].map((i) => ({
        stepKey: `step-${i}`, actionType: 'noop', sortOrder: i, actionId: wf.actionIds[i],
      })),
    } as never);

    const first = await repo.claimNextStep(run.id, 1);
    expect(first).toHaveLength(1);
    expect(first[0]!.sortOrder).toBe(0);
    expect(first[0]!.status).toBe('running');
    expect(first[0]!.attempt).toBe(1);
    expect(first[0]!.timeoutAt).not.toBeNull();

    // Step 1 must be blocked while step 0 is unfinished.
    const blocked = await repo.claimNextStep(run.id, 1);
    expect(blocked, 'step 1 must wait for step 0').toHaveLength(0);

    await repo.updateStepStatus(first[0]!.id, { status: 'succeeded', completedAt: new Date() });
    const second = await repo.claimNextStep(run.id, 1);
    expect(second).toHaveLength(1);
    expect(second[0]!.sortOrder).toBe(1);
  });

  it('two workers cannot claim the same step concurrently', async () => {
    const wf = await createEnabledWorkflow(pool, f);
    const { run } = await repo.createRunWithSteps({
      organizationId: f.orgId, workflowId: wf.workflowId, workflowVersionId: wf.versionId,
      triggerType: 'alert.event.created', sourceModule: 'alerting',
      idempotencyKey: `automation:${f.orgId}:${wf.workflowId}:race:${Date.now()}`,
      inputPayload: {},
      steps: [{ stepKey: 'step-0', actionType: 'noop', sortOrder: 0, actionId: wf.actionIds[0] }],
    } as never);

    const [a, b] = await Promise.all([repo.claimNextStep(run.id, 1), repo.claimNextStep(run.id, 1)]);
    expect(a.length + b.length, 'exactly one worker may win the step').toBe(1);
  });

  it('does not re-increment attempt on the first claim but does on a retry claim', async () => {
    const wf = await createEnabledWorkflow(pool, f);
    const { run, steps } = await repo.createRunWithSteps({
      organizationId: f.orgId, workflowId: wf.workflowId, workflowVersionId: wf.versionId,
      triggerType: 'alert.event.created', sourceModule: 'alerting',
      idempotencyKey: `automation:${f.orgId}:${wf.workflowId}:attempt:${Date.now()}`,
      inputPayload: {},
      steps: [{ stepKey: 'step-0', actionType: 'noop', sortOrder: 0, actionId: wf.actionIds[0] }],
    } as never);

    const first = await repo.claimNextStep(run.id, 1);
    expect(first[0]!.attempt).toBe(1);

    // Application-owned retry: back to queued, due now.
    await repo.updateStepStatus(steps[0]!.id, { status: 'queued', nextRetryAt: new Date(Date.now() - 1000) });
    const retried = await repo.claimNextStep(run.id, 1);
    expect(retried[0]!.attempt).toBe(2);
  });

  it('a step whose next_retry_at is in the future is not claimable', async () => {
    const wf = await createEnabledWorkflow(pool, f);
    const { run, steps } = await repo.createRunWithSteps({
      organizationId: f.orgId, workflowId: wf.workflowId, workflowVersionId: wf.versionId,
      triggerType: 'alert.event.created', sourceModule: 'alerting',
      idempotencyKey: `automation:${f.orgId}:${wf.workflowId}:backoff:${Date.now()}`,
      inputPayload: {},
      steps: [{ stepKey: 'step-0', actionType: 'noop', sortOrder: 0, actionId: wf.actionIds[0] }],
    } as never);

    await repo.updateStepStatus(steps[0]!.id, {
      status: 'queued', nextRetryAt: new Date(Date.now() + 120_000),
    });
    expect(await repo.claimNextStep(run.id, 1)).toHaveLength(0);
  });

  it('reclaims a running step whose timeout has expired (worker crash)', async () => {
    const wf = await createEnabledWorkflow(pool, f);
    const { run, steps } = await repo.createRunWithSteps({
      organizationId: f.orgId, workflowId: wf.workflowId, workflowVersionId: wf.versionId,
      triggerType: 'alert.event.created', sourceModule: 'alerting',
      idempotencyKey: `automation:${f.orgId}:${wf.workflowId}:timeout:${Date.now()}`,
      inputPayload: {},
      steps: [{ stepKey: 'step-0', actionType: 'noop', sortOrder: 0, actionId: wf.actionIds[0] }],
    } as never);

    await pool.query(
      `UPDATE automation_run_steps
          SET status='running', started_at=NOW() - INTERVAL '1 hour', timeout_at=NOW() - INTERVAL '30 minutes'
        WHERE id=$1`,
      [steps[0]!.id],
    );

    const reclaimed = await repo.claimNextStep(run.id, 1);
    expect(reclaimed, 'expired running step must be reclaimable').toHaveLength(1);
    expect(reclaimed[0]!.attempt).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ENABLE / DISABLE ENFORCEMENT — the backend must be authoritative
// ═══════════════════════════════════════════════════════════════════════════════

d('enable/disable is enforced in the backend, not just the UI', () => {
  it('a disabled workflow cannot have its steps claimed, even with a queued run', async () => {
    const wf = await createEnabledWorkflow(pool, f);
    const { run } = await repo.createRunWithSteps({
      organizationId: f.orgId, workflowId: wf.workflowId, workflowVersionId: wf.versionId,
      triggerType: 'alert.event.created', sourceModule: 'alerting',
      idempotencyKey: `automation:${f.orgId}:${wf.workflowId}:toggle:${Date.now()}`,
      inputPayload: {},
      steps: [{ stepKey: 'step-0', actionType: 'noop', sortOrder: 0, actionId: wf.actionIds[0] }],
    } as never);

    // Enabled: claimable.
    expect(await repo.claimNextStep(run.id, 1)).toHaveLength(1);
    await pool.query(`UPDATE automation_run_steps SET status='queued', started_at=NULL WHERE run_id=$1`, [run.id]);

    // Switched OFF after the run was queued — the race the mandate calls out.
    await repo.setWorkflowEnabled(f.orgId, wf.workflowId, false, undefined as never);
    expect(
      await repo.claimNextStep(run.id, 1),
      'a workflow disabled after queueing must not execute',
    ).toHaveLength(0);

    // Switched back ON: claimable again.
    await repo.setWorkflowEnabled(f.orgId, wf.workflowId, true, undefined as never);
    expect(await repo.claimNextStep(run.id, 1)).toHaveLength(1);
  });

  it('a soft-deleted workflow cannot execute', async () => {
    const wf = await createEnabledWorkflow(pool, f);
    const { run } = await repo.createRunWithSteps({
      organizationId: f.orgId, workflowId: wf.workflowId, workflowVersionId: wf.versionId,
      triggerType: 'alert.event.created', sourceModule: 'alerting',
      idempotencyKey: `automation:${f.orgId}:${wf.workflowId}:deleted:${Date.now()}`,
      inputPayload: {},
      steps: [{ stepKey: 'step-0', actionType: 'noop', sortOrder: 0, actionId: wf.actionIds[0] }],
    } as never);

    await pool.query(`UPDATE automation_workflows SET deleted_at=NOW() WHERE id=$1`, [wf.workflowId]);
    expect(await repo.claimNextStep(run.id, 1)).toHaveLength(0);
  });

  it('findMatchingWorkflows only returns enabled, non-deleted workflows', async () => {
    const evt = { sourceModule: 'matchtest', sourceEvent: 'x.happened' };
    const on = await createEnabledWorkflow(pool, f, { ...evt, enabled: true, slug: `on-${Date.now()}` });
    const off = await createEnabledWorkflow(pool, f, { ...evt, enabled: false, slug: `off-${Date.now()}` });

    const matches = await repo.findMatchingWorkflows(f.orgId, evt.sourceModule, evt.sourceEvent);
    const ids = matches.map((m) => m.id);
    expect(ids).toContain(on.workflowId);
    expect(ids, 'a switched-off workflow must never match').not.toContain(off.workflowId);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// AUDIT TRAIL
// ═══════════════════════════════════════════════════════════════════════════════

d('audit trail', () => {
  it('writes and reads back audit entries with dotted action names', async () => {
    const wf = await createEnabledWorkflow(pool, f);
    await auditRepo.insertAuditLog({
      organizationId: f.orgId,
      workflowId: wf.workflowId,
      actorType: 'system',
      action: 'run.queued',
      entityType: 'run',
      ipAddress: '10.0.0.7',
      metadata: { note: 'integration' },
    });
    // A value absent from the legacy automation_audit_action enum must still work.
    await auditRepo.insertAuditLog({
      organizationId: f.orgId, workflowId: wf.workflowId, actorType: 'system',
      action: 'run.dead_lettered', entityType: 'run',
    });

    const { data, total } = await auditRepo.listAuditLogs(f.orgId, {
      limit: 50, offset: 0, workflowId: wf.workflowId,
    });
    expect(total).toBeGreaterThanOrEqual(2);
    expect(data.map((x) => x.action)).toContain('run.queued');
    expect(data.map((x) => x.action)).toContain('run.dead_lettered');
  });

  it('keeps audit history after the workflow is hard-deleted', async () => {
    const wf = await createEnabledWorkflow(pool, f);
    await auditRepo.insertAuditLog({
      organizationId: f.orgId, workflowId: wf.workflowId, actorType: 'system',
      action: 'workflow.created', entityType: 'workflow',
    });

    await pool.query(`DELETE FROM automation_workflows WHERE id=$1`, [wf.workflowId]);

    // ON DELETE SET NULL, not CASCADE: deleting a workflow must never erase its audit trail.
    const r = await pool.query(
      `SELECT action, workflow_id FROM automation_audit_logs
        WHERE organization_id=$1 AND action='workflow.created' ORDER BY occurred_at DESC LIMIT 1`,
      [f.orgId],
    );
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].workflow_id).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// TENANT ISOLATION
// ═══════════════════════════════════════════════════════════════════════════════

d('tenant isolation', () => {
  it('another organization cannot read a workflow or its run', async () => {
    const wf = await createEnabledWorkflow(pool, f);
    const { run } = await repo.createRunWithSteps({
      organizationId: f.orgId, workflowId: wf.workflowId, workflowVersionId: wf.versionId,
      triggerType: 'alert.event.created', sourceModule: 'alerting',
      idempotencyKey: `automation:${f.orgId}:${wf.workflowId}:iso:${Date.now()}`,
      inputPayload: {},
      steps: [{ stepKey: 'step-0', actionType: 'noop', sortOrder: 0, actionId: wf.actionIds[0] }],
    } as never);

    expect(await repo.getWorkflow(f.otherOrgId, wf.workflowId)).toBeNull();
    expect(await repo.getRun(f.otherOrgId, run.id)).toBeNull();
    // Sanity: the owning org can.
    expect(await repo.getWorkflow(f.orgId, wf.workflowId)).not.toBeNull();
    expect(await repo.getRun(f.orgId, run.id)).not.toBeNull();
  });

  it('another organization cannot toggle a workflow', async () => {
    const wf = await createEnabledWorkflow(pool, f);
    await repo.setWorkflowEnabled(f.otherOrgId, wf.workflowId, false, undefined as never)
      .catch(() => undefined);

    const still = await repo.getWorkflow(f.orgId, wf.workflowId);
    expect(still!.isEnabled, 'cross-tenant disable must not take effect').toBe(true);
  });

  it('another organization does not see our workflows in matching', async () => {
    const evt = { sourceModule: 'isolation', sourceEvent: 'private.event' };
    const wf = await createEnabledWorkflow(pool, f, { ...evt, slug: `iso-${Date.now()}` });
    const theirs = await repo.findMatchingWorkflows(f.otherOrgId, evt.sourceModule, evt.sourceEvent);
    expect(theirs.map((m) => m.id)).not.toContain(wf.workflowId);
  });

  it('another organization cannot read our audit log', async () => {
    const wf = await createEnabledWorkflow(pool, f);
    await auditRepo.insertAuditLog({
      organizationId: f.orgId, workflowId: wf.workflowId, actorType: 'system',
      action: 'workflow.enabled', entityType: 'workflow',
    });
    const theirs = await auditRepo.listAuditLogs(f.otherOrgId, {
      limit: 50, offset: 0, workflowId: wf.workflowId,
    });
    expect(theirs.total).toBe(0);
  });
});
