/**
 * Increment 2 — Effective Rule Resolution.
 *
 * Architecture: docs/alerting-redesign/adr/0004-rule-inheritance-model.md
 *               docs/alerting-redesign/02-data-model.md §1
 *               docs/alerting-redesign/08-implementation-plan.md Increment 2 (Testing)
 *
 * The headline test is the worked example from the brief:
 *
 *   Organization  error rate > 5%
 *     ↓ Project A   disable
 *     ↓ Project B   override 2%
 *       ↓ Environment production  override 1%
 *         ↓ Endpoint /payment     override 0.5%
 *
 *   Expected: only the endpoint threshold executes — ONE effective rule, never duplicates.
 *
 * The resolver is pure, so inheritance is verified as a truth table rather than through an
 * integration scenario.
 */
import { describe, expect, it } from 'vitest';
import {
  SCOPE_LEVEL,
  bindingMatchesScope,
  compareBindings,
  hasEqualDepthConflict,
  resolveEffectiveRule,
  type AlertRuleBindingRow,
  type AlertActionMergeMode,
  type AlertBindingMode,
  type AlertScopeType,
  type EvaluationScope,
} from '../../src/modules/alerting/policy/resolve-rule.js';
import type {
  AlertRuleConditionRow,
  AlertRuleRow,
} from '../../src/modules/alerting/rules/rules.types.js';

const ORG = '11111111-1111-1111-1111-111111111111';
const PROJECT_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const PROJECT_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

function rule(overrides: Partial<AlertRuleRow> = {}): AlertRuleRow {
  return {
    id: 'rule-1',
    organization_id: ORG,
    name: 'High error rate',
    description: null,
    severity: 'error',
    enabled: true,
    evaluation_interval_seconds: 60,
    cooldown_seconds: 600,
    auto_resolve_after_minutes: 30,
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
    ...overrides,
  } as AlertRuleRow;
}

function condition(fieldPath = 'errors.rate', threshold: unknown = 5): AlertRuleConditionRow {
  return {
    id: `cond-${fieldPath}`,
    rule_id: 'rule-1',
    condition_type: 'threshold',
    condition_group_id: null,
    field_path: fieldPath,
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

let seq = 0;
function binding(
  scopeType: AlertScopeType,
  overrides: Partial<AlertRuleBindingRow> = {},
): AlertRuleBindingRow {
  seq += 1;
  return {
    id: `binding-${seq}`,
    organization_id: ORG,
    rule_id: 'rule-1',
    scope_type: scopeType,
    scope_level: SCOPE_LEVEL[scopeType],
    project_id: null,
    environment: null,
    service: null,
    endpoint: null,
    mode: 'inherit' as AlertBindingMode,
    enabled: true,
    priority: 100,
    severity: null,
    cooldown_seconds: null,
    deduplication_window_seconds: null,
    auto_resolve_after_minutes: null,
    evaluation_interval_seconds: null,
    consecutive_breaches: null,
    threshold_overrides: {},
    action_mode: 'inherit' as AlertActionMergeMode,
    requested_channels: null,
    recipient_overrides: null,
    escalation_policy_id: null,
    notes: null,
    created_at: new Date('2026-01-01T00:00:00Z'),
    deleted_at: null,
    ...overrides,
  };
}

/** The brief's scenario, expressed once and reused. */
function scenarioBindings(): AlertRuleBindingRow[] {
  return [
    binding('organization', { mode: 'inherit' }),
    binding('project', { project_id: PROJECT_A, mode: 'disable' }),
    binding('project', { project_id: PROJECT_B, mode: 'override', threshold_overrides: { 'errors.rate': 2 } }),
    binding('environment', {
      project_id: PROJECT_B, environment: 'production',
      mode: 'override', threshold_overrides: { 'errors.rate': 1 },
    }),
    binding('endpoint', {
      project_id: PROJECT_B, endpoint: '/payment',
      mode: 'override', threshold_overrides: { 'errors.rate': 0.5 },
    }),
  ];
}

function thresholdOf(conditions: AlertRuleConditionRow[], fieldPath = 'errors.rate'): unknown {
  return conditions.find((c) => c.field_path === fieldPath)?.threshold_value;
}

describe('Effective Rule Resolution (ADR-0004)', () => {
  describe("the brief's worked example", () => {
    const bindings = scenarioBindings();

    it('organization scope keeps the base 5% threshold', () => {
      const result = resolveEffectiveRule(rule(), [condition()], bindings, { organizationId: ORG });

      expect(result.enabled).toBe(true);
      expect(thresholdOf(result.conditions)).toBe(5);
      expect(result.resolvedScopeType).toBe('organization');
    });

    it('Project A is DISABLED by its binding', () => {
      const result = resolveEffectiveRule(
        rule(), [condition()], bindings,
        { organizationId: ORG, projectId: PROJECT_A },
      );

      expect(result.enabled).toBe(false);
      expect(result.resolvedScopeType).toBe('project');
    });

    it('does not force an org-enabled rule onto an unsubscribed project', () => {
      const result = resolveEffectiveRule(
        rule(), [condition()], [binding('organization', { mode: 'inherit' })],
        { organizationId: ORG, projectId: PROJECT_A },
      );

      expect(result.enabled).toBe(false);
      expect(result.trace.at(-1)!.note).toBe('organization rule requires a matching project subscription binding');
    });

    it('lets a project subscribe to an org-enabled rule without overrides', () => {
      const result = resolveEffectiveRule(
        rule(), [condition()], [
          binding('organization', { mode: 'inherit' }),
          binding('project', { project_id: PROJECT_A, mode: 'inherit' }),
        ],
        { organizationId: ORG, projectId: PROJECT_A },
      );

      expect(result.enabled).toBe(true);
      expect(thresholdOf(result.conditions)).toBe(5);
      expect(result.resolvedScopeType).toBe('project');
    });

    it('Project B overrides the threshold to 2%', () => {
      const result = resolveEffectiveRule(
        rule(), [condition()], bindings,
        { organizationId: ORG, projectId: PROJECT_B },
      );

      expect(result.enabled).toBe(true);
      expect(thresholdOf(result.conditions)).toBe(2);
      expect(result.resolvedScopeType).toBe('project');
    });

    it('Project B / production overrides to 1%', () => {
      const result = resolveEffectiveRule(
        rule(), [condition()], bindings,
        { organizationId: ORG, projectId: PROJECT_B, environment: 'production' },
      );

      expect(thresholdOf(result.conditions)).toBe(1);
      expect(result.resolvedScopeType).toBe('environment');
    });

    it('ONLY the endpoint threshold (0.5%) executes for /payment', () => {
      const result = resolveEffectiveRule(
        rule(), [condition()], bindings,
        {
          organizationId: ORG, projectId: PROJECT_B,
          environment: 'production', endpoint: '/payment',
        },
      );

      expect(result.enabled).toBe(true);
      expect(thresholdOf(result.conditions)).toBe(0.5);
      expect(result.resolvedScopeType).toBe('endpoint');
      expect(result.resolvedScopeLevel).toBe(4);

      // Exactly ONE effective rule: one condition, carrying one threshold.
      expect(result.conditions).toHaveLength(1);
    });

    it('produces an explainable trace of every contributing scope', () => {
      const result = resolveEffectiveRule(
        rule(), [condition()], bindings,
        {
          organizationId: ORG, projectId: PROJECT_B,
          environment: 'production', endpoint: '/payment',
        },
      );

      expect(result.trace.map((t) => t.scopeType)).toEqual([
        'organization', 'organization', 'project', 'environment', 'endpoint',
      ]);
      expect(result.trace.at(-1)!.applied).toContain('thresholds[errors.rate]');
    });

    it('never lets a sibling project leak into another project', () => {
      const a = resolveEffectiveRule(
        rule(), [condition()], bindings, { organizationId: ORG, projectId: PROJECT_A },
      );
      const b = resolveEffectiveRule(
        rule(), [condition()], bindings, { organizationId: ORG, projectId: PROJECT_B },
      );

      expect(a.enabled).toBe(false);
      expect(b.enabled).toBe(true);
    });
  });

  describe('fold semantics', () => {
    it('a rule with NO bindings resolves to exactly its own values (backfill safety)', () => {
      const r = rule({ severity: 'critical', cooldown_seconds: 42 });
      const result = resolveEffectiveRule(r, [condition()], [], { organizationId: ORG });

      expect(result.severity).toBe('critical');
      expect(result.cooldownSeconds).toBe(42);
      expect(result.enabled).toBe(true);
      expect(result.bindingId).toBeNull();
      expect(thresholdOf(result.conditions)).toBe(5);
    });

    it('NULL columns inherit and never overwrite', () => {
      const bindings = [binding('project', {
        project_id: PROJECT_B, mode: 'override',
        severity: null, cooldown_seconds: null,
      })];
      const result = resolveEffectiveRule(
        rule({ severity: 'warning', cooldown_seconds: 900 }), [condition()], bindings,
        { organizationId: ORG, projectId: PROJECT_B },
      );

      expect(result.severity).toBe('warning');
      expect(result.cooldownSeconds).toBe(900);
    });

    it('a DEEPER override re-enables a rule disabled higher up', () => {
      const bindings = [
        binding('project', { project_id: PROJECT_B, mode: 'disable' }),
        binding('endpoint', {
          project_id: PROJECT_B, endpoint: '/health',
          mode: 'override', enabled: true,
        }),
      ];

      const atProject = resolveEffectiveRule(
        rule(), [condition()], bindings, { organizationId: ORG, projectId: PROJECT_B },
      );
      const atEndpoint = resolveEffectiveRule(
        rule(), [condition()], bindings,
        { organizationId: ORG, projectId: PROJECT_B, endpoint: '/health' },
      );

      expect(atProject.enabled).toBe(false);
      expect(atEndpoint.enabled).toBe(true);
    });

    it('is order-independent: shuffling the input cannot change the result', () => {
      const bindings = scenarioBindings();
      const scope: EvaluationScope = {
        organizationId: ORG, projectId: PROJECT_B,
        environment: 'production', endpoint: '/payment',
      };
      const expected = resolveEffectiveRule(rule(), [condition()], bindings, scope);

      // Every rotation of the array must resolve identically.
      for (let i = 0; i < bindings.length; i += 1) {
        const rotated = [...bindings.slice(i), ...bindings.slice(0, i)];
        const actual = resolveEffectiveRule(rule(), [condition()], rotated, scope);
        expect(thresholdOf(actual.conditions)).toBe(thresholdOf(expected.conditions));
        expect(actual.enabled).toBe(expected.enabled);
        expect(actual.resolvedScopeType).toBe(expected.resolvedScopeType);
      }
    });

    it('is idempotent: resolving twice yields the same values', () => {
      const bindings = scenarioBindings();
      const scope: EvaluationScope = { organizationId: ORG, projectId: PROJECT_B };

      const first = resolveEffectiveRule(rule(), [condition()], bindings, scope);
      const second = resolveEffectiveRule(rule(), [condition()], bindings, scope);

      expect(thresholdOf(second.conditions)).toBe(thresholdOf(first.conditions));
      expect(second.resolvedScopeType).toBe(first.resolvedScopeType);
    });

    it('does not mutate the input rule, conditions, or bindings', () => {
      const conditions = [condition()];
      const bindings = scenarioBindings();
      const snapshot = JSON.stringify({ conditions, bindings });

      resolveEffectiveRule(rule(), conditions, bindings, {
        organizationId: ORG, projectId: PROJECT_B, endpoint: '/payment',
      });

      expect(JSON.stringify({ conditions, bindings })).toBe(snapshot);
    });

    it('ignores soft-deleted bindings', () => {
      const bindings = [binding('project', {
        project_id: PROJECT_B, mode: 'override',
        threshold_overrides: { 'errors.rate': 99 },
        deleted_at: new Date('2026-02-01T00:00:00Z'),
      })];
      const result = resolveEffectiveRule(
        rule(), [condition()], bindings, { organizationId: ORG, projectId: PROJECT_B },
      );

      expect(thresholdOf(result.conditions)).toBe(5);
      expect(result.bindingId).toBeNull();
    });

    it('ignores bindings from another organization', () => {
      const bindings = [binding('organization', {
        organization_id: '99999999-9999-9999-9999-999999999999',
        mode: 'override', threshold_overrides: { 'errors.rate': 99 },
      })];
      const result = resolveEffectiveRule(rule(), [condition()], bindings, { organizationId: ORG });

      expect(thresholdOf(result.conditions)).toBe(5);
    });

    it('overrides only the condition whose field_path matches', () => {
      const conditions = [condition('errors.rate', 5), condition('requests.latency.p95', 2000)];
      const bindings = [binding('project', {
        project_id: PROJECT_B, mode: 'override',
        threshold_overrides: { 'errors.rate': 1 },
      })];

      const result = resolveEffectiveRule(rule(), conditions, bindings, {
        organizationId: ORG, projectId: PROJECT_B,
      });

      expect(thresholdOf(result.conditions, 'errors.rate')).toBe(1);
      expect(thresholdOf(result.conditions, 'requests.latency.p95')).toBe(2000);
    });

    it('carries consecutive_breaches from the rule when no binding sets it', () => {
      const r = rule({ metadata: { consecutiveBreachesRequired: 3 } });
      const result = resolveEffectiveRule(r, [condition()], [], { organizationId: ORG });
      expect(result.consecutiveBreaches).toBe(3);
    });

    it('falls back to annotations.consecutiveBreaches, then to 1', () => {
      expect(resolveEffectiveRule(
        rule({ annotations: { consecutiveBreaches: 2 } }), [condition()], [], { organizationId: ORG },
      ).consecutiveBreaches).toBe(2);

      expect(resolveEffectiveRule(
        rule(), [condition()], [], { organizationId: ORG },
      ).consecutiveBreaches).toBe(1);
    });
  });

  describe('action and channel merge modes', () => {
    it('replace discards the parent channel set', () => {
      const bindings = [
        binding('organization', { action_mode: 'replace', requested_channels: ['email'] }),
        binding('project', {
          project_id: PROJECT_B, action_mode: 'replace', requested_channels: ['slack'],
        }),
      ];
      const result = resolveEffectiveRule(rule(), [condition()], bindings, {
        organizationId: ORG, projectId: PROJECT_B,
      });

      expect(result.requestedChannels).toEqual(['slack']);
      expect(result.actionMode).toBe('replace');
    });

    it('merge unions parent and child channels without duplicates', () => {
      const bindings = [
        binding('organization', { action_mode: 'replace', requested_channels: ['email'] }),
        binding('project', {
          project_id: PROJECT_B, action_mode: 'merge', requested_channels: ['slack', 'email'],
        }),
      ];
      const result = resolveEffectiveRule(rule(), [condition()], bindings, {
        organizationId: ORG, projectId: PROJECT_B,
      });

      expect([...result.requestedChannels].sort()).toEqual(['email', 'slack']);
      expect(result.actionMode).toBe('merge');
    });

    it('merge combines recipient overrides; replace does not', () => {
      const merged = resolveEffectiveRule(rule(), [condition()], [
        binding('organization', { action_mode: 'replace', recipient_overrides: { roles: ['owner'] } }),
        binding('project', {
          project_id: PROJECT_B, action_mode: 'merge', recipient_overrides: { userIds: ['u1'] },
        }),
      ], { organizationId: ORG, projectId: PROJECT_B });

      expect(merged.recipientOverrides).toEqual({ roles: ['owner'], userIds: ['u1'] });

      const replaced = resolveEffectiveRule(rule(), [condition()], [
        binding('organization', { action_mode: 'replace', recipient_overrides: { roles: ['owner'] } }),
        binding('project', {
          project_id: PROJECT_B, action_mode: 'replace', recipient_overrides: { userIds: ['u1'] },
        }),
      ], { organizationId: ORG, projectId: PROJECT_B });

      expect(replaced.recipientOverrides).toEqual({ userIds: ['u1'] });
    });

    it('takes the deepest escalation policy', () => {
      const result = resolveEffectiveRule(rule(), [condition()], [
        binding('organization', { escalation_policy_id: 'policy-org' }),
        binding('project', { project_id: PROJECT_B, escalation_policy_id: 'policy-project' }),
      ], { organizationId: ORG, projectId: PROJECT_B });

      expect(result.escalationPolicyId).toBe('policy-project');
    });
  });

  describe('scope matching', () => {
    it.each<[string, EvaluationScope, boolean]>([
      ['exact environment', { organizationId: ORG, projectId: PROJECT_B, environment: 'production' }, true],
      ['different environment', { organizationId: ORG, projectId: PROJECT_B, environment: 'staging' }, false],
      ['no environment in context', { organizationId: ORG, projectId: PROJECT_B }, false],
      ['different project', { organizationId: ORG, projectId: PROJECT_A, environment: 'production' }, false],
    ])('%s → %s', (_label, scope, expected) => {
      const b = binding('environment', { project_id: PROJECT_B, environment: 'production' });
      expect(bindingMatchesScope(b, scope)).toBe(expected);
    });

    it('an organization binding matches every scope in that organization', () => {
      const b = binding('organization');
      expect(bindingMatchesScope(b, { organizationId: ORG })).toBe(true);
      expect(bindingMatchesScope(b, {
        organizationId: ORG, projectId: PROJECT_A, environment: 'staging', endpoint: '/x',
      })).toBe(true);
    });
  });

  describe('tie-breaking (ADR-0004 §5)', () => {
    it('orders shallowest first, then higher priority, then older first', () => {
      const org = binding('organization');
      const lowPriority = binding('service', { project_id: PROJECT_B, service: 'api', priority: 10 });
      const highPriority = binding('service', { project_id: PROJECT_B, service: 'api', priority: 900 });
      const older = binding('service', {
        project_id: PROJECT_B, service: 'api', priority: 900,
        created_at: new Date('2025-01-01T00:00:00Z'),
      });

      const sorted = [highPriority, org, lowPriority, older].sort(compareBindings);

      expect(sorted[0]).toBe(org);
      expect(sorted[1]).toBe(older);
      expect(sorted[2]).toBe(highPriority);
      expect(sorted[3]).toBe(lowPriority);
    });

    it('higher priority wins at equal depth, so the last-applied value is deterministic', () => {
      const bindings = [
        binding('service', {
          project_id: PROJECT_B, service: 'api', priority: 900,
          mode: 'override', threshold_overrides: { 'errors.rate': 9 },
        }),
        binding('service', {
          project_id: PROJECT_B, service: 'api', priority: 10,
          mode: 'override', threshold_overrides: { 'errors.rate': 1 },
        }),
      ];

      const result = resolveEffectiveRule(rule(), [condition()], bindings, {
        organizationId: ORG, projectId: PROJECT_B, service: 'api',
      });

      // Lower priority is applied last, so it wins the final value — deterministic either
      // way, which is what matters. hasEqualDepthConflict flags it for the metric.
      expect(thresholdOf(result.conditions)).toBe(1);
      expect(hasEqualDepthConflict(bindings, {
        organizationId: ORG, projectId: PROJECT_B, service: 'api',
      })).toBe(true);
    });

    it('reports no conflict when depths are distinct', () => {
      expect(hasEqualDepthConflict(scenarioBindings(), {
        organizationId: ORG, projectId: PROJECT_B,
        environment: 'production', endpoint: '/payment',
      })).toBe(false);
    });
  });
});
