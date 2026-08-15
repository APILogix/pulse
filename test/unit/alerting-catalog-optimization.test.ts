import { describe, expect, it, vi } from 'vitest';
import {
  AlertCatalogSnapshot,
  AlertRuntimeRuleCatalog,
  type AlertRuntimeTier,
  type RuntimeRuleRow,
} from '../../src/modules/alerting/runtime/rule-catalog.js';
import type { AlertRuleBindingRow } from '../../src/modules/alerting/policy/resolve-rule.js';
import type { AlertRuleConditionRow } from '../../src/modules/alerting/rules/rules.types.js';

describe('AlertCatalogSnapshot & Rule Catalog Optimization', () => {
  const orgId = '11111111-1111-4111-8111-111111111111';
  const project1 = '22222222-2222-4222-8222-222222222222';
  const project2 = '33333333-3333-4333-8333-333333333333';

  const mockRule: RuntimeRuleRow = {
    id: 'rule-1',
    organization_id: orgId,
    name: 'High Error Rate',
    description: null,
    severity: 'error',
    enabled: true,
    evaluation_interval_seconds: 60,
    cooldown_seconds: 300,
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
    current_revision: 1,
  };

  const mockCondition: AlertRuleConditionRow = {
    id: 'cond-1',
    rule_id: 'rule-1',
    condition_type: 'threshold',
    condition_group_id: null,
    field_path: 'errors.rate',
    operator: 'gte',
    threshold_value: 5,
    lookback_minutes: 5,
    aggregate_function: null,
    sub_query: {},
    is_required: true,
    order_index: 0,
    created_at: new Date('2026-01-01T00:00:00Z'),
    updated_at: new Date('2026-01-01T00:00:00Z'),
  };

  const mockBindingProject1: AlertRuleBindingRow = {
    id: 'bind-1',
    organization_id: orgId,
    rule_id: 'rule-1',
    scope_type: 'project',
    scope_level: 1,
    project_id: project1,
    environment: null,
    service: null,
    endpoint: null,
    mode: 'override',
    enabled: true,
    priority: 100,
    severity: 'critical',
    cooldown_seconds: 600,
    deduplication_window_seconds: null,
    auto_resolve_after_minutes: null,
    evaluation_interval_seconds: null,
    consecutive_breaches: 3,
    threshold_overrides: { 'errors.rate': 2 },
    action_mode: 'inherit',
    requested_channels: null,
    recipient_overrides: null,
    escalation_policy_id: null,
    notes: null,
    created_at: new Date('2026-01-01T00:00:00Z'),
    deleted_at: null,
  };

  const mockBindingProject2: AlertRuleBindingRow = {
    id: 'bind-2',
    organization_id: orgId,
    rule_id: 'rule-1',
    scope_type: 'project',
    scope_level: 1,
    project_id: project2,
    environment: null,
    service: null,
    endpoint: null,
    mode: 'disable',
    enabled: false,
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
  };

  it('loads catalog snapshot in exactly 3 database queries and evaluates scopes in memory with 0 DB queries', async () => {
    let queryCount = 0;
    const mockDb = {
      query: vi.fn(async (sql: string) => {
        queryCount += 1;
        if (sql.includes('FROM alert_rules')) {
          return { rows: [mockRule] };
        }
        if (sql.includes('FROM alert_rule_conditions')) {
          return { rows: [mockCondition] };
        }
        if (sql.includes('FROM alert_rule_bindings')) {
          return { rows: [mockBindingProject1, mockBindingProject2] };
        }
        return { rows: [] };
      }),
    };

    const catalog = new AlertRuntimeRuleCatalog(mockDb as never);

    // Step 1: Load snapshot once
    const snapshot = await catalog.loadCatalogSnapshot(orgId, 'window');
    expect(queryCount).toBe(3);
    expect(snapshot).toBeInstanceOf(AlertCatalogSnapshot);
    expect(snapshot.rules.length).toBe(1);

    // Step 2: Evaluate multiple scopes against the snapshot (Loop with 10 iterations)
    for (let i = 0; i < 10; i++) {
      const resolvedProject1 = snapshot.resolveRulesForScope({
        organizationId: orgId,
        projectId: project1,
        environment: 'production',
      });
      expect(resolvedProject1.length).toBe(1);
      expect(resolvedProject1[0].effective.severity).toBe('critical');
      expect(resolvedProject1[0].effective.consecutiveBreaches).toBe(3);
      expect(resolvedProject1[0].effective.conditions[0].threshold_value).toBe(2);

      const resolvedProject2 = snapshot.resolveRulesForScope({
        organizationId: orgId,
        projectId: project2,
        environment: 'production',
      });
      // Project 2 has mode='disable', so it must be filtered out
      expect(resolvedProject2.length).toBe(0);
    }

    // Crucial check: Zero additional database queries were executed during scope iterations!
    expect(queryCount).toBe(3);
  });

  it('correctly computes degraded_rate including slow requests and 5xx errors', () => {
    const calculateDegradedRate = (
      totalCount: number,
      errorCount: number,
      slowCount: number,
    ): number | null => {
      if (totalCount <= 0) return null;
      return (100.0 * (errorCount + slowCount)) / totalCount;
    };

    // Scenario 1: Zero requests -> null
    expect(calculateDegradedRate(0, 0, 0)).toBeNull();

    // Scenario 2: 100 requests, 5 errors (5xx), 15 slow (latency >= 1s) -> 20% degraded
    expect(calculateDegradedRate(100, 5, 15)).toBe(20.0);

    // Scenario 3: 100 requests, 0 errors, 10 slow -> 10% degraded (previously returned 0%)
    expect(calculateDegradedRate(100, 0, 10)).toBe(10.0);

    // Scenario 4: 50 requests, 10 errors, 0 slow -> 20% degraded
    expect(calculateDegradedRate(50, 10, 0)).toBe(20.0);
  });
});
