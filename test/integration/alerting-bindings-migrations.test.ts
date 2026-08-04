/**
 * Increment 2 — migration up/down tests for P1, P2, P3 and the P12 backfill.
 *
 * Architecture: docs/alerting-redesign/07-migration-plan.md §1, §3, §8
 *               docs/alerting-redesign/08-implementation-plan.md (Increment 2 → DB)
 *               docs/alerting-redesign/adr/0004-rule-inheritance-model.md
 *
 * The real, unmodified `.up.sql` / `.down.sql` files are executed against a disposable
 * database, so the tests fail if the DDL and the documented behaviour drift apart.
 *
 * These tests are ORDER DEPENDENT by design: a migration suite is a narrative
 * (apply → verify → backfill → roll back → re-apply) and splitting it across files would
 * mean rebuilding the database several times. Each test states what it assumes.
 */
import 'dotenv/config';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  INCREMENT_2_SCHEMA_MIGRATIONS,
  P1_SCOPE_TYPES,
  P2_RULE_BINDINGS,
  P3_RULE_REVISIONS,
  P12_BACKFILL,
  applyDraftDown,
  applyDraftUp,
  applyFixtureCore,
  createScratchPrimary,
  seedOrganization,
  seedRule,
  type ScratchPrimary,
  type SeededOrg,
} from '../helpers/primary-alerting-scratch.js';

const SOURCE_URL = process.env.ALERTING_TEST_PRIMARY_URL ?? process.env.DATABASE_URL;

let scratch: ScratchPrimary;
let db: Pool;
let org: SeededOrg;
let otherOrg: SeededOrg;

/** Rules seeded before the backfill runs. */
let orgWideRuleIds: string[] = [];
let projectRuleIds: string[] = [];
let softDeletedRuleId = '';

async function count(sql: string, params: unknown[] = []): Promise<number> {
  const result = await db.query<{ n: string }>(sql, params);
  return Number(result.rows[0]!.n);
}

async function enumLabels(typeName: string): Promise<string[]> {
  const result = await db.query<{ label: string }>(
    `SELECT e.enumlabel AS label
       FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
      WHERE t.typname = $1
      ORDER BY e.enumsortorder`,
    [typeName],
  );
  return result.rows.map((row) => row.label);
}

async function regclass(name: string): Promise<string | null> {
  const result = await db.query<{ oid: string | null }>(
    'SELECT to_regclass($1)::text AS oid',
    [name],
  );
  return result.rows[0]!.oid;
}

describe.skipIf(!SOURCE_URL)('Increment 2 migrations (P1–P3, P12)', () => {
  beforeAll(async () => {
    scratch = await createScratchPrimary(SOURCE_URL!, 'pulse_alert_mig');
    db = scratch.pool;
    await applyFixtureCore(db);

    org = await seedOrganization(db, 'primary');
    otherOrg = await seedOrganization(db, 'other');
  }, 120_000);

  afterAll(async () => {
    if (scratch) await scratch.destroy();
  });

  // ── P1 ─────────────────────────────────────────────────────────────────────

  it('P1 creates the four scope/binding enums with the documented label order', async () => {
    await applyDraftUp(db, P1_SCOPE_TYPES);

    expect(await enumLabels('alert_scope_type')).toEqual([
      'organization', 'project', 'environment', 'service', 'endpoint',
    ]);
    expect(await enumLabels('alert_binding_mode')).toEqual(['inherit', 'override', 'disable']);
    expect(await enumLabels('alert_action_merge_mode')).toEqual(['inherit', 'merge', 'replace']);
    // Same name AND same order as the Log DB copy, so channel values translate 1:1
    // with no mapping table (02-data-model.md §5).
    expect(await enumLabels('notification_channel_kind')).toEqual([
      'in_app', 'email', 'slack', 'discord', 'teams', 'pagerduty', 'webhook', 'sms',
    ]);
  });

  // ── P2 ─────────────────────────────────────────────────────────────────────

  it('P2 creates alert_rule_bindings with its indexes, trigger and CHECK constraints', async () => {
    await applyDraftUp(db, P2_RULE_BINDINGS);

    expect(await regclass('alert_rule_bindings')).toBe('alert_rule_bindings');

    const indexes = await db.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes
        WHERE tablename = 'alert_rule_bindings' ORDER BY indexname`,
    );
    expect(indexes.rows.map((r) => r.indexname)).toEqual([
      'alert_rule_bindings_pkey',
      'idx_alert_rule_bindings_escalation',
      'idx_alert_rule_bindings_project',
      'idx_alert_rule_bindings_resolve',
      'uq_alert_rule_binding_scope',
    ]);

    const checks = await db.query<{ conname: string }>(
      `SELECT conname FROM pg_constraint
        WHERE conrelid = 'alert_rule_bindings'::regclass AND contype = 'c'
          AND conname LIKE 'ck_%'
        ORDER BY conname`,
    );
    expect(checks.rows.map((r) => r.conname)).toEqual([
      'ck_alert_rule_binding_environment',
      'ck_alert_rule_binding_recipient_overrides',
      'ck_alert_rule_binding_requested_channels',
      'ck_alert_rule_binding_scope_shape',
      'ck_alert_rule_binding_threshold_overrides',
    ]);

    const trigger = await count(
      `SELECT COUNT(*)::text AS n FROM pg_trigger
        WHERE tgrelid = 'alert_rule_bindings'::regclass
          AND tgname = 'trg_alert_rule_bindings_updated_at'`,
    );
    expect(trigger).toBe(1);
  });

  it('P2 leaves alert_rules.project_id untouched (only deprecated at P15)', async () => {
    const column = await count(
      `SELECT COUNT(*)::text AS n FROM information_schema.columns
        WHERE table_name = 'alert_rules' AND column_name = 'project_id'`,
    );
    expect(column).toBe(1);
  });

  // ── P3 ─────────────────────────────────────────────────────────────────────

  it('P3 creates alert_rule_revisions and the current_revision pointer defaulting to 1', async () => {
    // Seeded BEFORE P3 runs, so this also proves the new column is backfilled on
    // pre-existing rows rather than left NULL.
    const ruleBefore = await seedRule(db, org, { name: 'pre-p3' });

    try {
      await applyDraftUp(db, P3_RULE_REVISIONS);

      expect(await regclass('alert_rule_revisions')).toBe('alert_rule_revisions');

      const pointer = await db.query<{ current_revision: number }>(
        'SELECT current_revision FROM alert_rules WHERE id = $1',
        [ruleBefore],
      );
      // "The rule as it exists today is revision 1".
      expect(pointer.rows[0]!.current_revision).toBe(1);

      const constraints = await db.query<{ conname: string }>(
        `SELECT conname FROM pg_constraint
          WHERE conrelid = 'alert_rule_revisions'::regclass AND contype IN ('c','u')
          ORDER BY conname`,
      );
      expect(constraints.rows.map((r) => r.conname)).toEqual([
        // Auto-named inline CHECK from `revision INTEGER NOT NULL CHECK (revision >= 1)`.
        'alert_rule_revisions_revision_check',
        'ck_alert_rule_revision_change_kind',
        'ck_alert_rule_revision_snapshot',
        'uq_alert_rule_revision',
      ]);

      const rulesCheck = await count(
        `SELECT COUNT(*)::text AS n FROM pg_constraint
          WHERE conrelid = 'alert_rules'::regclass
            AND conname = 'ck_alert_rules_current_revision'`,
      );
      expect(rulesCheck).toBe(1);
    } finally {
      // Removed unconditionally: the backfill counts asserted below depend on an exact
      // rule population, so a failure here must not silently change them.
      await db.query('DELETE FROM alert_rules WHERE id = $1', [ruleBefore]);
    }
  });

  it('P1–P3 are idempotent: re-applying changes nothing and raises nothing', async () => {
    const before = await count(
      `SELECT (
         (SELECT COUNT(*) FROM pg_type WHERE typname IN
            ('alert_scope_type','alert_binding_mode','alert_action_merge_mode',
             'notification_channel_kind'))
       + (SELECT COUNT(*) FROM pg_indexes WHERE tablename = 'alert_rule_bindings')
       + (SELECT COUNT(*) FROM pg_indexes WHERE tablename = 'alert_rule_revisions')
       )::text AS n`,
    );

    for (const file of INCREMENT_2_SCHEMA_MIGRATIONS) {
      await applyDraftUp(db, file);
    }

    const after = await count(
      `SELECT (
         (SELECT COUNT(*) FROM pg_type WHERE typname IN
            ('alert_scope_type','alert_binding_mode','alert_action_merge_mode',
             'notification_channel_kind'))
       + (SELECT COUNT(*) FROM pg_indexes WHERE tablename = 'alert_rule_bindings')
       + (SELECT COUNT(*) FROM pg_indexes WHERE tablename = 'alert_rule_revisions')
       )::text AS n`,
    );
    expect(after).toBe(before);
  });

  it('P1 rollback refuses to run while alert_rule_bindings still depends on the enums', async () => {
    // DROP TYPE without CASCADE is deliberate: rolling back out of order must fail loudly
    // instead of silently dropping configuration columns.
    await expect(applyDraftDown(db, P1_SCOPE_TYPES)).rejects.toThrow(/depend/i);

    // The failed statement must have left the enums in place.
    expect(await enumLabels('alert_scope_type')).toHaveLength(5);
  });

  // ── P12 backfill ───────────────────────────────────────────────────────────

  it('P12 backfills one organization/inherit binding per org-wide rule and one project/override per project rule', async () => {
    orgWideRuleIds = [
      await seedRule(db, org, { name: 'org-1', enabled: true }),
      await seedRule(db, org, { name: 'org-2', enabled: false }),
      await seedRule(db, otherOrg, { name: 'other-org-1' }),
    ];
    projectRuleIds = [
      await seedRule(db, org, { name: 'proj-a', projectId: org.projectA }),
      await seedRule(db, org, { name: 'proj-b', projectId: org.projectB, enabled: false }),
    ];
    softDeletedRuleId = await seedRule(db, org, {
      name: 'deleted', projectId: org.projectA, deletedAt: new Date(),
    });

    await applyDraftUp(db, P12_BACKFILL);

    const bindings = await db.query<{
      rule_id: string; scope_type: string; scope_level: number;
      mode: string; enabled: boolean; priority: number;
      project_id: string | null; created_by: string | null; notes: string | null;
      severity: string | null; threshold_overrides: Record<string, unknown>;
    }>(
      `SELECT rule_id, scope_type, scope_level, mode, enabled, priority,
              project_id, created_by, notes, severity, threshold_overrides
         FROM alert_rule_bindings ORDER BY scope_level, rule_id`,
    );

    expect(bindings.rows).toHaveLength(5);

    const orgBindings = bindings.rows.filter((r) => r.scope_type === 'organization');
    expect(orgBindings).toHaveLength(3);
    expect(new Set(orgBindings.map((r) => r.rule_id))).toEqual(new Set(orgWideRuleIds));
    for (const row of orgBindings) {
      // `inherit` (not `override`) is the property that keeps the backfill
      // behaviour-identical: no scalar is frozen, so later edits to the rule still apply.
      expect(row.mode).toBe('inherit');
      expect(row.scope_level).toBe(0);
      expect(row.project_id).toBeNull();
      expect(row.severity).toBeNull();
      expect(row.threshold_overrides).toEqual({});
      expect(row.priority).toBe(100);
      expect(row.notes).toBe('backfill:v2');
    }

    const projectBindings = bindings.rows.filter((r) => r.scope_type === 'project');
    expect(projectBindings).toHaveLength(2);
    for (const row of projectBindings) {
      // `override` reproduces the restriction alert_rules.project_id expresses today.
      expect(row.mode).toBe('override');
      expect(row.scope_level).toBe(1);
      expect(row.project_id).not.toBeNull();
      expect(row.severity).toBeNull();
    }

    // enabled mirrors the rule so a disabled rule stays disabled at its scope.
    const disabledOrgRule = orgBindings.find((r) => r.rule_id === orgWideRuleIds[1]);
    expect(disabledOrgRule!.enabled).toBe(false);
    const disabledProjectRule = projectBindings.find((r) => r.rule_id === projectRuleIds[1]);
    expect(disabledProjectRule!.enabled).toBe(false);

    // A soft-deleted rule must not be bound.
    const deletedBindings = await count(
      `SELECT COUNT(*)::text AS n FROM alert_rule_bindings WHERE rule_id = $1`,
      [softDeletedRuleId],
    );
    expect(deletedBindings).toBe(0);
  });

  it('P12 seeds revision 1 for every live rule, snapshotting the whole aggregate', async () => {
    const revisions = await db.query<{
      rule_id: string; revision: number; change_kind: string;
      snapshot: { rule: Record<string, unknown>; conditions: unknown[]; actions: unknown[]; bindings: unknown[]; backfill: boolean };
    }>(
      `SELECT rule_id, revision, change_kind, snapshot FROM alert_rule_revisions`,
    );

    // Every live rule, including the ones whose bindings differ — but NOT the
    // soft-deleted one.
    expect(revisions.rows).toHaveLength(5);
    expect(revisions.rows.every((r) => r.revision === 1)).toBe(true);
    expect(revisions.rows.every((r) => r.change_kind === 'rule')).toBe(true);
    expect(revisions.rows.map((r) => r.rule_id)).not.toContain(softDeletedRuleId);

    const sample = revisions.rows.find((r) => r.rule_id === orgWideRuleIds[0])!;
    expect(sample.snapshot.backfill).toBe(true);
    expect(sample.snapshot.conditions).toHaveLength(1);
    expect(sample.snapshot.actions).toHaveLength(1);
    expect(sample.snapshot.bindings).toHaveLength(1);
    // Volatile timestamps are stripped so a snapshot diff shows real changes only.
    expect(sample.snapshot.rule).not.toHaveProperty('created_at');
    expect(sample.snapshot.rule).not.toHaveProperty('updated_at');
    expect(sample.snapshot.rule.id).toBe(orgWideRuleIds[0]);
  });

  it('P12 is idempotent: re-running inserts nothing', async () => {
    const before = [
      await count('SELECT COUNT(*)::text AS n FROM alert_rule_bindings'),
      await count('SELECT COUNT(*)::text AS n FROM alert_rule_revisions'),
    ];

    await applyDraftUp(db, P12_BACKFILL);

    expect([
      await count('SELECT COUNT(*)::text AS n FROM alert_rule_bindings'),
      await count('SELECT COUNT(*)::text AS n FROM alert_rule_revisions'),
    ]).toEqual(before);
  });

  it('P12 fails loudly on a project-scoped rule whose project belongs to another organization', async () => {
    // Cross-tenant data must be repaired, never silently skipped by the JOIN.
    const crossTenant = await db.query<{ id: string }>(
      `INSERT INTO alert_rules (organization_id, name, created_by, project_id)
       VALUES ($1, 'cross-tenant', $2, $3) RETURNING id`,
      [org.organizationId, org.userId, otherOrg.projectA],
    );
    const ruleId = crossTenant.rows[0]!.id;

    try {
      await expect(applyDraftUp(db, P12_BACKFILL)).rejects.toThrow(/cross-tenant|repair/i);
      // The guard runs after the inserts, and the whole file is one transaction, so the
      // partial binding must have been rolled back.
      const leaked = await count(
        'SELECT COUNT(*)::text AS n FROM alert_rule_bindings WHERE rule_id = $1',
        [ruleId],
      );
      expect(leaked).toBe(0);
    } finally {
      await db.query('DELETE FROM alert_rules WHERE id = $1', [ruleId]);
    }
  });

  it('P12 rollback removes only the rows it created', async () => {
    // A hand-created binding and a genuine revision must survive the rollback; that is
    // the entire reason the `backfill:v2` marker exists.
    await db.query(
      `INSERT INTO alert_rule_bindings
         (organization_id, rule_id, scope_type, scope_level, project_id, environment,
          mode, notes)
       VALUES ($1, $2, 'environment', 2, $3, 'production', 'override', 'created by hand')`,
      [org.organizationId, orgWideRuleIds[0], org.projectA],
    );
    await db.query(
      `INSERT INTO alert_rule_revisions
         (organization_id, rule_id, revision, change_kind, snapshot)
       VALUES ($1, $2, 2, 'binding', '{"real": true}'::jsonb)`,
      [org.organizationId, orgWideRuleIds[0]],
    );

    await applyDraftDown(db, P12_BACKFILL);

    expect(await count("SELECT COUNT(*)::text AS n FROM alert_rule_bindings WHERE notes = 'backfill:v2'"))
      .toBe(0);
    expect(await count('SELECT COUNT(*)::text AS n FROM alert_rule_bindings')).toBe(1);
    expect(await count('SELECT COUNT(*)::text AS n FROM alert_rule_revisions')).toBe(1);

    const surviving = await db.query<{ revision: number; change_kind: string }>(
      'SELECT revision, change_kind FROM alert_rule_revisions',
    );
    expect(surviving.rows[0]).toMatchObject({ revision: 2, change_kind: 'binding' });

    expect(await count(
      "SELECT COUNT(*)::text AS n FROM schema_migrations WHERE filename LIKE '%025_backfill_rule_bindings.up.sql'",
    )).toBe(0);

    // Clean up so the schema rollback below starts from a known state.
    await db.query('DELETE FROM alert_rule_bindings');
    await db.query('DELETE FROM alert_rule_revisions');
  });

  // ── Schema rollback in reverse order ───────────────────────────────────────

  it('rolls back P3 → P2 → P1 leaving alert_rules and its data intact', async () => {
    const rulesBefore = await count(
      'SELECT COUNT(*)::text AS n FROM alert_rules WHERE deleted_at IS NULL',
    );
    expect(rulesBefore).toBe(5);

    await applyDraftDown(db, P3_RULE_REVISIONS);
    expect(await regclass('alert_rule_revisions')).toBeNull();
    expect(await count(
      `SELECT COUNT(*)::text AS n FROM information_schema.columns
        WHERE table_name = 'alert_rules' AND column_name = 'current_revision'`,
    )).toBe(0);

    await applyDraftDown(db, P2_RULE_BINDINGS);
    expect(await regclass('alert_rule_bindings')).toBeNull();

    await applyDraftDown(db, P1_SCOPE_TYPES);
    expect(await count(
      `SELECT COUNT(*)::text AS n FROM pg_type WHERE typname IN
        ('alert_scope_type','alert_binding_mode','alert_action_merge_mode',
         'notification_channel_kind')`,
    )).toBe(0);

    // Legacy configuration is untouched — this is what makes the rollback safe to run in
    // production (07-migration-plan.md §8).
    expect(await count(
      'SELECT COUNT(*)::text AS n FROM alert_rules WHERE deleted_at IS NULL',
    )).toBe(rulesBefore);
    expect(await count('SELECT COUNT(*)::text AS n FROM alert_rule_conditions')).toBe(6);
    expect(await count('SELECT COUNT(*)::text AS n FROM alert_rule_actions')).toBe(6);

    // Each down file removes exactly its own ledger row.
    expect(await count(
      `SELECT COUNT(*)::text AS n FROM schema_migrations
        WHERE filename LIKE '%08_alerting/019%'
           OR filename LIKE '%08_alerting/020%'
           OR filename LIKE '%08_alerting/021%'`,
    )).toBe(0);
  });

  it('re-applies cleanly after a full rollback and reproduces the same backfill', async () => {
    for (const file of INCREMENT_2_SCHEMA_MIGRATIONS) {
      await applyDraftUp(db, file);
    }
    await applyDraftUp(db, P12_BACKFILL);

    expect(await count('SELECT COUNT(*)::text AS n FROM alert_rule_bindings')).toBe(5);
    expect(await count('SELECT COUNT(*)::text AS n FROM alert_rule_revisions')).toBe(5);
    expect(await count(
      `SELECT COUNT(*)::text AS n FROM alert_rule_bindings WHERE scope_type = 'organization'`,
    )).toBe(3);
    expect(await count(
      `SELECT COUNT(*)::text AS n FROM alert_rule_bindings WHERE scope_type = 'project'`,
    )).toBe(2);
  });
});
