import { describe, expect, it } from 'vitest';

import {
  DRAFT_MIGRATIONS_DIR,
  listMigrationFiles,
  readMigrationSql,
} from '../../scripts/lib/migrations.js';

describe('canonical_migrations_draft discovery', () => {
  it('lists the draft domain-based chain in lexicographic relative order', async () => {
    const files = await listMigrationFiles(DRAFT_MIGRATIONS_DIR);

    expect(files[0]).toBe('00_shared/001_enable_pgcrypto.up.sql');
    expect(files).toContain('03_org_identity/001_create_organization_sso_providers.up.sql');
    expect(files).toContain('04_projects/002_create_project_members.up.sql');
    expect(files).toContain('05_project_credentials/001_create_project_api_keys.up.sql');
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
    expect(files).toContain('15_analytics/002_create_project_usage_hourly_and_daily.up.sql');
    expect(files).toContain('15_analytics/006_create_analytics_config_tables.up.sql');
    expect(files).toContain('16_legacy_compat/003_create_legacy_failure_tables.up.sql');
    expect(files[files.length - 1]).toBe('16_legacy_compat/003_create_legacy_failure_tables.up.sql');
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
