import { describe, expect, it } from 'vitest';

import { listMigrationFiles } from '../../scripts/lib/migrations.js';

describe('canonical_migrations_draft discovery', () => {
  it('lists the draft domain-based chain in lexicographic relative order', async () => {
    const root = 'C:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/db/postgres/canonical_migrations_draft';
    const files = await listMigrationFiles(root);

    expect(files[0]).toBe('00_shared/001_enable_pgcrypto.up.sql');
    expect(files).toContain('03_org_identity/001_create_organization_sso_providers.up.sql');
    expect(files).toContain('04_projects/002_create_project_members.up.sql');
    expect(files).toContain('05_project_credentials/001_create_project_api_keys.up.sql');
    expect(files).toContain('06_connectors/003_create_connector_configs.up.sql');
    expect(files).toContain('07_notifications/004_create_notification_deliveries.up.sql');
    expect(files).toContain('08_alerting/005_create_alert_events.up.sql');
    expect(files).toContain('09_audit/002_enhance_audit_logs.up.sql');
    expect(files).toContain('10_security/001_harden_organization_security_indexes.up.sql');
    expect(files).toContain('11_billing/009_create_coupon_redemptions.up.sql');
    expect(files).toContain('12_monitoring/001_create_backpressure_gauge.up.sql');
    expect(files).toContain('13_ingestion/009_create_project_usage_realtime_view.up.sql');
    expect(files).toContain('14_observability/006_create_timescaledb_setup_shim.up.sql');
    expect(files).toContain('15_analytics/002_create_project_usage_hourly_and_daily.up.sql');
    expect(files).toContain('15_analytics/006_create_analytics_config_tables.up.sql');
    expect(files).toContain('16_legacy_compat/003_create_legacy_failure_tables.up.sql');
    expect(files[files.length - 1]).toBe('16_legacy_compat/003_create_legacy_failure_tables.up.sql');
  });
});
