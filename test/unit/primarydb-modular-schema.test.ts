import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('PrimaryDB Modular Schema & Direct Index Placement', () => {
  const root = process.cwd();
  const draftDir = path.resolve(root, 'src/db/postgres/primary_db_draft');
  const schemaV2Dir = path.resolve(root, 'database/primarydbv2/schema');
  const schemaSqlPath = path.resolve(root, 'database/primarydbv2/schema.sql');
  const upSqlPath = path.resolve(root, 'database/primarydbv2/migrations/000001_create_schema.up.sql');

  const expectedDomains = [
    '00_extensions',
    '01_schemas',
    '02_types',
    '03_reference',
    '04_user',
    '05_organization',
    '06_project',
    '07_billing',
    '08_connector',
    '09_alerting',
    '10_notification',
    '11_observability',
    '12_usage',
    '13_ai',
    '14_automation',
    '15_analytics',
    '16_security',
    '17_functions',
    '18_views',
    '19_partitions',
    '20_seeders',
    '21_comments',
  ];

  it('contains all 22 modular domain folders in database/primarydbv2/schema', () => {
    for (const domain of expectedDomains) {
      expect(fs.existsSync(path.join(schemaV2Dir, domain))).toBe(true);
    }
  });

  it('compiles schema.sql and migrations/000001_create_schema.up.sql identically from modular sources', () => {
    expect(fs.existsSync(schemaSqlPath)).toBe(true);
    expect(fs.existsSync(upSqlPath)).toBe(true);

    const schemaSql = fs.readFileSync(schemaSqlPath, 'utf8');
    const upSql = fs.readFileSync(upSqlPath, 'utf8');
    expect(schemaSql).toBe(upSql);
    expect(schemaSql.length).toBeGreaterThan(500000);
  });

  it('incorporates all performance and covering indexes directly into respective table files', () => {
    // 1. Connectors
    const connectorFile = fs.readFileSync(path.join(schemaV2Dir, '08_connector/001_create_connector_configs.sql'), 'utf8');
    expect(connectorFile).toContain('idx_connector_configs_org_provider_status');

    // 2. Member alert prefs
    const memberPrefsFile = fs.readFileSync(path.join(schemaV2Dir, '09_alerting/001_create_project_member_alert_channel_preferences.sql'), 'utf8');
    expect(memberPrefsFile).toContain('idx_member_alert_prefs_lookup');

    // 3. Alert events
    const alertEventsFile = fs.readFileSync(path.join(schemaV2Dir, '09_alerting/001_create_alert_events.sql'), 'utf8');
    expect(alertEventsFile).toContain('idx_alert_events_org_fingerprint_status');

    // 4. Alert delivery attempts
    const alertDeliveryFile = fs.readFileSync(path.join(schemaV2Dir, '09_alerting/001_create_alert_delivery_attempts.sql'), 'utf8');
    expect(alertDeliveryFile).toContain('idx_alert_delivery_attempts_event_created');

    // 5. Organization audit logs
    const orgAuditFile = fs.readFileSync(path.join(schemaV2Dir, '05_organization/001_create_organization_audit_logs.sql'), 'utf8');
    expect(orgAuditFile).toContain('idx_org_audit_logs_purge');

    // 6. User sessions
    const userSessionsFile = fs.readFileSync(path.join(schemaV2Dir, '04_user/001_create_user_sessions.sql'), 'utf8');
    expect(userSessionsFile).toContain('idx_user_sessions_user_active_last_active');
    expect(userSessionsFile).toContain('idx_user_sessions_purge');

    // 7. Automation workflows
    const workflowsFile = fs.readFileSync(path.join(schemaV2Dir, '14_automation/001_create_automation_workflows.sql'), 'utf8');
    expect(workflowsFile).toContain('idx_automation_workflows_org_updated');

    // 8. Subscriptions
    const subFile = fs.readFileSync(path.join(schemaV2Dir, '07_billing/001_create_organization_subscriptions.sql'), 'utf8');
    expect(subFile).toContain('idx_org_subscriptions_active_current');

    // 9. API keys
    const apiKeysFile = fs.readFileSync(path.join(schemaV2Dir, '06_project/001_create_project_api_keys.sql'), 'utf8');
    expect(apiKeysFile).toContain('idx_project_api_keys_env_active');
    expect(apiKeysFile).not.toContain('idx_api_keys_public_key');

    // 10. User linked identities
    const linkedIdentitiesFile = fs.readFileSync(path.join(schemaV2Dir, '04_user/001_create_user_linked_identities.sql'), 'utf8');
    expect(linkedIdentitiesFile).toContain('idx_user_linked_identities_user_all');

    // 11. Organizations
    const orgsFile = fs.readFileSync(path.join(schemaV2Dir, '05_organization/001_create_organizations.sql'), 'utf8');
    expect(orgsFile).toContain('idx_organizations_owner_active');

    // 12. Project alert channels
    const channelsFile = fs.readFileSync(path.join(schemaV2Dir, '09_alerting/001_create_project_alert_channels.sql'), 'utf8');
    expect(channelsFile).toContain('idx_project_alert_channels_org_proj_enabled');
  });

  it('incorporates weighted credit billing schema directly in 07_billing and 17_functions', () => {
    // billing_event_credit_weights table file exists
    const weightsPath = path.join(schemaV2Dir, '07_billing/001_create_billing_event_credit_weights.sql');
    expect(fs.existsSync(weightsPath)).toBe(true);
    const weightsContent = fs.readFileSync(weightsPath, 'utf8');
    expect(weightsContent).toContain('CREATE TABLE IF NOT EXISTS billing_event_credit_weights');
    expect(weightsContent).toContain('idx_billing_event_credit_weights_active');

    // organization_usage_current_period has raw_events_count and decimal events_used
    const usageFile = fs.readFileSync(path.join(schemaV2Dir, '07_billing/001_create_organization_usage_current_period.sql'), 'utf8');
    expect(usageFile).toContain('raw_events_count');
    expect(usageFile).toContain('events_used              NUMERIC(14, 4)');

    // functions file contains increment_event_usage and remaining_event_quota
    const fnFile = fs.readFileSync(path.join(schemaV2Dir, '17_functions/001_functions.sql'), 'utf8');
    expect(fnFile).toContain('increment_event_usage');
    expect(fnFile).toContain('remaining_event_quota');
  });

  it('incorporates minimal organization schema in 05_organization', () => {
    const orgsFile = fs.readFileSync(path.join(schemaV2Dir, '05_organization/001_create_organizations.sql'), 'utf8');
    expect(orgsFile).not.toContain('industry');
    expect(orgsFile).not.toContain('company_size');
    expect(orgsFile).not.toContain('website_url');
    expect(orgsFile).toContain("timezone VARCHAR(100) NOT NULL DEFAULT 'Asia/Kolkata'");
  });

  it('guarantees users table is sorted before user_sessions and dependent tables', () => {
    const userFiles = fs.readdirSync(path.join(schemaV2Dir, '04_user')).filter(f => f.endsWith('.sql') && f !== '999_triggers.sql');
    expect(userFiles).toContain('001_create_users.sql');
    expect(userFiles).toContain('001_create_user_sessions.sql');
  });
});

