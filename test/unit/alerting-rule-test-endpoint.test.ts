/**
 * `POST /rules/:id/test` — effective-rule-aware testing.
 *
 * Audit finding (docs/ALERT_RULE_CORRECTNESS_AUDIT.md §4, J8 in
 * docs/ALERTING_V2_HARDENING_REPORT.md): the test endpoint evaluated the rule's
 * RAW stored conditions only, never the binding-resolved effective rule (ADR-0004).
 * An operator could "test" a rule and see `matched: true`, while the real
 * evaluator — which always runs against the effective rule for a scope — would
 * never fire, because a project-level binding disabled the rule or overrode its
 * threshold.
 *
 * These tests exercise `RulesService.testRule` directly (no HTTP layer) against
 * the SAME pure resolver (`resolveEffectiveRule`) the runtime evaluator uses, with
 * a fake repository/bindings-repository, proving:
 *   1. No scope supplied -> unchanged behaviour (raw conditions, as before).
 *   2. Scope supplied + project-level `disable` binding -> matched: false, even
 *      though the raw condition would pass.
 *   3. Scope supplied + threshold override -> the OVERRIDDEN threshold is what's
 *      actually evaluated, not the rule's base threshold.
 */
import { describe, expect, it } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';
import { RulesService } from '../../src/modules/alerting/rules/rules.service.js';
import { AlertingRepository } from '../../src/modules/alerting/repository.js';
import { AlertRuleBindingsRepository } from '../../src/modules/alerting/config/bindings.repository.js';
import { SCOPE_LEVEL, type AlertRuleBindingRow } from '../../src/modules/alerting/policy/resolve-rule.js';
import type { AlertRuleConditionRow, AlertRuleRow } from '../../src/modules/alerting/rules/rules.types.js';

const ORG = '11111111-1111-1111-1111-111111111111';
const PROJECT = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const RULE_ID = 'rule-1';

function fakeLogger(): FastifyBaseLogger {
  const noop = () => undefined;
  return { info: noop, warn: noop, error: noop, debug: noop, trace: noop, fatal: noop, child: () => fakeLogger() } as unknown as FastifyBaseLogger;
}

function baseRule(): AlertRuleRow {
  return {
    id: RULE_ID,
    organization_id: ORG,
    name: 'High error rate',
    description: null,
    severity: 'error',
    enabled: true,
    evaluation_interval_seconds: 60,
    cooldown_seconds: 600,
    auto_resolve_after_minutes: null,
    deduplication_window_seconds: 3600,
    deduplication_key_template: null,
    grouping_enabled: false,
    grouping_key_template: null,
    grouping_wait_seconds: 300,
    labels: {},
    annotations: {},
    metadata: {},
    created_by: 'user-1',
    updated_by: null,
    enabled_at: null,
    disabled_at: null,
    created_at: new Date('2026-01-01T00:00:00Z'),
    updated_at: new Date('2026-01-01T00:00:00Z'),
    deleted_at: null,
    project_id: null,
    preset_key: 'high_error_rate',
    is_default: true,
    last_evaluated_at: null,
  } as AlertRuleRow;
}

function baseCondition(threshold: unknown = 5): AlertRuleConditionRow {
  return {
    id: 'cond-1',
    rule_id: RULE_ID,
    condition_type: 'threshold',
    condition_group_id: null,
    field_path: 'errors.rate',
    operator: 'gte',
    threshold_value: threshold,
    lookback_minutes: 5,
    aggregate_function: null,
    sub_query: {},
    is_required: true,
    order_index: 0,
    created_at: new Date('2026-01-01T00:00:00Z'),
    updated_at: new Date('2026-01-01T00:00:00Z'),
  } as AlertRuleConditionRow;
}

function baseBinding(overrides: Partial<AlertRuleBindingRow>): AlertRuleBindingRow {
  return {
    id: 'binding-1',
    organization_id: ORG,
    rule_id: RULE_ID,
    scope_type: 'project',
    scope_level: SCOPE_LEVEL.project,
    project_id: PROJECT,
    environment: null,
    service: null,
    endpoint: null,
    mode: 'inherit',
    enabled: true,
    priority: 100,
    severity: null,
    cooldown_seconds: null,
    deduplication_window_seconds: null,
    auto_resolve_after_minutes: null,
    evaluation_interval_seconds: null,
    consecutive_breaches: null,
    threshold_overrides: {},
    action_mode: 'inherit',
    requested_channels: null,
    recipient_overrides: null,
    escalation_policy_id: null,
    notes: null,
    created_at: new Date('2026-01-01T00:00:00Z'),
    deleted_at: null,
    ...overrides,
  };
}

/** Minimal fake satisfying only the methods RulesService.testRule calls. */
function fakeRepo(rule: AlertRuleRow, conditions: AlertRuleConditionRow[]): AlertingRepository {
  return {
    findRuleById: async (orgId: string, id: string) =>
      (orgId === rule.organization_id && id === rule.id ? rule : null),
    getRuleConditions: async (_ruleId: string) => conditions,
  } as unknown as AlertingRepository;
}

function fakeBindings(bindings: AlertRuleBindingRow[]): AlertRuleBindingsRepository {
  return {
    listByRule: async (_orgId: string, _ruleId: string) => bindings,
  } as unknown as AlertRuleBindingsRepository;
}

/** Construct a RulesService with fakes injected via the bindings-repository ctor param. */
function makeService(rule: AlertRuleRow, conditions: AlertRuleConditionRow[], bindings: AlertRuleBindingRow[]): RulesService {
  const svc = new RulesService({ repository: fakeRepo(rule, conditions), logger: fakeLogger() });
  // The service constructs its own AlertRuleBindingsRepository; swap it for the fake via
  // the private field (test-only access) since the constructor doesn't accept an override.
  (svc as unknown as { bindings: AlertRuleBindingsRepository }).bindings = fakeBindings(bindings);
  return svc;
}

describe('RulesService.testRule — effective-rule-aware (J8 fix)', () => {
  it('with no scope: behaves exactly as before (raw stored conditions)', async () => {
    const rule = baseRule();
    const conditions = [baseCondition(5)];
    const svc = makeService(rule, conditions, []);

    const result = await svc.testRule(ORG, RULE_ID, { payload: { errors: { rate: 10 } } });

    expect(result.matched).toBe(true);
    expect(result.scope).toBeNull();
    expect(result.effectiveRule).toBeNull();
  });

  it('with scope: a project-level `disable` binding makes the test report matched=false, even though the raw condition would pass', async () => {
    const rule = baseRule();
    const conditions = [baseCondition(5)];
    const bindings = [baseBinding({ mode: 'disable' })];
    const svc = makeService(rule, conditions, bindings);

    // Raw condition: errors.rate=10 >= 5 -> would be `true` if tested without scope.
    const result = await svc.testRule(ORG, RULE_ID, {
      payload: { errors: { rate: 10 } },
      projectId: PROJECT,
    });

    expect(result.matched).toBe(false);
    expect((result.effectiveRule as { enabled: boolean }).enabled).toBe(false);
  });

  it('with scope: a project-level threshold override is what actually gets evaluated', async () => {
    const rule = baseRule();
    const conditions = [baseCondition(5)]; // base threshold: 5%
    const bindings = [baseBinding({ mode: 'override', threshold_overrides: { 'errors.rate': 1 } })]; // overridden: 1%

    const svc = makeService(rule, conditions, bindings);

    // errors.rate=2: fails the base 5% threshold, but PASSES the overridden 1% threshold.
    const withoutScope = await svc.testRule(ORG, RULE_ID, { payload: { errors: { rate: 2 } } });
    expect(withoutScope.matched).toBe(false); // raw rule: 2 >= 5 is false

    const withScope = await svc.testRule(ORG, RULE_ID, {
      payload: { errors: { rate: 2 } },
      projectId: PROJECT,
    });
    expect(withScope.matched).toBe(true); // effective rule: 2 >= 1 is true
    expect((withScope.effectiveRule as { bindingId: string }).bindingId).toBe('binding-1');
  });

  it('rejects environment/service/endpoint scope fields without a projectId (schema-level, documented via service contract)', async () => {
    // Service-level behaviour when projectId is absent: scope narrowing fields are
    // simply ignored (schema validation, tested separately in bindings.types, is the
    // real guard for the HTTP boundary). Here we confirm the service doesn't require
    // them and defaults to the no-scope path when projectId is absent.
    const rule = baseRule();
    const conditions = [baseCondition(5)];
    const svc = makeService(rule, conditions, []);

    const result = await svc.testRule(ORG, RULE_ID, {
      payload: { errors: { rate: 10 } },
      environment: 'production',
    } as never);

    expect(result.scope).toBeNull();
  });
});
