import { describe, expect, it } from 'vitest';

import {
  DRAFT_MIGRATIONS_DIR,
  listMigrationFiles,
  readMigrationSql,
  resolveMigrationsDir,
} from '../../scripts/lib/migrations.js';

describe('canonical_migrations_draft discovery', () => {
  it('is the default migration runner source of truth', async () => {
    await expect(resolveMigrationsDir([], {})).resolves.toBe(DRAFT_MIGRATIONS_DIR);
  });

  it('lists the draft domain-based chain in lexicographic relative order', async () => {
    const files = await listMigrationFiles(DRAFT_MIGRATIONS_DIR);

    expect(files[0]).toBe('00_shared/001_enable_pgcrypto.up.sql');
    expect(files).toContain('03_org_identity/001_create_organization_sso_providers.up.sql');
    expect(files).toContain('04_projects/002_create_project_members.up.sql');
    expect(files).toContain('04_projects/005_create_project_api_keys.up.sql');
    expect(files).toContain('04_projects/015_create_environment_sdk_configuration.up.sql');
    expect(files).toContain('04_projects/016_add_environment_runtime_configuration.up.sql');
    expect(files).toContain('04_projects/017_simplify_project_environments.up.sql');
    expect(files).toContain('04_projects/018_normalize_project_api_keys_and_usage.up.sql');
    expect(files.some((file) => file.startsWith('05_project_credentials/'))).toBe(false);
    expect(files.some((file) => file.startsWith('20_project_module_refactor/'))).toBe(false);
    expect(files).not.toContain('04_projects/999_delete_all_project_tables.down.sql');
    expect(files).toContain('06_connectors/001_create_connector_configs.up.sql');
    expect(files).toContain('06_connectors/002_create_connector_credentials.up.sql');
    expect(files).toContain('06_connectors/003_create_connector_secret_versions.up.sql');
    expect(files).toContain('06_connectors/004_create_connector_routes.up.sql');
    expect(files).toContain('06_connectors/005_create_connector_deliveries.up.sql');
    expect(files).toContain('06_connectors/006_create_connector_delivery_attempts.up.sql');
    expect(files).toContain('06_connectors/007_create_connector_health_checks.up.sql');
    expect(files).toContain('06_connectors/008_create_connector_test_runs.up.sql');
    expect(files).toContain('06_connectors/009_create_connector_oauth_states.up.sql');
    expect(files).toContain('06_connectors/010_create_connector_audit_logs.up.sql');
    expect(files).toContain('08_alerting/005_create_alert_events.up.sql');
    expect(files).toContain('09_audit/002_enhance_audit_logs.up.sql');
    expect(files).toContain('10_security/001_harden_organization_security_indexes.up.sql');
    expect(files).toContain('12_monitoring/001_create_backpressure_gauge.up.sql');
    expect(files).toContain('13_ingestion/009_create_project_usage_realtime_view.up.sql');
    expect(files).toContain('14_observability/006_create_timescaledb_setup_shim.up.sql');
    expect(files).not.toContain('15_analytics/002_create_project_usage_hourly_and_daily.up.sql');
    expect(files).toContain('15_analytics/006_create_analytics_config_tables.up.sql');
    expect(files).toContain('16_legacy_compat/003_create_legacy_failure_tables.up.sql');
    expect(files).toContain('17_enterprise_ingestion/001_events_idempotency.up.sql');
    expect(files).toContain('17_enterprise_ingestion/005_usage_counters_default_partition.up.sql');
    expect(files).toContain('18_ai/001_extensions.up.sql');
    expect(files).toContain('18_ai/012_enterprise_ai_runtime.up.sql');
    // Automation follows AI.
    expect(files).toContain('19_automation/001_automation_enums.sql');
    expect(files).toContain('19_automation/015_automation_default_templates_seed.sql');
  });

  it('declares the required enterprise connector tables and partitions high-volume history', async () => {
    const requiredTables = [
      'connector_configs',
      'connector_credentials',
      'connector_secret_versions',
      'connector_routes',
      'connector_deliveries',
      'connector_delivery_attempts',
      'connector_health_checks',
      'connector_test_runs',
      'connector_oauth_states',
      'connector_audit_logs',
    ];
    const files = await listMigrationFiles(DRAFT_MIGRATIONS_DIR);
    const connectorSql = (await Promise.all(
      files
        .filter((file) => file.startsWith('06_connectors/'))
        .map((file) => readMigrationSql(file, DRAFT_MIGRATIONS_DIR)),
    )).join('\n');

    for (const table of requiredTables) {
      expect(connectorSql).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
    }

    for (const table of [
      'connector_deliveries',
      'connector_delivery_attempts',
      'connector_health_checks',
      'connector_audit_logs',
    ]) {
      expect(connectorSql).toMatch(new RegExp(`CREATE TABLE IF NOT EXISTS ${table}[\\s\\S]*PARTITION BY RANGE`, 'm'));
      expect(connectorSql).toContain(`PARTITION OF ${table} DEFAULT`);
    }

    expect(connectorSql).not.toContain('connector_secrets');
    expect(connectorSql).not.toContain('encrypted_config');
  });

  it('keeps connector migration columns aligned with runtime repositories', async () => {
    const files = await listMigrationFiles(DRAFT_MIGRATIONS_DIR);
    const connectorSql = (await Promise.all(
      files
        .filter((file) => file.startsWith('06_connectors/'))
        .map((file) => readMigrationSql(file, DRAFT_MIGRATIONS_DIR)),
    )).join('\n');

    const expectedColumnsByTable: Record<string, string[]> = {
      connector_configs: [
        'organization_id',
        'project_id',
        'provider',
        'status',
        'public_config',
        'provider_metadata',
        'rate_limit_requests',
        'rate_limit_window_seconds',
        'max_retries',
        'retry_backoff_base_ms',
        'retry_backoff_multiplier',
        'last_health_check_at',
        'last_successful_delivery_at',
        'consecutive_failures',
        'failure_threshold',
        'deleted_at',
      ],
      connector_credentials: [
        'connector_id',
        'credential_type',
        'key_name',
        'encrypted_value',
        'algorithm',
        'version',
        'expires_at',
        'rotated_at',
        'last_used_at',
      ],
      connector_routes: [
        'connector_id',
        'project_id',
        'environment',
        'event_type',
        'severity',
        'enabled',
      ],
      connector_deliveries: [
        'organization_id',
        'connector_id',
        'route_id',
        'notification_type',
        'severity',
        'status',
        'http_status',
        'external_message_id',
        'payload',
        'payload_size_bytes',
        'provider_response',
        'response_body',
        'response_status_code',
        'error_message',
        'error_details',
        'attempts',
        'max_attempts',
        'duration_ms',
        'delivery_latency_ms',
        'retry_count',
        'next_retry_at',
        'correlation_id',
        'parent_delivery_id',
        'sent_at',
        'failed_at',
        'delivered_at',
      ],
      connector_delivery_attempts: [
        'delivery_id',
        'delivery_created_at',
        'attempt_number',
        'status',
        'http_status',
        'error_code',
        'error_message',
        'response',
        'duration_ms',
        'attempted_at',
      ],
      connector_health_checks: [
        'connector_id',
        'status',
        'http_status',
        'response_time_ms',
        'error_code',
        'error_message',
        'details',
        'checked_at',
      ],
      connector_test_runs: [
        'connector_id',
        'triggered_by',
        'status',
        'response',
        'duration_ms',
        'created_at',
      ],
      connector_oauth_states: [
        'connector_id',
        'state',
        'code_verifier',
        'expires_at',
        'created_at',
      ],
      connector_audit_logs: [
        'organization_id',
        'connector_id',
        'action',
        'actor_id',
        'actor_type',
        'previous_state',
        'new_state',
        'changes_summary',
        'ip_address',
        'user_agent',
        'request_id',
        'created_at',
      ],
    };

    for (const [table, columns] of Object.entries(expectedColumnsByTable)) {
      const match = connectorSql.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\(([\\s\\S]*?)\\n\\)`, 'm'));
      expect(match, `missing ${table} migration`).not.toBeNull();
      const tableSql = match?.[1] ?? '';
      for (const column of columns) {
        expect(tableSql, `${table}.${column}`).toMatch(new RegExp(`\\b${column}\\b`, 'm'));
      }
    }
  });

  it('does not recreate legacy notification delivery tables outside the connector schema', async () => {
    const files = await listMigrationFiles(DRAFT_MIGRATIONS_DIR);
    const allSql = (await Promise.all(
      files.map((file) => readMigrationSql(file, DRAFT_MIGRATIONS_DIR)),
    )).join('\n');

    expect(files).not.toContain('07_notifications/004_create_notification_deliveries.up.sql');
    expect(files).not.toContain('07_notifications/005_create_notification_dead_letter.up.sql');
    expect(allSql).not.toContain('CREATE TABLE IF NOT EXISTS notification_deliveries');
    expect(allSql).not.toContain('CREATE TABLE IF NOT EXISTS notification_dead_letter');
  });
});

describe('project environment simplification migration', () => {
  it('adds the canonical type enum and removes obsolete environment controls', async () => {
    const sql = await readMigrationSql(
      '04_projects/017_simplify_project_environments.up.sql',
      DRAFT_MIGRATIONS_DIR,
    );
    for (const value of [
      'production', 'pre_production', 'staging', 'pre_staging', 'development',
      'testing', 'preview', 'pre_deployment', 'custom',
    ]) {
      expect(sql).toContain(`'${value}'`);
    }
    for (const column of [
      'icon', 'created_by_user_id', 'created_by_api_key_id', 'version',
      'rate_limit_per_second', 'rate_limit_per_minute', 'rate_limit_per_hour',
      'burst_limit', 'allowed_event_types', 'max_event_size_bytes', 'max_batch_size',
      'require_https', 'ip_allowlist', 'ip_blocklist', 'alert_email', 'alert_webhook_url',
    ]) {
      expect(sql).toContain(`DROP COLUMN IF EXISTS ${column}`);
    }
    expect(sql).toContain("slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'");
    expect(sql).toContain("color ~ '^#[0-9A-Fa-f]{6}$'");
    expect(sql).toContain('WHERE is_default AND is_active AND deleted_at IS NULL');
  });
});


describe('enterprise AI runtime migration', () => {
  it('hardens async idempotency, refund bounds, RAG access metadata, and function privileges', async () => {
    const sql = await readMigrationSql(
      '18_ai/012_enterprise_ai_runtime.up.sql',
      DRAFT_MIGRATIONS_DIR,
    );

    expect(sql).toContain('uq_ai_jobs_tenant_idempotency');
    expect(sql).toContain('original_amount-refunded_amount');
    expect(sql).toContain("direction='debit' AND status='completed'");
    expect(sql).toContain('REVOKE ALL ON FUNCTION ai_refund_credit');
    expect(sql).toContain('access_control JSONB');
    expect(sql).toContain('service_tags TEXT[]');
    expect(sql).toContain('environment_tags TEXT[]');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS ai_usage_receipts');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS ai_conversations');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS ai_chat_requests');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS ai_tool_calls');
    expect(sql).toContain('UNIQUE (tenant_id,idempotency_key)');
  });
});


describe('automation module migrations', () => {
  it('discovers all 15 automation migration files in order', async () => {
    const files = await listMigrationFiles(DRAFT_MIGRATIONS_DIR);
    const automationFiles = files.filter((f) => f.startsWith('19_automation/'));

    expect(automationFiles).toHaveLength(15);
    expect(automationFiles).toEqual([
      '19_automation/001_automation_enums.sql',
      '19_automation/002_automation_workflows.sql',
      '19_automation/003_automation_workflow_versions.sql',
      '19_automation/004_automation_triggers.sql',
      '19_automation/005_automation_conditions.sql',
      '19_automation/006_automation_actions.sql',
      '19_automation/007_automation_runs.sql',
      '19_automation/008_automation_run_steps.sql',
      '19_automation/009_automation_approvals.sql',
      '19_automation/010_automation_templates.sql',
      '19_automation/011_automation_template_versions.sql',
      '19_automation/012_automation_events_inbox.sql',
      '19_automation/013_automation_audit_logs.sql',
      '19_automation/014_automation_indexes_and_views.sql',
      '19_automation/015_automation_default_templates_seed.sql',
    ]);
  });

  it('declares all required automation tables with idempotent CREATE TABLE IF NOT EXISTS', async () => {
    const files = await listMigrationFiles(DRAFT_MIGRATIONS_DIR);
    const automationSql = (await Promise.all(
      files
        .filter((f) => f.startsWith('19_automation/'))
        .map((f) => readMigrationSql(f, DRAFT_MIGRATIONS_DIR)),
    )).join('\n');

    const requiredTables = [
      'automation_workflows',
      'automation_workflow_versions',
      'automation_triggers',
      'automation_conditions',
      'automation_actions',
      'automation_runs',
      'automation_run_steps',
      'automation_approvals',
      'automation_templates',
      'automation_template_versions',
      'automation_events_inbox',
      'automation_audit_logs',
    ];

    for (const table of requiredTables) {
      expect(automationSql).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
    }
  });

  it('creates all required enums with guarded creation', async () => {
    const sql = await readMigrationSql(
      '19_automation/001_automation_enums.sql',
      DRAFT_MIGRATIONS_DIR,
    );

    const requiredEnums = [
      'automation_workflow_status',
      'automation_workflow_scope',
      'automation_template_scope',
      'automation_trigger_kind',
      'automation_condition_operator',
      'automation_action_risk',
      'automation_run_status',
      'automation_step_status',
      'automation_approval_status',
      'automation_audit_action',
    ];

    for (const enumName of requiredEnums) {
      expect(sql).toContain(`typname = '${enumName}'`);
      expect(sql).toContain(`CREATE TYPE ${enumName} AS ENUM`);
    }
  });

  it('creates summary views for frontend consumption', async () => {
    const sql = await readMigrationSql(
      '19_automation/014_automation_indexes_and_views.sql',
      DRAFT_MIGRATIONS_DIR,
    );

    expect(sql).toContain('CREATE VIEW v_automation_workflow_summaries');
    expect(sql).toContain('CREATE OR REPLACE VIEW v_automation_run_summaries');
    expect(sql).toContain('CREATE OR REPLACE VIEW v_automation_pending_approvals');

    // View content checks
    expect(sql).toContain('trigger_count');
    expect(sql).toContain('action_count');
    expect(sql).toContain('last_run_status');
    expect(sql).toContain('step_count');
    expect(sql).toContain('failed_step_count');
    expect(sql).toContain('pending_approval_count');
    expect(sql).toContain('workflow_name');
    expect(sql).toContain('action_type');
    expect(sql).toContain('risk_level');
  });

  it('enforces immutability on automation_audit_logs', async () => {
    const sql = await readMigrationSql(
      '19_automation/013_automation_audit_logs.sql',
      DRAFT_MIGRATIONS_DIR,
    );

    expect(sql).toContain('automation_audit_logs_immutable');
    expect(sql).toContain('BEFORE UPDATE ON automation_audit_logs');
    expect(sql).toContain('BEFORE DELETE ON automation_audit_logs');
    expect(sql).toContain('immutable and cannot be modified or deleted');
  });

  it('uses BRIN indexes on append-heavy history tables', async () => {
    const files = await listMigrationFiles(DRAFT_MIGRATIONS_DIR);
    const automationSql = (await Promise.all(
      files
        .filter((f) => f.startsWith('19_automation/'))
        .map((f) => readMigrationSql(f, DRAFT_MIGRATIONS_DIR)),
    )).join('\n');

    expect(automationSql).toMatch(/USING BRIN.*created_at/m);
    expect(automationSql).toMatch(/USING BRIN.*occurred_at/m);
  });

  it('uses GIN indexes on JSONB and array columns', async () => {
    const files = await listMigrationFiles(DRAFT_MIGRATIONS_DIR);
    const automationSql = (await Promise.all(
      files
        .filter((f) => f.startsWith('19_automation/'))
        .map((f) => readMigrationSql(f, DRAFT_MIGRATIONS_DIR)),
    )).join('\n');

    // GIN on tags
    expect(automationSql).toMatch(/USING GIN.*tags/m);
    // GIN on metadata
    expect(automationSql).toMatch(/USING GIN.*metadata/m);
    // GIN on payload
    expect(automationSql).toMatch(/USING GIN.*payload/m);
    // GIN on config
    expect(automationSql).toMatch(/USING GIN.*config/m);
    // GIN on input_payload
    expect(automationSql).toMatch(/USING GIN.*input_payload/m);
  });

  it('resolves forward FK dependencies with deferred ALTER TABLE', async () => {
    const files = await listMigrationFiles(DRAFT_MIGRATIONS_DIR);
    const automationSql = (await Promise.all(
      files
        .filter((f) => f.startsWith('19_automation/'))
        .map((f) => readMigrationSql(f, DRAFT_MIGRATIONS_DIR)),
    )).join('\n');

    // template_id FK added after templates table
    expect(automationSql).toContain('fk_workflows_template');
    expect(automationSql).toContain('REFERENCES automation_templates(id)');

    // approval_id FK added after approvals table
    expect(automationSql).toContain('fk_run_steps_approval');
    expect(automationSql).toContain('REFERENCES automation_approvals(id)');

    // inbox_event_id FK added after events_inbox table
    expect(automationSql).toContain('fk_runs_inbox_event');
    expect(automationSql).toContain('REFERENCES automation_events_inbox(id)');

    // trigger_id FK added after triggers table is available
    expect(automationSql).toContain('fk_runs_trigger');
    expect(automationSql).toContain('REFERENCES automation_triggers(id)');
  });

  it('references existing organizations, projects, users tables correctly', async () => {
    const files = await listMigrationFiles(DRAFT_MIGRATIONS_DIR);
    const automationSql = (await Promise.all(
      files
        .filter((f) => f.startsWith('19_automation/'))
        .map((f) => readMigrationSql(f, DRAFT_MIGRATIONS_DIR)),
    )).join('\n');

    expect(automationSql).toContain('REFERENCES organizations(id)');
    expect(automationSql).toContain('REFERENCES projects(id)');
    expect(automationSql).toContain('REFERENCES users(id)');
  });

  it('uses billing_plan_tier enum in templates table', async () => {
    const sql = await readMigrationSql(
      '19_automation/010_automation_templates.sql',
      DRAFT_MIGRATIONS_DIR,
    );

    expect(sql).toContain('billing_plan_tier');
  });

  it('applies updated_at triggers using existing set_updated_at helper', async () => {
    const files = await listMigrationFiles(DRAFT_MIGRATIONS_DIR);
    const automationSql = (await Promise.all(
      files
        .filter((f) => f.startsWith('19_automation/'))
        .map((f) => readMigrationSql(f, DRAFT_MIGRATIONS_DIR)),
    )).join('\n');

    // Tables that have updated_at and should have triggers
    const tablesWithUpdatedAt = [
      'automation_workflows',
      'automation_triggers',
      'automation_conditions',
      'automation_actions',
      'automation_runs',
      'automation_run_steps',
      'automation_approvals',
      'automation_templates',
    ];
    for (const table of tablesWithUpdatedAt) {
      expect(automationSql).toContain(`BEFORE UPDATE ON ${table}`);
      expect(automationSql).toContain(`EXECUTE FUNCTION set_updated_at()`);
    }
  });

  it('seeds exactly 20 platform templates with template versions', async () => {
    const sql = await readMigrationSql(
      '19_automation/015_automation_default_templates_seed.sql',
      DRAFT_MIGRATIONS_DIR,
    );

    const templateKeys = [
      'alert-route-by-service-severity',
      'escalate-unresolved-critical-alert',
      'create-incident-for-critical-alert',
      'append-incident-timeline-from-alert',
      'generate-postmortem-draft',
      'release-health-guard',
      'rollback-recommendation-with-approval',
      'deduplicate-noisy-alerts',
      'silence-known-maintenance-window',
      'open-runbook-for-critical-service',
      'retry-connector-dead-letter',
      'retry-ingestion-dead-letter',
      'notify-quota-threshold',
      'ai-credit-usage-spike',
      'security-api-key-anomaly',
      'daily-service-health-report',
      'weekly-release-quality-report',
      'slo-burn-rate-incident',
      'cron-missed-job-escalation',
      'uptime-failure-status-page-draft',
    ];

    for (const key of templateKeys) {
      expect(sql).toContain(`'${key}'`);
    }

    // Each template has a version insert
    const versionInserts = sql.match(/INSERT INTO automation_template_versions/g);
    expect(versionInserts).toHaveLength(20);
  });

  it('seeds templates idempotently with ON CONFLICT', async () => {
    const sql = await readMigrationSql(
      '19_automation/015_automation_default_templates_seed.sql',
      DRAFT_MIGRATIONS_DIR,
    );

    const templateConflicts = sql.match(/ON CONFLICT.*template_key/g);
    expect(templateConflicts).toHaveLength(20);

    const versionConflicts = sql.match(/ON CONFLICT \(template_id, version\) DO NOTHING/g);
    expect(versionConflicts).toHaveLength(20);
  });

  it('seeds templates with correct required_feature_key from billing seed', async () => {
    const sql = await readMigrationSql(
      '19_automation/015_automation_default_templates_seed.sql',
      DRAFT_MIGRATIONS_DIR,
    );

    const expectedFeatureKeys = [
      'module_alerting_features_multi_channel',
      'module_alerting_features_escalation_policies',
      'module_incident_management_enabled',
      'module_incident_management_features_timelines',
      'module_incident_management_features_postmortems',
      'module_version_management_features_release_gates',
      'module_alerting_features_deduplication',
      'module_alerting_features_silencing',
      'module_connectors_enabled',
      'module_automation_enabled',
      'module_billing_ops_cost_alerts',
      'module_ai_insights_enabled',
      'module_cron_monitoring_enabled',
      'module_uptime_monitoring_enabled',
    ];

    for (const key of expectedFeatureKeys) {
      expect(sql).toContain(key);
    }
  });

  it('seeds templates with schemaVersion 1 definition JSON containing trigger, conditions, actions, safety', async () => {
    const sql = await readMigrationSql(
      '19_automation/015_automation_default_templates_seed.sql',
      DRAFT_MIGRATIONS_DIR,
    );

    // Parse first template definition to validate structure
    const defMatch = sql.match(/'(\{"schemaVersion":1,"workflowType":"alert_routing"[^']+)'/);
    expect(defMatch).not.toBeNull();
    const definition = JSON.parse(defMatch![1]);
    expect(definition.schemaVersion).toBe(1);
    expect(definition.trigger).toBeDefined();
    expect(definition.trigger.kind).toBeDefined();
    expect(definition.trigger.type).toBeDefined();
    expect(definition.trigger.sourceModule).toBeDefined();
    expect(definition.conditions).toBeInstanceOf(Array);
    expect(definition.actions).toBeInstanceOf(Array);
    expect(definition.actions[0].actionKey).toBeDefined();
    expect(definition.actions[0].actionType).toBeDefined();
    expect(definition.actions[0].riskLevel).toBeDefined();
    expect(definition.safety).toBeDefined();
    expect(definition.safety.maxRunsPerHour).toBeGreaterThan(0);
    expect(definition.safety.dedupeWindowSeconds).toBeGreaterThanOrEqual(0);
  });

  it('does not seed sample organizations or active customer workflows', async () => {
    const sql = await readMigrationSql(
      '19_automation/015_automation_default_templates_seed.sql',
      DRAFT_MIGRATIONS_DIR,
    );

    expect(sql).not.toContain('INSERT INTO organizations');
    expect(sql).not.toContain('INSERT INTO automation_workflows');
    expect(sql).not.toContain('INSERT INTO automation_runs');
  });

  it('every automation SQL file wraps in explicit BEGIN/COMMIT transaction', async () => {
    const files = await listMigrationFiles(DRAFT_MIGRATIONS_DIR);
    const automationFiles = files.filter((f) => f.startsWith('19_automation/'));

    for (const file of automationFiles) {
      const sql = await readMigrationSql(file, DRAFT_MIGRATIONS_DIR);
      const normalized = sql.trim().toUpperCase();
      expect(normalized.startsWith('BEGIN;') || normalized.startsWith('--')).toBe(true);
      expect(normalized).toContain('COMMIT;');
    }
  });

  it('includes constraint checks for workflow scope, version positivity, and approval integrity', async () => {
    const files = await listMigrationFiles(DRAFT_MIGRATIONS_DIR);
    const automationSql = (await Promise.all(
      files
        .filter((f) => f.startsWith('19_automation/'))
        .map((f) => readMigrationSql(f, DRAFT_MIGRATIONS_DIR)),
    )).join('\n');

    // Workflow scope constraints
    expect(automationSql).toContain('chk_workflows_org_scope');
    expect(automationSql).toContain('chk_workflows_current_version');

    // Trigger constraints
    expect(automationSql).toContain('chk_trigger_schedule_cron');
    expect(automationSql).toContain('chk_trigger_event_source');
    expect(automationSql).toContain('chk_trigger_cooldown_nonneg');

    // Action constraints
    expect(automationSql).toContain('chk_action_timeout_positive');
    expect(automationSql).toContain('chk_action_max_attempts_positive');

    // Run constraints
    expect(automationSql).toContain('uq_automation_runs_idempotency');
    expect(automationSql).toContain('chk_runs_attempt_positive');

    // Approval constraints
    expect(automationSql).toContain('chk_approval_expires_after_created');
    expect(automationSql).toContain('chk_approval_approved');
    expect(automationSql).toContain('chk_approval_rejected');

    // Events inbox dedupe
    expect(automationSql).toContain('uq_events_inbox_dedupe');

    // Template version uniqueness
    expect(automationSql).toContain('uq_template_versions');
    expect(automationSql).toContain('uq_automation_tv_one_current');
  });
});


describe('API-key normalization migration', () => {
  it('declares the minimal credential, partitioned facts, views, and additive measures', async () => {
    const sql = await readMigrationSql(
      '04_projects/018_normalize_project_api_keys_and_usage.up.sql',
      DRAFT_MIGRATIONS_DIR,
    );
    expect(sql.trim().toUpperCase().startsWith('BEGIN;')).toBe(true);
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS project_api_key_rotations');
    expect(sql).toContain('CREATE TABLE api_key_usage_minute');
    expect(sql).toContain('CREATE TABLE api_key_usage_daily');
    expect(sql).toContain('PARTITION BY RANGE(bucket)');
    expect(sql).toContain('CREATE VIEW api_key_usage_hourly');
    expect(sql).toContain('CREATE VIEW api_key_usage_monthly');
    expect(sql).toContain('CREATE TABLE telemetry_event_types');
    expect(sql).toContain('event_type_id SMALLINT');
    expect(sql).toContain('enforce_api_key_usage_tenant_dimensions');
    expect(sql).toContain('ON CONFLICT(api_key_id,bucket,event_type_id) DO UPDATE SET');
    for (const measure of [
      'request_count', 'accepted_event_count', 'error_event_count',
      'ingestion_failure_count', 'accepted_bytes', 'rate_limited_request_count',
    ]) {
      expect(sql).toContain(measure);
    }
    const keepList = sql.match(/column_name <> ALL\(ARRAY\[([\s\S]*?)\]\)/)?.[1] ?? '';
    for (const column of [
      'id', 'organization_id', 'project_id', 'environment_id', 'name', 'public_key',
      'secret_hash', 'status', 'expires_at', 'last_used_at', 'created_by',
      'rotated_from_key_id', 'created_at', 'updated_at', 'deleted_at',
    ]) {
      expect(keepList).toContain(`'${column}'`);
    }
    for (const obsolete of [
      'key_type', 'description', 'is_active', 'revoked_at', 'revoked_by',
      'revoked_reason', 'auto_rotate_enabled', 'usage_count', 'metadata', 'version',
    ]) {
      expect(keepList).not.toContain(`'${obsolete}'`);
    }
    expect(sql).toContain("ARRAY['project_usage_minute','project_usage_hourly','project_usage_daily']");
    expect(sql).toContain('DROP COLUMN IF EXISTS latency_ms_p99');
  });
});
