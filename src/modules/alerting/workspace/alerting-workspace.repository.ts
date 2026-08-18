import type { Pool, PoolClient } from 'pg';
import { pool } from '../../../config/database.js';
import { DEFAULT_ALERT_PRESETS, seedDefaultPresetsForOrgInTransaction } from '../evaluator/presets.js';
import {
  DASHBOARD_WIDGET_DEFAULTS,
  ESCALATION_DEFAULTS,
  FEATURE_FLAG_DEFAULTS,
  POLICY_CATEGORIES,
  POLICY_DEFAULTS,
  PROVIDER_DEFAULTS,
  ROUTING_DEFAULTS,
  SAVED_VIEW_DEFAULTS,
} from './alerting-workspace.defaults.js';
import {
  ALERTING_WORKSPACE_INITIALIZATION_VERSION,
  type AlertingProvisioningContext,
  type AlertingProvisioningSummary,
  type JsonObject,
} from './alerting-workspace.types.js';

type EntitlementRow = {
  feature_key: string;
  boolean_value: boolean | null;
  integer_value: string | number | null;
  decimal_value: string | number | null;
  string_value: string | null;
};

type WorkspaceRow = {
  id: string;
  initialization_version: string;
  provisioning_status: 'initializing' | 'ready' | 'failed';
};

const POLICY_CATEGORY_BY_PREFIX: Array<[string, string]> = [
  ['errors.', 'errors'],
  ['requests.latency', 'performance'],
  ['requests.error', 'errors'],
  ['requests.degraded', 'availability'],
  ['requests.auth', 'security'],
  ['requests.count', 'availability'],
  ['logs.security', 'security'],
  ['logs.', 'errors'],
  ['cron.', 'cron'],
  ['metrics.cpu', 'infrastructure'],
  ['metrics.memory', 'infrastructure'],
  ['queue.', 'queues'],
  ['db.', 'database'],
  ['service.', 'availability'],
  ['endpoint.', 'availability'],
  ['deployment.', 'deployments'],
  ['heartbeat.', 'availability'],
  ['connector.', 'errors'],
  ['ai.', 'ai'],
];

function categoryForFieldPath(fieldPath: string): string {
  const normalized = fieldPath.toLowerCase();
  return POLICY_CATEGORY_BY_PREFIX.find(([prefix]) => normalized.startsWith(prefix))?.[1] ?? 'custom';
}

function expressionFor(operator: string, fieldPath: string): string {
  const op = operator === 'gte' ? '>=' : operator === 'lte' ? '<=' : operator === 'lt' ? '<' : operator === 'gt' ? '>' : operator;
  return `${fieldPath} ${op} threshold`;
}

function thresholdObject(value: unknown): JsonObject {
  return { value };
}

function defaultPolicyPayload() {
  return DEFAULT_ALERT_PRESETS.map((preset) => ({
    slug: preset.presetKey,
    name: preset.name,
    description: preset.description,
    category: categoryForFieldPath(preset.condition.fieldPath),
    severity: preset.severity,
    metricSource: preset.condition.fieldPath,
    expression: expressionFor(preset.condition.operator, preset.condition.fieldPath),
    defaultThreshold: thresholdObject(preset.condition.thresholdValue),
    recoveryThreshold: {},
    cooldownSeconds: preset.cooldownSeconds,
    evaluationWindowSeconds: Math.max(60, preset.condition.lookbackMinutes * 60 || preset.evaluationIntervalSeconds),
    enabled: true,
    documentation: preset.description,
    dependencies: [],
  }));
}

const DEFAULT_POLICY_COUNT = DEFAULT_ALERT_PRESETS.length;

export class AlertingWorkspaceRepository {
  async provision(client: PoolClient, context: AlertingProvisioningContext): Promise<AlertingProvisioningSummary> {
    const workspaceResult = await client.query<WorkspaceRow>(
      `INSERT INTO alerting_workspaces
         (organization_id, initialized_by, initialization_version, provisioning_status)
       VALUES ($1, $2, $3, 'initializing')
       ON CONFLICT (organization_id) DO NOTHING
       RETURNING id, initialization_version, provisioning_status`,
      [context.organizationId, context.initializedBy, ALERTING_WORKSPACE_INITIALIZATION_VERSION],
    );

    const created = workspaceResult.rows[0];
    const workspace = created ?? (await this.lockWorkspace(client, context.organizationId));
    if (workspace.initialization_version !== ALERTING_WORKSPACE_INITIALIZATION_VERSION) {
      throw new Error(`Unsupported Alerting workspace initialization version: ${workspace.initialization_version}`);
    }
    if (!created && workspace.provisioning_status === 'ready') {
      return this.readySummary(workspace.id);
    }

    const catalogRules = await seedDefaultPresetsForOrgInTransaction(
      client,
      context.organizationId,
      context.initializedBy,
    );

    const policyVersions = await this.syncDefaultPolicyCatalog(client, context.organizationId, context.initializedBy);

    await client.query(
      `WITH defaults AS (
         SELECT *
         FROM jsonb_to_recordset($2::jsonb) AS d(severity text, destination_type text, priority integer)
       )
       INSERT INTO alerting_routing_defaults
          (organization_id, severity, destination_type, connector_id, route_id, is_enabled, priority, config)
       SELECT $1::uuid, severity, destination_type, NULL, NULL, TRUE, priority, '{}'::jsonb
       FROM defaults
       ON CONFLICT (organization_id, severity, priority) DO UPDATE SET
         destination_type = EXCLUDED.destination_type,
         is_enabled = EXCLUDED.is_enabled,
         updated_at = NOW()`,
      [
        context.organizationId,
        JSON.stringify(ROUTING_DEFAULTS.map((routing) => ({
          severity: routing.severity,
          destination_type: routing.destinationType,
          priority: routing.priority,
        }))),
      ],
    );

    const escalationResult = await client.query<{ system_key: string; id: string }>(
      `WITH defaults AS (
         SELECT *
         FROM jsonb_to_recordset($2::jsonb) AS d(
           system_key text,
           name text,
           description text,
           acknowledgement_timeout_seconds integer,
           repeat_interval_seconds integer,
           max_repeats integer
         )
       )
       INSERT INTO alerting_escalation_policies_v2
          (organization_id, system_key, name, description, acknowledgement_timeout_seconds,
           repeat_interval_seconds, max_repeats, cancellation_rules, is_default)
       SELECT
         $1::uuid, system_key, name, description, acknowledgement_timeout_seconds,
         repeat_interval_seconds, max_repeats, '{}'::jsonb, TRUE
       FROM defaults
       ON CONFLICT (organization_id, system_key) DO UPDATE SET
         name = EXCLUDED.name,
         description = EXCLUDED.description,
         acknowledgement_timeout_seconds = EXCLUDED.acknowledgement_timeout_seconds,
         repeat_interval_seconds = EXCLUDED.repeat_interval_seconds,
         max_repeats = EXCLUDED.max_repeats,
         is_default = TRUE,
         updated_at = NOW()
       RETURNING system_key, id`,
      [
        context.organizationId,
        JSON.stringify(ESCALATION_DEFAULTS.map((escalation) => ({
          system_key: escalation.systemKey,
          name: escalation.name,
          description: escalation.description,
          acknowledgement_timeout_seconds: escalation.acknowledgementTimeoutSeconds,
          repeat_interval_seconds: escalation.repeatIntervalSeconds,
          max_repeats: escalation.maxRepeats,
        }))),
      ],
    );
    const escalationIds = new Map(escalationResult.rows.map((row) => [row.system_key, row.id]));
    const escalationStepPayload = ESCALATION_DEFAULTS.map((escalation) => ({
      policy_id: escalationIds.get(escalation.systemKey),
      wait_seconds: escalation.acknowledgementTimeoutSeconds,
    }));
    const escalationStepResult = await client.query<{ escalation_steps: string }>(
      `WITH defaults AS (
         SELECT *
         FROM jsonb_to_recordset($1::jsonb) AS d(policy_id uuid, wait_seconds integer)
       ),
       upserted AS (
         INSERT INTO alerting_escalation_steps_v2
            (policy_id, step_number, wait_seconds, connector_ids, route_ids, notify_on_call, is_active)
         SELECT policy_id, 1, wait_seconds, '{}', '{}', FALSE, TRUE
         FROM defaults
         ON CONFLICT (policy_id, step_number) DO UPDATE SET
           wait_seconds = EXCLUDED.wait_seconds,
           connector_ids = '{}',
           route_ids = '{}',
           notify_on_call = FALSE,
           is_active = TRUE,
           updated_at = NOW()
         RETURNING id
       )
       SELECT COUNT(*)::text AS escalation_steps FROM upserted`,
      [JSON.stringify(escalationStepPayload)],
    );
    const escalationSteps = Number.parseInt(escalationStepResult.rows[0]?.escalation_steps ?? '0', 10);

    const defaultEscalationId = escalationIds.get('default') ?? null;
    await client.query(
      `INSERT INTO alerting_settings
         (workspace_id, timezone, default_escalation_policy_id)
       VALUES ($1, 'UTC', $2)
       ON CONFLICT (workspace_id) DO UPDATE SET
         default_escalation_policy_id = EXCLUDED.default_escalation_policy_id,
         updated_at = NOW()`,
      [workspace.id, defaultEscalationId],
    );
    await client.query(
      `INSERT INTO alerting_maintenance_config (workspace_id)
       VALUES ($1)
       ON CONFLICT (workspace_id) DO NOTHING`,
      [workspace.id],
    );
    await client.query(
      `INSERT INTO alerting_notification_defaults (workspace_id)
       VALUES ($1)
       ON CONFLICT (workspace_id) DO NOTHING`,
      [workspace.id],
    );

    const providerResult = await client.query<{ providers: string }>(
      `WITH defaults AS (
         SELECT *
         FROM jsonb_to_recordset($2::jsonb) AS d(provider_key text, display_name text, capabilities jsonb)
       ),
       upserted AS (
         INSERT INTO alerting_provider_catalog
            (organization_id, provider_key, display_name, status, capabilities, metadata)
         SELECT $1::uuid, provider_key, display_name, 'not_configured', capabilities, '{}'::jsonb
         FROM defaults
         ON CONFLICT (organization_id, provider_key) DO UPDATE SET
           display_name = EXCLUDED.display_name,
           capabilities = EXCLUDED.capabilities,
           updated_at = NOW()
         RETURNING id
       )
       SELECT COUNT(*)::text AS providers FROM upserted`,
      [
        context.organizationId,
        JSON.stringify(PROVIDER_DEFAULTS.map((provider) => ({
          provider_key: provider.providerKey,
          display_name: provider.displayName,
          capabilities: provider.capabilities,
        }))),
      ],
    );
    const providers = Number.parseInt(providerResult.rows[0]?.providers ?? '0', 10);

    const entitlementResult = await client.query<EntitlementRow>(
      `SELECT bf.feature_key, pfe.boolean_value, pfe.integer_value, pfe.decimal_value, pfe.string_value
       FROM plan_feature_entitlements pfe
       JOIN billing_features bf ON bf.id = pfe.feature_id
       WHERE pfe.plan_id = $1 AND pfe.deleted_at IS NULL AND bf.deleted_at IS NULL
       ORDER BY bf.feature_key`,
      [context.planId],
    );
    const limits: JsonObject = {};
    const features: JsonObject = {};
    const entitlementMap = new Map<string, EntitlementRow>();
    for (const row of entitlementResult.rows) {
      entitlementMap.set(row.feature_key, row);
      const value = row.boolean_value ?? (row.integer_value !== null ? Number(row.integer_value) : row.decimal_value !== null ? Number(row.decimal_value) : row.string_value);
      if (['projects', 'organization_members', 'api_keys', 'connectors', 'alert_rules', 'dashboards', 'retention_days', 'monthly_events', 'ai_credits'].includes(row.feature_key)) limits[row.feature_key] = value;
      else features[row.feature_key] = value;
    }
    const planResult = await client.query<{ key: string }>('SELECT key FROM plans WHERE id = $1', [context.planId]);
    const planKey = planResult.rows[0]?.key ?? 'unknown';
    // HISTORICAL SNAPSHOT ONLY: alerting_entitlements is persisted for workspace creation
    // audit history/diagnostics only. RUNTIME AUTHORIZATION MUST ALWAYS RESOLVE THROUGH EntitlementsService.
    await client.query(
      `INSERT INTO alerting_entitlements (workspace_id, organization_id, subscription_id, plan_key, limits, features)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb)
       ON CONFLICT (workspace_id) DO UPDATE SET
         organization_id = EXCLUDED.organization_id,
         subscription_id = EXCLUDED.subscription_id,
         plan_key = EXCLUDED.plan_key,
         limits = EXCLUDED.limits,
         features = EXCLUDED.features,
         source_version = EXCLUDED.source_version,
         updated_at = NOW()`,
      [workspace.id, context.organizationId, context.subscriptionId, planKey, JSON.stringify(limits), JSON.stringify(features)],
    );
    await client.query(
      `INSERT INTO alerting_usage_counters (workspace_id, organization_id)
       VALUES ($1, $2)
       ON CONFLICT (workspace_id) DO NOTHING`,
      [workspace.id, context.organizationId],
    );

    const featureFlagResult = await client.query<{ feature_flags: string }>(
      `WITH defaults AS (
         SELECT *
         FROM jsonb_to_recordset($2::jsonb) AS d(key text, enabled boolean, description text)
       ),
       upserted AS (
         INSERT INTO feature_flags (key, scope, scope_id, enabled, description, payload)
         SELECT key, 'organization', $1::uuid, enabled, description, '{}'::jsonb
         FROM defaults
         ON CONFLICT (key, scope, scope_id) DO UPDATE SET
           enabled = EXCLUDED.enabled,
           description = EXCLUDED.description,
           updated_at = NOW()
         RETURNING id
       )
       SELECT COUNT(*)::text AS feature_flags FROM upserted`,
      [
        context.organizationId,
        JSON.stringify(FEATURE_FLAG_DEFAULTS.map((flag) => ({
          key: flag.key,
          enabled: entitlementMap.get(flag.entitlementKey)?.boolean_value === true,
          description: flag.description,
        }))),
      ],
    );
    const featureFlags = Number.parseInt(featureFlagResult.rows[0]?.feature_flags ?? '0', 10);

    const dashboardWidgetResult = await client.query<{ dashboard_widgets: string }>(
      `WITH defaults AS (
         SELECT *
         FROM jsonb_to_recordset($2::jsonb) AS d(widget_key text, display_name text, position jsonb)
       ),
       upserted AS (
         INSERT INTO alerting_dashboard_widgets
            (workspace_id, widget_key, display_name, position, configuration, is_visible)
         SELECT $1::uuid, widget_key, display_name, position, '{}'::jsonb, TRUE
         FROM defaults
         ON CONFLICT (workspace_id, widget_key) DO UPDATE SET
           display_name = EXCLUDED.display_name,
           position = EXCLUDED.position,
           updated_at = NOW()
         RETURNING id
       )
       SELECT COUNT(*)::text AS dashboard_widgets FROM upserted`,
      [
        workspace.id,
        JSON.stringify(DASHBOARD_WIDGET_DEFAULTS.map((widgetKey, index) => ({
          widget_key: widgetKey,
          display_name: widgetKey.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()),
          position: { order: index },
        }))),
      ],
    );
    const dashboardWidgets = Number.parseInt(dashboardWidgetResult.rows[0]?.dashboard_widgets ?? '0', 10);

    const savedViewResult = await client.query<{ saved_views: string }>(
      `WITH defaults AS (
         SELECT *
         FROM jsonb_to_recordset($3::jsonb) AS d(view_key text, name text, filters jsonb)
       ),
       upserted AS (
         INSERT INTO alerting_saved_views (workspace_id, view_key, name, filters, is_system, created_by)
         SELECT $1::uuid, view_key, name, filters, TRUE, $2::uuid
         FROM defaults
         ON CONFLICT (workspace_id, view_key) DO UPDATE SET
           name = EXCLUDED.name,
           filters = EXCLUDED.filters,
           updated_at = NOW()
         RETURNING id
       )
       SELECT COUNT(*)::text AS saved_views FROM upserted`,
      [
        workspace.id,
        context.initializedBy,
        JSON.stringify(SAVED_VIEW_DEFAULTS.map((view) => ({
          view_key: view.key,
          name: view.name,
          filters: view.filters,
        }))),
      ],
    );
    const savedViews = Number.parseInt(savedViewResult.rows[0]?.saved_views ?? '0', 10);

    await client.query(
      `INSERT INTO alerting_audit_roots (workspace_id, root_version)
       VALUES ($1, 1)
       ON CONFLICT (workspace_id) DO NOTHING`,
      [workspace.id],
    );
    await client.query(
      `INSERT INTO alerting_search_index_metadata (workspace_id)
       VALUES ($1)
       ON CONFLICT (workspace_id) DO NOTHING`,
      [workspace.id],
    );
    await client.query(
      `INSERT INTO alerting_audit_events
         (workspace_id, organization_id, event_type, entity_type, entity_id, actor_type, actor_id, provisioning_version, payload)
       SELECT $1, $2, 'workspace.initialized', 'alerting_workspace', $1, 'system', $3, $4, $5::jsonb
       WHERE NOT EXISTS (
         SELECT 1 FROM alerting_audit_events WHERE workspace_id = $1 AND event_type = 'workspace.initialized'
       )`,
      [workspace.id, context.organizationId, context.initializedBy, ALERTING_WORKSPACE_INITIALIZATION_VERSION, JSON.stringify({ configurationOnly: true })],
    );
    await client.query(
      `UPDATE alerting_workspaces
       SET provisioning_status = 'ready', completed_at = COALESCE(completed_at, NOW()), last_error = NULL, updated_at = NOW()
       WHERE id = $1`,
      [workspace.id],
    );

    return {
      workspaceId: workspace.id,
      initializationVersion: ALERTING_WORKSPACE_INITIALIZATION_VERSION,
      categories: POLICY_CATEGORIES.length,
      policies: DEFAULT_POLICY_COUNT,
      catalogRules,
      policyVersions,
      routingDefaults: ROUTING_DEFAULTS.length,
      escalationPolicies: ESCALATION_DEFAULTS.length,
      escalationSteps,
      providers,
      dashboardWidgets,
      savedViews,
      featureFlags,
    };
  }

  private async syncDefaultPolicyCatalog(client: PoolClient, organizationId: string, actorId: string | null): Promise<number> {
    const categoryResult = await client.query<{ slug: string; id: string }>(
      `WITH defaults AS (
         SELECT *
         FROM jsonb_to_recordset($2::jsonb) AS d(slug text, name text, sort_order integer)
       )
       INSERT INTO alerting_policy_categories
          (organization_id, slug, name, sort_order, is_system)
       SELECT $1::uuid, slug, name, sort_order, TRUE
       FROM defaults
       ON CONFLICT (organization_id, slug) DO UPDATE
         SET name = EXCLUDED.name, sort_order = EXCLUDED.sort_order, updated_at = NOW()
       RETURNING slug, id`,
      [
        organizationId,
        JSON.stringify(POLICY_CATEGORIES.map((category) => ({
          slug: category.slug,
          name: category.name,
          sort_order: category.sortOrder,
        }))),
      ],
    );
    const categoryIds = new Map(categoryResult.rows.map((row) => [row.slug, row.id]));

    const policyPayload = defaultPolicyPayload().map((definition) => {
      const categoryId = categoryIds.get(definition.category);
      if (!categoryId) throw new Error(`Missing Alerting policy category: ${definition.category}`);
      return {
        slug: definition.slug,
        name: definition.name,
        description: definition.description,
        category_id: categoryId,
        severity: definition.severity,
        default_threshold: definition.defaultThreshold,
        recovery_threshold: definition.recoveryThreshold,
        cooldown_seconds: definition.cooldownSeconds,
        evaluation_window_seconds: definition.evaluationWindowSeconds,
        enabled: definition.enabled,
        version_definition: {
          slug: definition.slug,
          name: definition.name,
          description: definition.description,
          category: definition.category,
          severity: definition.severity,
          metricSource: definition.metricSource,
          expression: definition.expression,
          defaultThreshold: definition.defaultThreshold,
          recoveryThreshold: definition.recoveryThreshold,
          cooldownSeconds: definition.cooldownSeconds,
          evaluationWindowSeconds: definition.evaluationWindowSeconds,
          enabled: definition.enabled,
          documentation: definition.documentation,
          dependencies: definition.dependencies,
        },
      };
    });

    const policyVersionResult = await client.query<{ policy_versions: string }>(
      `WITH defaults AS (
         SELECT *
         FROM jsonb_to_recordset($3::jsonb) AS d(
           slug text,
           name text,
           description text,
           category_id uuid,
           severity text,
           default_threshold jsonb,
           recovery_threshold jsonb,
           cooldown_seconds integer,
           evaluation_window_seconds integer,
           enabled boolean,
           version_definition jsonb
         )
       ),
       policies AS (
         INSERT INTO alerting_policy_catalog
            (organization_id, slug, name, description, category_id, severity,
             default_threshold, recovery_threshold, cooldown_seconds,
             evaluation_window_seconds, enabled, is_system, current_version)
         SELECT
           $1::uuid, slug, name, description, category_id, severity::alert_severity,
           default_threshold, recovery_threshold, cooldown_seconds,
           evaluation_window_seconds, enabled, TRUE, 1
         FROM defaults
         ON CONFLICT (organization_id, slug) DO UPDATE SET
           name = EXCLUDED.name,
           description = EXCLUDED.description,
           category_id = EXCLUDED.category_id,
           severity = EXCLUDED.severity,
           default_threshold = EXCLUDED.default_threshold,
           recovery_threshold = EXCLUDED.recovery_threshold,
           cooldown_seconds = EXCLUDED.cooldown_seconds,
           evaluation_window_seconds = EXCLUDED.evaluation_window_seconds,
           enabled = EXCLUDED.enabled,
           updated_at = NOW()
         RETURNING id, slug
       ),
       versions AS (
         INSERT INTO alerting_policy_versions
            (organization_id, policy_id, version, definition, created_by)
         SELECT
           $1::uuid,
           p.id,
           1,
           d.version_definition,
           CASE
             WHEN $2::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
             THEN $2::uuid
             ELSE NULL
           END
         FROM policies p
         JOIN defaults d ON d.slug = p.slug
         ON CONFLICT (policy_id, version) DO NOTHING
         RETURNING id
       )
       SELECT COUNT(*)::text AS policy_versions FROM versions`,
      [organizationId, actorId, JSON.stringify(policyPayload)],
    );
    return Number.parseInt(policyVersionResult.rows[0]?.policy_versions ?? '0', 10);
  }

  private readySummary(workspaceId: string): AlertingProvisioningSummary {
    return {
      workspaceId,
      initializationVersion: ALERTING_WORKSPACE_INITIALIZATION_VERSION,
      categories: POLICY_CATEGORIES.length,
      policies: DEFAULT_POLICY_COUNT,
      catalogRules: 0,
      policyVersions: DEFAULT_POLICY_COUNT,
      routingDefaults: ROUTING_DEFAULTS.length,
      escalationPolicies: ESCALATION_DEFAULTS.length,
      escalationSteps: ESCALATION_DEFAULTS.length,
      providers: PROVIDER_DEFAULTS.length,
      dashboardWidgets: DASHBOARD_WIDGET_DEFAULTS.length,
      savedViews: SAVED_VIEW_DEFAULTS.length,
      featureFlags: FEATURE_FLAG_DEFAULTS.length,
    };
  }

  private async lockWorkspace(client: PoolClient, organizationId: string): Promise<WorkspaceRow> {
    const result = await client.query<WorkspaceRow>(
      `SELECT id, initialization_version, provisioning_status
       FROM alerting_workspaces
       WHERE organization_id = $1
       FOR UPDATE`,
      [organizationId],
    );
    const workspace = result.rows[0];
    if (!workspace) throw new Error(`Alerting workspace was not created for organization ${organizationId}`);
    return workspace;
  }

  async getWorkspaceSnapshot(organizationId: string) {
    const db: Pool = pool;
    const workspace = await db.query(
      `SELECT id, organization_id, version, initialized_by, initialization_version,
              provisioning_status, completed_at, created_at, updated_at
       FROM alerting_workspaces WHERE organization_id = $1`,
      [organizationId],
    );
    const row = workspace.rows[0];
    if (!row) return null;
    const [categories, policies, routing, escalations, settings, maintenance, notifications, providers, entitlements, usage, flags, widgets, views, audit, search] = await Promise.all([
      db.query(`SELECT id, slug, name, description, sort_order, is_system, created_at, updated_at FROM alerting_policy_categories WHERE organization_id = $1 ORDER BY sort_order, slug`, [organizationId]),
      db.query(`SELECT p.id, p.organization_id, p.slug, p.name, p.description, c.slug AS category, p.severity, p.default_threshold, p.recovery_threshold, p.cooldown_seconds, p.evaluation_window_seconds, p.enabled, p.is_system, p.current_version, COALESCE(v.definition->>'metricSource', '') AS metric_source, COALESCE(v.definition->>'expression', '') AS expression, COALESCE(v.definition->>'documentation', p.description) AS documentation, COALESCE(v.definition->'dependencies', '[]'::jsonb) AS dependencies, p.created_at, p.updated_at FROM alerting_policy_catalog p JOIN alerting_policy_categories c ON c.id = p.category_id LEFT JOIN alerting_policy_versions v ON v.policy_id = p.id AND v.version = p.current_version WHERE p.organization_id = $1 ORDER BY c.sort_order, p.slug`, [organizationId]),
      db.query(`SELECT id, severity, destination_type, connector_id, route_id, is_enabled, priority, config, created_at, updated_at FROM alerting_routing_defaults WHERE organization_id = $1 ORDER BY priority, severity`, [organizationId]),
      db.query(`SELECT p.id, p.system_key, p.name, p.description, p.acknowledgement_timeout_seconds, p.repeat_interval_seconds, p.max_repeats, p.cancellation_rules, p.is_default, p.created_at, p.updated_at, COALESCE(jsonb_agg(to_jsonb(s) ORDER BY s.step_number) FILTER (WHERE s.id IS NOT NULL), '[]'::jsonb) AS steps FROM alerting_escalation_policies_v2 p LEFT JOIN alerting_escalation_steps_v2 s ON s.policy_id = p.id WHERE p.organization_id = $1 GROUP BY p.id ORDER BY p.system_key`, [organizationId]),
      db.query(`SELECT s.* FROM alerting_settings s JOIN alerting_workspaces w ON w.id = s.workspace_id WHERE w.organization_id = $1`, [organizationId]),
      db.query(`SELECT m.* FROM alerting_maintenance_config m JOIN alerting_workspaces w ON w.id = m.workspace_id WHERE w.organization_id = $1`, [organizationId]),
      db.query(`SELECT n.* FROM alerting_notification_defaults n JOIN alerting_workspaces w ON w.id = n.workspace_id WHERE w.organization_id = $1`, [organizationId]),
      db.query(`SELECT id, provider_key, display_name, status, capabilities, metadata, created_at, updated_at FROM alerting_provider_catalog WHERE organization_id = $1 ORDER BY provider_key`, [organizationId]),
      db.query(`SELECT e.* FROM alerting_entitlements e WHERE e.organization_id = $1`, [organizationId]),
      db.query(`SELECT u.* FROM alerting_usage_counters u WHERE u.organization_id = $1`, [organizationId]),
      db.query(`SELECT key, enabled, payload, description, updated_at FROM feature_flags WHERE scope = 'organization' AND scope_id = $1 ORDER BY key`, [organizationId]),
      db.query(`SELECT d.* FROM alerting_dashboard_widgets d JOIN alerting_workspaces w ON w.id = d.workspace_id WHERE w.organization_id = $1 ORDER BY (d.position->>'order')::int, d.widget_key`, [organizationId]),
      db.query(`SELECT v.* FROM alerting_saved_views v JOIN alerting_workspaces w ON w.id = v.workspace_id WHERE w.organization_id = $1 ORDER BY v.view_key`, [organizationId]),
      db.query(`SELECT id, event_type, entity_type, entity_id, actor_type, actor_id, provisioning_version, payload, created_at FROM alerting_audit_events WHERE organization_id = $1 ORDER BY created_at DESC, id DESC LIMIT 100`, [organizationId]),
      db.query(`SELECT s.* FROM alerting_search_index_metadata s JOIN alerting_workspaces w ON w.id = s.workspace_id WHERE w.organization_id = $1`, [organizationId]),
    ]);
    return {
      workspace: row,
      categories: categories.rows,
      policies: policies.rows,
      routingDefaults: routing.rows,
      escalationPolicies: escalations.rows,
      settings: settings.rows[0] ?? null,
      maintenance: maintenance.rows[0] ?? null,
      notificationDefaults: notifications.rows[0] ?? null,
      providerCatalog: providers.rows,
      entitlements: entitlements.rows[0] ?? null,
      usage: usage.rows[0] ?? null,
      featureFlags: flags.rows,
      dashboardWidgets: widgets.rows,
      savedViews: views.rows,
      audit: audit.rows,
      search: search.rows[0] ?? null,
    };
  }

  async listPolicies(organizationId: string, query: { limit?: number; offset?: number } = {}) {
    const limit = query.limit ?? 15;
    const offset = query.offset ?? 0;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const workspace = await client.query<{ initialized_by: string | null }>(
        `SELECT initialized_by
         FROM alerting_workspaces
         WHERE organization_id = $1
           AND provisioning_status = 'ready'
         FOR UPDATE`,
        [organizationId],
      );
      const actorId = workspace.rows[0]?.initialized_by ?? null;
      if (actorId !== null) {
        await this.syncDefaultPolicyCatalog(client, organizationId, actorId);
      }

      const count = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM alerting_policy_catalog p
         WHERE p.organization_id = $1`,
        [organizationId],
      );
      const result = await client.query(
        `SELECT p.id, p.organization_id, p.slug, p.name, p.description, c.slug AS category,
                p.severity, p.default_threshold, p.recovery_threshold, p.cooldown_seconds,
                p.evaluation_window_seconds, p.enabled, p.is_system, p.current_version,
                COALESCE(v.definition->>'metricSource', '') AS metric_source,
                COALESCE(v.definition->>'expression', '') AS expression,
                COALESCE(v.definition->>'documentation', p.description) AS documentation,
                COALESCE(v.definition->'dependencies', '[]'::jsonb) AS dependencies,
                COALESCE(v.definition, '{}'::jsonb) AS current_definition,
                p.created_at, p.updated_at
         FROM alerting_policy_catalog p
         LEFT JOIN alerting_policy_versions v ON v.policy_id = p.id AND v.version = p.current_version
         JOIN alerting_policy_categories c ON c.id = p.category_id
         WHERE p.organization_id = $1
         ORDER BY c.sort_order, p.slug
         LIMIT $2 OFFSET $3`,
        [organizationId, limit, offset],
      );
      await client.query('COMMIT');
      return { data: result.rows, total: Number(count.rows[0]?.count ?? 0), limit, offset };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async getPolicy(organizationId: string, policyId: string) {
    const result = await pool.query(
      `SELECT p.id, p.organization_id, p.slug, p.name, p.description, c.slug AS category,
              p.severity, p.default_threshold, p.recovery_threshold, p.cooldown_seconds,
              p.evaluation_window_seconds, p.enabled, p.is_system, p.current_version,
              COALESCE(current_version.definition->>'metricSource', '') AS metric_source,
              COALESCE(current_version.definition->>'expression', '') AS expression,
              COALESCE(current_version.definition->>'documentation', p.description) AS documentation,
              COALESCE(current_version.definition->'dependencies', '[]'::jsonb) AS dependencies,
              COALESCE(current_version.definition, '{}'::jsonb) AS current_definition,
              COALESCE(jsonb_agg(to_jsonb(v) ORDER BY v.version) FILTER (WHERE v.id IS NOT NULL), '[]'::jsonb) AS versions
       FROM alerting_policy_catalog p
       JOIN alerting_policy_categories c ON c.id = p.category_id
       LEFT JOIN alerting_policy_versions v ON v.policy_id = p.id
       LEFT JOIN alerting_policy_versions current_version ON current_version.policy_id = p.id AND current_version.version = p.current_version
       WHERE p.organization_id = $1 AND p.id = $2
       GROUP BY p.id, c.slug, c.sort_order, current_version.definition`,
      [organizationId, policyId],
    );
    return result.rows[0] ?? null;
  }

  async createPolicy(organizationId: string, actorId: string, input: {
    slug: string; name: string; description: string; category: string; severity: string;
    metricSource: string; expression: string; defaultThreshold: JsonObject;
    recoveryThreshold: JsonObject; cooldownSeconds: number; evaluationWindowSeconds: number;
    documentation: string; dependencies: string[];
  }) {
    return this.withTransaction(async (client) => {
      const category = await client.query<{ id: string }>(
        `SELECT id FROM alerting_policy_categories WHERE organization_id = $1 AND slug = $2`,
        [organizationId, input.category],
      );
      const categoryId = category.rows[0]?.id;
      if (!categoryId) throw new Error(`Alerting policy category not found: ${input.category}`);
      const policy = await client.query(
        `INSERT INTO alerting_policy_catalog
           (organization_id, slug, name, description, category_id, severity, default_threshold,
            recovery_threshold, cooldown_seconds, evaluation_window_seconds, enabled, is_system, current_version)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10, TRUE, FALSE, 1)
         RETURNING *`,
        [organizationId, input.slug, input.name, input.description, categoryId, input.severity, JSON.stringify(input.defaultThreshold), JSON.stringify(input.recoveryThreshold), input.cooldownSeconds, input.evaluationWindowSeconds],
      );
      const policyRow = policy.rows[0];
      await client.query(
        `INSERT INTO alerting_policy_versions (organization_id, policy_id, version, definition, created_by)
         VALUES ($1, $2, 1, $3::jsonb, $4)`,
        [organizationId, policyRow.id, JSON.stringify({ ...input, version: 1 }), actorId],
      );
      return policyRow;
    });
  }

  async createPolicyVersion(organizationId: string, actorId: string, policyId: string, definition: JsonObject) {
    return this.withTransaction(async (client) => {
      const policy = await client.query<{ current_version: number }>(
        `SELECT current_version FROM alerting_policy_catalog WHERE organization_id = $1 AND id = $2 FOR UPDATE`,
        [organizationId, policyId],
      );
      const current = policy.rows[0];
      if (!current) return null;
      const version = current.current_version + 1;
      await client.query(
        `INSERT INTO alerting_policy_versions (organization_id, policy_id, version, definition, created_by)
         VALUES ($1, $2, $3, $4::jsonb, $5)`,
        [organizationId, policyId, version, JSON.stringify(definition), actorId],
      );
      const result = await client.query(
        `UPDATE alerting_policy_catalog SET current_version = $3, updated_at = NOW() WHERE organization_id = $1 AND id = $2 RETURNING *`,
        [organizationId, policyId, version],
      );
      return result.rows[0] ?? null;
    });
  }

  async updateSettings(organizationId: string, input: Record<string, unknown>) {
    return this.updateWorkspaceRow('alerting_settings', 'workspace_id', organizationId, input, {
      timezone: 'timezone', defaultEvaluationWindowSeconds: 'default_evaluation_window_seconds', defaultCooldownSeconds: 'default_cooldown_seconds',
      retentionDays: 'retention_days', defaultSeverity: 'default_severity', defaultRoutingKey: 'default_routing_key',
      maximumIncidentAgeSeconds: 'maximum_incident_age_seconds', digestDefaults: 'digest_defaults',
    });
  }

  async updateMaintenance(organizationId: string, input: Record<string, unknown>) {
    return this.updateWorkspaceRow('alerting_maintenance_config', 'workspace_id', organizationId, input, {
      timezone: 'timezone', suppressionEnabled: 'suppression_enabled', recurringSupportEnabled: 'recurring_support_enabled', defaultSuppressionSettings: 'default_suppression_settings',
    });
  }

  async updateNotificationDefaults(organizationId: string, input: Record<string, unknown>) {
    return this.updateWorkspaceRow('alerting_notification_defaults', 'workspace_id', organizationId, input, {
      emailEnabled: 'email_enabled', digestEnabled: 'digest_enabled', businessHours: 'business_hours', quietHours: 'quiet_hours', fallbackBehavior: 'fallback_behavior',
    });
  }

  private async updateWorkspaceRow(
    table: string,
    _keyColumn: string,
    organizationId: string,
    input: Record<string, unknown>,
    fieldMap: Record<string, string>,
  ) {
    const assignments: string[] = [];
    const values: unknown[] = [];
    for (const [key, column] of Object.entries(fieldMap)) {
      if (input[key] !== undefined) {
        values.push(typeof input[key] === 'object' ? JSON.stringify(input[key]) : input[key]);
        assignments.push(`${column} = $${values.length}${typeof input[key] === 'object' ? '::jsonb' : ''}`);
      }
    }
    if (assignments.length === 0) return this.getWorkspaceSnapshot(organizationId);
    values.push(organizationId);
    const result = await pool.query(
      `UPDATE ${table} t SET ${assignments.join(', ')}, updated_at = NOW()
       FROM alerting_workspaces w
       WHERE w.organization_id = $${values.length} AND t.workspace_id = w.id
       RETURNING t.*`,
      values,
    );
    return result.rows[0] ?? null;
  }

  private async withTransaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}
