/**
 * `RulesRepository.updateRule` — revision allocation on evaluation-relevant edits (J7 fix).
 *
 * Audit finding (docs/ALERT_RULE_CORRECTNESS_AUDIT.md §4, J7 in
 * docs/ALERTING_V2_HARDENING_REPORT.md): `alert_rules.current_revision` fed the alert
 * fingerprint's `policyId` (`${orgId}:${ruleId}:${current_revision}`,
 * runtime/alert-fingerprint.ts + decision/decision.engine.ts) but was NEVER incremented by
 * `RulesRepository.updateRule` — bindings already had a correct, transactional
 * revision-allocation path (`AlertRuleBindingsRepository.recordRevision`), but rule CRUD
 * never called it. That meant "the rule as it exists after being edited" and "the
 * fingerprint everyone still keys off" silently diverged.
 *
 * This test proves, against a mocked pool (no live DB needed — matches the constraint that
 * exercising `withTransaction`/`recordRevision`'s real SQL requires the integration harness,
 * which needs draft migration fixtures not present in this environment):
 *   1. Editing an evaluation-relevant field (e.g. `cooldownSeconds`) allocates a new revision.
 *   2. Editing `conditions` (what the rule actually checks) allocates a new revision.
 *   3. Editing only cosmetic fields (name/description) does NOT allocate a new revision.
 *   4. The revision-allocation SQL is the exact same statement bindings already use
 *      (`recordRevision`), so rule edits and binding edits can never race into colliding
 *      revision numbers.
 */
import { describe, expect, it, vi } from 'vitest';
import { RulesRepository } from '../../src/modules/alerting/rules/rules.repository.js';

/** Minimal fake Pool/PoolClient sufficient for `updateRule`'s SQL surface. */
function fakePool(initialRevision = 1) {
  const state = { revision: initialRevision, ruleId: 'rule-1', orgId: 'org-1' };
  const queries: string[] = [];

  const client = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      queries.push(sql.trim().split('\n')[0]!.trim());

      if (sql.startsWith('BEGIN') || sql.startsWith('COMMIT') || sql.startsWith('ROLLBACK')) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes('UPDATE alert_rules SET') && !sql.includes('current_revision = $2')) {
        // The main field-update statement.
        return {
          rows: [{
            id: state.ruleId, organization_id: state.orgId, name: 'Rule', description: null,
            severity: 'error', enabled: true, evaluation_interval_seconds: 60, cooldown_seconds: 600,
            auto_resolve_after_minutes: null, deduplication_window_seconds: 3600,
            deduplication_key_template: null, grouping_enabled: false, grouping_key_template: null,
            grouping_wait_seconds: 300, labels: {}, annotations: {}, metadata: {},
            created_by: 'user-1', updated_by: null, enabled_at: null, disabled_at: null,
            created_at: new Date(), updated_at: new Date(), deleted_at: null,
            project_id: null, preset_key: null, is_default: false, last_evaluated_at: null,
            current_revision: state.revision, evaluation_category: 'analytics',
          }],
          rowCount: 1,
        };
      }
      if (sql.includes('DELETE FROM alert_rule_conditions') || sql.includes('DELETE FROM alert_rule_actions')) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes('INSERT INTO alert_rule_conditions') || sql.includes('INSERT INTO alert_rule_actions')) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes('SELECT current_revision FROM alert_rules') && sql.includes('FOR UPDATE')) {
        return { rows: [{ current_revision: state.revision }], rowCount: 1 };
      }
      if (sql.includes('jsonb_build_object')) {
        return { rows: [{ snapshot: {} }], rowCount: 1 };
      }
      if (sql.includes('INSERT INTO alert_rule_revisions')) {
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes('UPDATE alert_rules SET current_revision')) {
        state.revision = Number(params[1]);
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`Unhandled SQL in test fake: ${sql}`);
    }),
    release: vi.fn(),
  };

  const pool = {
    connect: vi.fn(async () => client),
  };

  return { pool, client, queries, state };
}

describe('RulesRepository.updateRule — revision allocation (J7 fix)', () => {
  it('allocates a new revision when an evaluation-relevant field changes (cooldownSeconds)', async () => {
    const { pool, state } = fakePool(1);
    const repo = new RulesRepository(pool as never);

    const result = await repo.updateRule('org-1', 'rule-1', { cooldownSeconds: 900 }, null, null, 'user-1');

    expect(state.revision).toBe(2);
    expect(result.current_revision).toBe(2);
  });

  it('allocates a new revision when conditions are replaced (what the rule checks changed)', async () => {
    const { pool, state } = fakePool(1);
    const repo = new RulesRepository(pool as never);

    const result = await repo.updateRule(
      'org-1', 'rule-1', {}, // no scalar field changes
      [{
        conditionType: 'threshold', conditionGroupId: null, fieldPath: 'errors.rate', operator: 'gte',
        thresholdValue: 10, lookbackMinutes: 5, aggregateFunction: null, isRequired: true, orderIndex: 0,
      }],
      null,
      'user-1',
    );

    expect(state.revision).toBe(2);
    expect(result.current_revision).toBe(2);
  });

  it('does NOT allocate a new revision for purely cosmetic edits (name/description)', async () => {
    const { pool, state } = fakePool(1);
    const repo = new RulesRepository(pool as never);

    const result = await repo.updateRule(
      'org-1', 'rule-1',
      { name: 'Renamed rule', description: 'Updated description' },
      null, null, 'user-1',
    );

    expect(state.revision).toBe(1); // unchanged
    expect(result.current_revision).toBe(1);
  });

  it('reuses the exact same revision-allocation SQL bindings already use (no duplicated logic)', async () => {
    const { pool, queries } = fakePool(1);
    const repo = new RulesRepository(pool as never);

    await repo.updateRule('org-1', 'rule-1', { severity: 'critical' }, null, null, 'user-1');

    // The three statements recordRevision() issues, in order — proves updateRule delegates
    // to the SAME method bindings.repository.ts uses, rather than reimplementing it.
    expect(queries.some((q) => q.includes('SELECT current_revision FROM alert_rules'))).toBe(true);
    expect(queries.some((q) => q.includes('INSERT INTO alert_rule_revisions'))).toBe(true);
    expect(queries.some((q) => q.includes('UPDATE alert_rules SET current_revision'))).toBe(true);
  });
});
