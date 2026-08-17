import { describe, expect, it, vi } from 'vitest';
import { AlertingWorkspaceRepository } from '../../src/modules/alerting/workspace/alerting-workspace.repository.js';
import { POLICY_CATEGORIES, POLICY_DEFAULTS, PROVIDER_DEFAULTS, ROUTING_DEFAULTS, ESCALATION_DEFAULTS, DASHBOARD_WIDGET_DEFAULTS, SAVED_VIEW_DEFAULTS, FEATURE_FLAG_DEFAULTS } from '../../src/modules/alerting/workspace/alerting-workspace.defaults.js';
import { ALERTING_WORKSPACE_INITIALIZATION_VERSION } from '../../src/modules/alerting/workspace/alerting-workspace.types.js';

function sqlText(sql: unknown): string {
  return Array.isArray(sql) ? sql.join('') : String(sql);
}

function createClient() {
  const query = vi.fn(async (sql: unknown) => {
    const text = sqlText(sql);
    if (text.includes('INSERT INTO alerting_workspaces') && text.includes('RETURNING')) return { rows: [{ id: 'workspace-1', initialization_version: ALERTING_WORKSPACE_INITIALIZATION_VERSION, provisioning_status: 'initializing' }] };
    if (text.includes('INSERT INTO alert_rules')) return { rows: [{ seeded: '1' }], rowCount: 1 };
    if (text.includes('INSERT INTO alerting_policy_categories')) return {
      rows: POLICY_CATEGORIES.map((category, index) => ({ slug: category.slug, id: `category-${index}` })),
      rowCount: POLICY_CATEGORIES.length,
    };
    if (text.includes('INSERT INTO alerting_policy_catalog')) return { rows: [{ policy_versions: String(POLICY_DEFAULTS.length) }], rowCount: 1 };
    if (text.includes('INSERT INTO alerting_escalation_policies_v2')) return {
      rows: ESCALATION_DEFAULTS.map((escalation, index) => ({ system_key: escalation.systemKey, id: `escalation-${index}` })),
      rowCount: ESCALATION_DEFAULTS.length,
    };
    if (text.includes('INSERT INTO alerting_escalation_steps_v2')) return { rows: [{ escalation_steps: String(ESCALATION_DEFAULTS.length) }], rowCount: 1 };
    if (text.includes('INSERT INTO alerting_provider_catalog')) return { rows: [{ providers: String(PROVIDER_DEFAULTS.length) }], rowCount: 1 };
    if (text.includes('INSERT INTO feature_flags')) return { rows: [{ feature_flags: String(FEATURE_FLAG_DEFAULTS.length) }], rowCount: 1 };
    if (text.includes('INSERT INTO alerting_dashboard_widgets')) return { rows: [{ dashboard_widgets: String(DASHBOARD_WIDGET_DEFAULTS.length) }], rowCount: 1 };
    if (text.includes('INSERT INTO alerting_saved_views')) return { rows: [{ saved_views: String(SAVED_VIEW_DEFAULTS.length) }], rowCount: 1 };
    if (text.includes('SELECT key FROM plans')) return { rows: [{ key: 'enterprise' }] };
    if (text.includes('FROM plan_feature_entitlements')) return { rows: [
      { feature_key: 'in_app_alerts', boolean_value: true, integer_value: null, decimal_value: null, string_value: null },
      { feature_key: 'email_alerts', boolean_value: true, integer_value: null, decimal_value: null, string_value: null },
      { feature_key: 'ai_alert_analysis', boolean_value: false, integer_value: null, decimal_value: null, string_value: null },
      { feature_key: 'alert_rules', boolean_value: null, integer_value: 500, decimal_value: null, string_value: null },
    ] };
    return { rows: [], rowCount: text.includes('INSERT INTO') ? 1 : 0 };
  });
  return { query } as any;
}

describe('AlertingWorkspaceRepository', () => {
  it('seeds complete configuration and never creates runtime state', async () => {
    const client = createClient();
    const summary = await new AlertingWorkspaceRepository().provision(client, {
      organizationId: 'org-1',
      initializedBy: 'user-1',
      subscriptionId: 'subscription-1',
      planId: 'plan-1',
    });

    expect(summary).toMatchObject({
      workspaceId: 'workspace-1',
      initializationVersion: ALERTING_WORKSPACE_INITIALIZATION_VERSION,
      categories: POLICY_CATEGORIES.length,
      policies: POLICY_DEFAULTS.length,
      routingDefaults: ROUTING_DEFAULTS.length,
      escalationPolicies: ESCALATION_DEFAULTS.length,
      providers: PROVIDER_DEFAULTS.length,
      dashboardWidgets: DASHBOARD_WIDGET_DEFAULTS.length,
      savedViews: SAVED_VIEW_DEFAULTS.length,
      featureFlags: FEATURE_FLAG_DEFAULTS.length,
    });

    const statements = client.query.mock.calls.map(([sql]: [unknown]) => sqlText(sql).toLowerCase());
    expect(statements.some((sql) => sql.includes('insert into alerting_project_policy_subscriptions'))).toBe(false);
    expect(statements.some((sql) => sql.includes('insert into alert_events'))).toBe(false);
    expect(statements.some((sql) => sql.includes('insert into alert_incidents'))).toBe(false);
    expect(statements.some((sql) => sql.includes('insert into notification'))).toBe(false);
    expect(statements.some((sql) => sql.includes('insert into connector_configs'))).toBe(false);
    expect(statements.some((sql) => sql.includes('insert into alerting_usage_counters'))).toBe(true);
    expect(statements.some((sql) => sql.includes("'not_configured'"))).toBe(true);
    expect(client.query).toHaveBeenCalledTimes(22);
  });

  it('short-circuits a ready workspace without reseeding', async () => {
    const query = vi.fn(async (sql: unknown) => {
      const text = sqlText(sql);
      if (text.includes('INSERT INTO alerting_workspaces')) return { rows: [], rowCount: 0 };
      if (text.includes('SELECT id, initialization_version, provisioning_status')) return {
        rows: [{ id: 'workspace-ready', initialization_version: ALERTING_WORKSPACE_INITIALIZATION_VERSION, provisioning_status: 'ready' }],
        rowCount: 1,
      };
      throw new Error(`Unexpected reseed query: ${text}`);
    });
    const summary = await new AlertingWorkspaceRepository().provision({ query } as any, {
      organizationId: 'org-1', initializedBy: 'user-1', subscriptionId: 'subscription-1', planId: 'plan-1',
    });
    expect(summary.workspaceId).toBe('workspace-ready');
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('uses tenant-scoped conflict-safe writes for seeded configuration', async () => {
    const client = createClient();
    await new AlertingWorkspaceRepository().provision(client, {
      organizationId: 'org-1',
      initializedBy: 'user-1',
      subscriptionId: 'subscription-1',
      planId: 'plan-1',
    });
    const statements = client.query.mock.calls.map(([sql]: [unknown]) => sqlText(sql));
    expect(statements.some((sql) => sql.includes('ON CONFLICT (organization_id, slug)'))).toBe(true);
    expect(statements.some((sql) => sql.includes('ON CONFLICT (organization_id, provider_key)'))).toBe(true);
    expect(statements.some((sql) => sql.includes("event_type = 'workspace.initialized'"))).toBe(true);
  });
});
