/**
 * Increment 2 — AlertRuleBindingsRepository contract tests against a real primary schema.
 *
 * Architecture: docs/alerting-redesign/02-data-model.md §1
 *               docs/alerting-redesign/adr/0004-rule-inheritance-model.md
 *               docs/alerting-redesign/adr/0006-database-ownership.md
 *               docs/alerting-redesign/08-implementation-plan.md (Increment 2 → Testing)
 *
 * These prove the guarantees the repository claims are actually enforced by the DATABASE:
 *   - revision numbers are allocated serially under concurrency (FOR UPDATE on the rule)
 *   - one live binding per (rule, scope tuple), and a soft-deleted scope can be rebound
 *   - a rejected write leaves NO revision behind, so history can never drift from config
 *   - `listByRuleIds` is a single grouped query, not an N+1
 *   - rows read back from Postgres satisfy the pure resolver's row contract
 *
 * The schema is built from the real P1–P3 migration files on a disposable database, so a
 * DDL change that breaks the repository fails here rather than in production.
 */
import 'dotenv/config';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  INCREMENT_2_SCHEMA_MIGRATIONS,
  applyDraftUp,
  applyFixtureCore,
  createScratchPrimary,
  seedOrganization,
  seedRule,
  type ScratchPrimary,
  type SeededOrg,
} from '../helpers/primary-alerting-scratch.js';

// Vitest sets NODE_ENV=test, which src/config/env.ts rejects (development|staging|production
// only), and dotenv will not override an already-set value. Normalise BEFORE importing any
// module that validates the environment — hence the deferred imports below.
if (process.env.NODE_ENV === 'test' || !process.env.NODE_ENV) {
  process.env.NODE_ENV = 'development';
}

const { AlertRuleBindingsRepository } = await import(
  '../../src/modules/alerting/config/bindings.repository.js'
);
const { AlertNotFoundError, AlertConflictError } = await import(
  '../../src/modules/alerting/types.js'
);
const { resolveEffectiveRule, hasEqualDepthConflict } = await import(
  '../../src/modules/alerting/policy/resolve-rule.js'
);
const { pool: defaultPrimaryPool } = await import('../../src/config/database.js');

type Repo = InstanceType<typeof AlertRuleBindingsRepository>;
type CreateInput = Parameters<Repo['create']>[2];

const SOURCE_URL = process.env.ALERTING_TEST_PRIMARY_URL ?? process.env.DATABASE_URL;

let scratch: ScratchPrimary;
let db: Pool;
let repo: Repo;
let org: SeededOrg;
let otherOrg: SeededOrg;

/** Every field the create() contract accepts, so tests only state what they change. */
function bindingInput(overrides: Partial<CreateInput> = {}): CreateInput {
  return {
    scopeType: 'organization',
    mode: 'inherit',
    enabled: true,
    priority: 100,
    thresholdOverrides: {},
    actionMode: 'inherit',
    ...overrides,
  } as CreateInput;
}

async function currentRevision(ruleId: string): Promise<number> {
  const result = await db.query<{ current_revision: number }>(
    'SELECT current_revision FROM alert_rules WHERE id = $1',
    [ruleId],
  );
  return result.rows[0]!.current_revision;
}

describe.skipIf(!SOURCE_URL)('AlertRuleBindingsRepository (live primary schema)', () => {
  beforeAll(async () => {
    scratch = await createScratchPrimary(SOURCE_URL!, 'pulse_alert_bind');
    db = scratch.pool;
    await applyFixtureCore(db);
    for (const file of INCREMENT_2_SCHEMA_MIGRATIONS) {
      await applyDraftUp(db, file);
    }

    org = await seedOrganization(db, 'bind');
    otherOrg = await seedOrganization(db, 'bind-other');
    repo = new AlertRuleBindingsRepository(db);
  }, 120_000);

  afterAll(async () => {
    if (scratch) await scratch.destroy();
    // bindings.repository.ts imports the default primary pool for its parameter default;
    // closing it keeps the worker from lingering on idle sockets.
    await defaultPrimaryPool.end();
  });

  beforeEach(async () => {
    await db.query('DELETE FROM alert_rule_revisions');
    await db.query('DELETE FROM alert_rule_bindings');
    await db.query('UPDATE alert_rules SET current_revision = 1');
  });

  it('attaches to the injected pool, never the module-level default (ADR-0006)', () => {
    expect(repo.connectionPool).toBe(db);
    expect(repo.connectionPool).not.toBe(defaultPrimaryPool);
  });

  // ── Revision allocation ────────────────────────────────────────────────────

  it('records a revision and bumps current_revision in the same transaction as the write', async () => {
    const ruleId = await seedRule(db, org);

    const binding = await repo.create(org.organizationId, ruleId, bindingInput(), org.userId);

    expect(binding.scope_type).toBe('organization');
    expect(binding.scope_level).toBe(0);
    expect(await currentRevision(ruleId)).toBe(2);

    const revisions = await repo.listRevisions(org.organizationId, ruleId);
    expect(revisions).toHaveLength(1);
    expect(revisions[0]!.revision).toBe(2);
    expect(revisions[0]!.change_kind).toBe('binding');
    expect(revisions[0]!.actor_user_id).toBe(org.userId);

    const snapshot = revisions[0]!.snapshot as {
      rule: Record<string, unknown>;
      conditions: unknown[];
      actions: unknown[];
      bindings: Array<{ id: string }>;
    };
    expect(snapshot.rule.id).toBe(ruleId);
    expect(snapshot.conditions).toHaveLength(1);
    expect(snapshot.actions).toHaveLength(1);
    expect(snapshot.bindings.map((b) => b.id)).toEqual([binding.id]);
  });

  it('allocates distinct, gap-free revisions when writes race on the same rule', async () => {
    const ruleId = await seedRule(db, org);
    const projects = [org.projectA, org.projectB];

    // Eight concurrent writes on ONE rule. Without `FOR UPDATE` on the rule row two of
    // them would read the same current_revision and collide on uq_alert_rule_revision.
    const scopes: CreateInput[] = [
      bindingInput({ scopeType: 'organization' }),
      ...projects.map((projectId) => bindingInput({ scopeType: 'project', projectId })),
      ...projects.map((projectId) =>
        bindingInput({ scopeType: 'environment', projectId, environment: 'production' })),
      ...projects.map((projectId) =>
        bindingInput({ scopeType: 'service', projectId, service: 'checkout' })),
      bindingInput({
        scopeType: 'endpoint', projectId: org.projectA, endpoint: '/payment',
      }),
    ];
    expect(scopes).toHaveLength(8);

    const results = await Promise.all(
      scopes.map((input) => repo.create(org.organizationId, ruleId, input, org.userId)),
    );
    expect(results).toHaveLength(8);

    const revisions = await repo.listRevisions(org.organizationId, ruleId, 500);
    const numbers = revisions.map((r) => r.revision).sort((a, b) => a - b);
    expect(numbers).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
    expect(new Set(numbers).size).toBe(8);
    expect(await currentRevision(ruleId)).toBe(9);
  });

  it('leaves no revision behind when the write is rejected by the database', async () => {
    const ruleId = await seedRule(db, org);

    // scope_shape CHECK: an endpoint binding requires a project. The repository builds
    // scope_level from scopeType, so this reaches Postgres and must roll the whole
    // transaction back — including the revision.
    await expect(
      repo.create(
        org.organizationId,
        ruleId,
        bindingInput({ scopeType: 'endpoint', endpoint: '/payment' }),
        org.userId,
      ),
    ).rejects.toThrow();

    expect(await repo.listRevisions(org.organizationId, ruleId)).toHaveLength(0);
    expect(await currentRevision(ruleId)).toBe(1);
    expect(await repo.listByRule(org.organizationId, ruleId)).toHaveLength(0);
  });

  it('clamps listRevisions limits to a sane range', async () => {
    const ruleId = await seedRule(db, org);
    await repo.create(org.organizationId, ruleId, bindingInput(), org.userId);
    await repo.create(
      org.organizationId, ruleId,
      bindingInput({ scopeType: 'project', projectId: org.projectA }), org.userId,
    );

    // 0 would make the query return nothing and look like "no history".
    expect(await repo.listRevisions(org.organizationId, ruleId, 0)).toHaveLength(1);
    // Newest first.
    const all = await repo.listRevisions(org.organizationId, ruleId, 10_000);
    expect(all.map((r) => r.revision)).toEqual([3, 2]);
  });

  // ── Scope uniqueness ───────────────────────────────────────────────────────

  it('rejects a second live binding at the same scope with a conflict, not a raw PG error', async () => {
    const ruleId = await seedRule(db, org);
    await repo.create(org.organizationId, ruleId, bindingInput(), org.userId);

    await expect(
      repo.create(org.organizationId, ruleId, bindingInput(), org.userId),
    ).rejects.toBeInstanceOf(AlertConflictError);

    // NULLS NOT DISTINCT is what makes two all-NULL organization scopes collide at all.
    expect(await repo.listByRule(org.organizationId, ruleId)).toHaveLength(1);
    expect(await currentRevision(ruleId)).toBe(2);
  });

  it('permits exactly one winner when two identical scopes race', async () => {
    const ruleId = await seedRule(db, org);

    const outcomes = await Promise.allSettled([
      repo.create(org.organizationId, ruleId,
        bindingInput({ scopeType: 'project', projectId: org.projectA }), org.userId),
      repo.create(org.organizationId, ruleId,
        bindingInput({ scopeType: 'project', projectId: org.projectA }), org.userId),
    ]);

    expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
    const rejected = outcomes.find((o) => o.status === 'rejected');
    expect((rejected as PromiseRejectedResult).reason).toBeInstanceOf(AlertConflictError);
    expect(await repo.listByRule(org.organizationId, ruleId)).toHaveLength(1);
  });

  it('allows the same scope to be bound again after a soft delete', async () => {
    const ruleId = await seedRule(db, org);
    const first = await repo.create(
      org.organizationId, ruleId,
      bindingInput({ scopeType: 'environment', projectId: org.projectA, environment: 'production' }),
      org.userId,
    );

    await repo.softDelete(org.organizationId, ruleId, first.id, org.userId);
    expect(await repo.listByRule(org.organizationId, ruleId)).toHaveLength(0);
    expect(await repo.findById(org.organizationId, ruleId, first.id)).toBeNull();

    // The unique index is partial (`WHERE deleted_at IS NULL`), so rebinding must succeed
    // rather than collide with the tombstone.
    const second = await repo.create(
      org.organizationId, ruleId,
      bindingInput({
        scopeType: 'environment', projectId: org.projectA, environment: 'production',
        mode: 'override', severity: 'critical',
      }),
      org.userId,
    );
    expect(second.id).not.toBe(first.id);

    const live = await repo.listByRule(org.organizationId, ruleId);
    expect(live).toHaveLength(1);
    expect(live[0]!.id).toBe(second.id);
    expect(live[0]!.severity).toBe('critical');

    // The tombstone is retained (audit trail), and the revision history covers all three
    // writes.
    const rows = await db.query<{ n: string }>(
      'SELECT COUNT(*)::text AS n FROM alert_rule_bindings WHERE rule_id = $1',
      [ruleId],
    );
    expect(Number(rows.rows[0]!.n)).toBe(2);
    expect(await currentRevision(ruleId)).toBe(4);
  });

  it('refuses to soft-delete the same binding twice', async () => {
    const ruleId = await seedRule(db, org);
    const binding = await repo.create(org.organizationId, ruleId, bindingInput(), org.userId);

    await repo.softDelete(org.organizationId, ruleId, binding.id, org.userId);
    await expect(
      repo.softDelete(org.organizationId, ruleId, binding.id, org.userId),
    ).rejects.toBeInstanceOf(AlertNotFoundError);
  });

  // ── Updates ────────────────────────────────────────────────────────────────

  it('applies sparse updates and can clear an override back to inherit', async () => {
    const ruleId = await seedRule(db, org);
    const binding = await repo.create(
      org.organizationId, ruleId,
      bindingInput({
        scopeType: 'project', projectId: org.projectA, mode: 'override',
        severity: 'critical', cooldownSeconds: 900,
        thresholdOverrides: { 'errors.rate': 2 },
      }),
      org.userId,
    );
    expect(binding.severity).toBe('critical');
    expect(binding.threshold_overrides).toEqual({ 'errors.rate': 2 });

    // An explicit null must CLEAR the override so resolution falls back to the parent
    // scope; an absent key must leave the column alone.
    const updated = await repo.update(
      org.organizationId, ruleId, binding.id,
      { severity: null, priority: 250 },
      otherOrg.userId,
    );

    expect(updated.severity).toBeNull();
    expect(updated.priority).toBe(250);
    expect(updated.cooldown_seconds).toBe(900);
    expect(updated.threshold_overrides).toEqual({ 'errors.rate': 2 });
    expect(updated.updated_by).toBe(otherOrg.userId);
    expect(updated.updated_at.getTime()).toBeGreaterThanOrEqual(binding.updated_at.getTime());
    expect(await currentRevision(ruleId)).toBe(3);
  });

  it('treats an empty patch as a no-op and does not manufacture a revision', async () => {
    const ruleId = await seedRule(db, org);
    const binding = await repo.create(org.organizationId, ruleId, bindingInput(), org.userId);

    const unchanged = await repo.update(org.organizationId, ruleId, binding.id, {}, org.userId);

    expect(unchanged.id).toBe(binding.id);
    // A revision per no-op request would make history unreadable.
    expect(await currentRevision(ruleId)).toBe(2);
    expect(await repo.listRevisions(org.organizationId, ruleId)).toHaveLength(1);
  });

  it('reports a missing binding as not-found for both update and delete', async () => {
    const ruleId = await seedRule(db, org);
    const missing = '00000000-0000-4000-8000-000000000001';

    await expect(
      repo.update(org.organizationId, ruleId, missing, { priority: 5 }, org.userId),
    ).rejects.toBeInstanceOf(AlertNotFoundError);
    await expect(
      repo.update(org.organizationId, ruleId, missing, {}, org.userId),
    ).rejects.toBeInstanceOf(AlertNotFoundError);
    await expect(
      repo.softDelete(org.organizationId, ruleId, missing, org.userId),
    ).rejects.toBeInstanceOf(AlertNotFoundError);
  });

  // ── Tenant isolation ───────────────────────────────────────────────────────

  it('refuses every operation on a rule that belongs to another organization', async () => {
    const ruleId = await seedRule(db, org);
    const binding = await repo.create(org.organizationId, ruleId, bindingInput(), org.userId);

    await expect(repo.listByRule(otherOrg.organizationId, ruleId))
      .rejects.toBeInstanceOf(AlertNotFoundError);
    await expect(repo.create(otherOrg.organizationId, ruleId, bindingInput(), otherOrg.userId))
      .rejects.toBeInstanceOf(AlertNotFoundError);
    await expect(repo.update(otherOrg.organizationId, ruleId, binding.id, { priority: 1 }, null))
      .rejects.toBeInstanceOf(AlertNotFoundError);
    await expect(repo.softDelete(otherOrg.organizationId, ruleId, binding.id, null))
      .rejects.toBeInstanceOf(AlertNotFoundError);

    expect(await repo.findById(otherOrg.organizationId, ruleId, binding.id)).toBeNull();
  });

  it('refuses a soft-deleted rule', async () => {
    const ruleId = await seedRule(db, org, { deletedAt: new Date() });
    await expect(repo.listByRule(org.organizationId, ruleId))
      .rejects.toBeInstanceOf(AlertNotFoundError);
  });

  // ── Bulk loading ───────────────────────────────────────────────────────────

  it('groups bindings by rule in one query, in resolution order', async () => {
    const ruleWithMany = await seedRule(db, org);
    const ruleWithOne = await seedRule(db, org);
    const ruleWithNone = await seedRule(db, org);
    const foreignRule = await seedRule(db, otherOrg);

    // Deliberately created deepest-first so the ORDER BY is doing the work, not insertion
    // order.
    await repo.create(org.organizationId, ruleWithMany,
      bindingInput({ scopeType: 'endpoint', projectId: org.projectA, endpoint: '/payment' }),
      org.userId);
    await repo.create(org.organizationId, ruleWithMany,
      bindingInput({ scopeType: 'environment', projectId: org.projectA, environment: 'production' }),
      org.userId);
    await repo.create(org.organizationId, ruleWithMany, bindingInput(), org.userId);
    const lowPriority = await repo.create(org.organizationId, ruleWithMany,
      bindingInput({ scopeType: 'project', projectId: org.projectA, priority: 10 }), org.userId);
    const highPriority = await repo.create(org.organizationId, ruleWithMany,
      bindingInput({ scopeType: 'project', projectId: org.projectB, priority: 900 }), org.userId);

    await repo.create(org.organizationId, ruleWithOne,
      bindingInput({ scopeType: 'project', projectId: org.projectB }), org.userId);
    await repo.create(otherOrg.organizationId, foreignRule, bindingInput(), otherOrg.userId);

    const grouped = await repo.listByRuleIds(
      org.organizationId,
      [ruleWithMany, ruleWithOne, ruleWithNone, foreignRule],
    );

    // A rule with no bindings is absent rather than an empty array, and another org's rule
    // is never returned even when its id is asked for.
    expect([...grouped.keys()].sort()).toEqual([ruleWithMany, ruleWithOne].sort());
    expect(grouped.get(ruleWithNone)).toBeUndefined();
    expect(grouped.get(foreignRule)).toBeUndefined();

    const many = grouped.get(ruleWithMany)!;
    expect(many).toHaveLength(5);
    // scope_level ASC regardless of insertion order.
    expect(many.map((b) => b.scope_level)).toEqual([0, 1, 1, 2, 4]);
    // Equal depth ties break on priority DESC.
    expect(many[1]!.id).toBe(highPriority.id);
    expect(many[2]!.id).toBe(lowPriority.id);
    expect(grouped.get(ruleWithOne)).toHaveLength(1);
  });

  it('returns an empty map for an empty id list without querying', async () => {
    expect(await repo.listByRuleIds(org.organizationId, [])).toEqual(new Map());
  });

  it('excludes soft-deleted bindings from the bulk loader', async () => {
    const ruleId = await seedRule(db, org);
    const live = await repo.create(org.organizationId, ruleId,
      bindingInput({ scopeType: 'project', projectId: org.projectA }), org.userId);
    const dead = await repo.create(org.organizationId, ruleId,
      bindingInput({ scopeType: 'project', projectId: org.projectB }), org.userId);
    await repo.softDelete(org.organizationId, ruleId, dead.id, org.userId);

    const grouped = await repo.listByRuleIds(org.organizationId, [ruleId]);
    expect(grouped.get(ruleId)!.map((b) => b.id)).toEqual([live.id]);
  });

  // ── Resolver row contract ──────────────────────────────────────────────────

  it('produces rows the pure resolver consumes without any type coercion', async () => {
    const ruleId = await seedRule(db, org, { severity: 'warning' });
    await db.query(
      `UPDATE alert_rules SET cooldown_seconds = 300, deduplication_window_seconds = 3600,
              evaluation_interval_seconds = 60 WHERE id = $1`,
      [ruleId],
    );

    await repo.create(org.organizationId, ruleId,
      bindingInput({ scopeType: 'organization', mode: 'override', severity: 'warning',
        thresholdOverrides: { 'errors.rate': 5 } }), org.userId);
    await repo.create(org.organizationId, ruleId,
      bindingInput({ scopeType: 'project', projectId: org.projectA, mode: 'disable' }),
      org.userId);
    await repo.create(org.organizationId, ruleId,
      bindingInput({
        scopeType: 'endpoint', projectId: org.projectA, endpoint: '/payment',
        mode: 'override', enabled: true, severity: 'critical', cooldownSeconds: 120,
        thresholdOverrides: { 'errors.rate': 0.5 },
        requestedChannels: ['slack', 'pagerduty'], actionMode: 'merge',
        escalationPolicyId: org.escalationPolicyId,
      }),
      org.userId);

    const bindings = (await repo.listByRuleIds(org.organizationId, [ruleId])).get(ruleId)!;

    // The row contract the resolver relies on: SMALLINT/INTEGER as numbers, JSONB as
    // objects/arrays, timestamps as Date, and no undefined in place of null.
    for (const row of bindings) {
      expect(typeof row.scope_level).toBe('number');
      expect(typeof row.priority).toBe('number');
      expect(typeof row.enabled).toBe('boolean');
      expect(row.created_at).toBeInstanceOf(Date);
      expect(row.deleted_at).toBeNull();
      expect(row.threshold_overrides).toBeTypeOf('object');
    }
    const endpointRow = bindings.find((b) => b.scope_type === 'endpoint')!;
    expect(Array.isArray(endpointRow.requested_channels)).toBe(true);
    expect(endpointRow.cooldown_seconds).toBe(120);

    const rule = await db.query('SELECT * FROM alert_rules WHERE id = $1', [ruleId]);
    const conditions = await db.query(
      'SELECT * FROM alert_rule_conditions WHERE rule_id = $1 ORDER BY order_index, id',
      [ruleId],
    );

    // The brief's worked example, resolved from real rows: disabled at the project, but
    // re-enabled and tightened at the endpoint.
    const effective = resolveEffectiveRule(
      rule.rows[0] as never,
      conditions.rows as never,
      bindings,
      {
        organizationId: org.organizationId,
        projectId: org.projectA,
        endpoint: '/payment',
      },
    );

    expect(effective.enabled).toBe(true);
    expect(effective.severity).toBe('critical');
    expect(effective.cooldownSeconds).toBe(120);
    expect(effective.resolvedScopeType).toBe('endpoint');
    expect(effective.conditions[0]!.threshold_value).toBe(0.5);
    expect(effective.requestedChannels).toEqual(['slack', 'pagerduty']);
    expect(effective.escalationPolicyId).toBe(org.escalationPolicyId);
    expect(effective.trace.map((t) => t.scopeType)).toEqual([
      'organization', 'organization', 'project', 'endpoint',
    ]);

    // The same rows in the project scope stay disabled — one rule, two contexts.
    const projectScoped = resolveEffectiveRule(
      rule.rows[0] as never, conditions.rows as never, bindings,
      { organizationId: org.organizationId, projectId: org.projectA },
    );
    expect(projectScoped.enabled).toBe(false);
    expect(projectScoped.conditions[0]!.threshold_value).toBe(5);

    // No two live bindings share a depth here, so nothing should be reported as a conflict.
    expect(hasEqualDepthConflict(bindings, {
      organizationId: org.organizationId, projectId: org.projectA, endpoint: '/payment',
    })).toBe(false);
  });
});
