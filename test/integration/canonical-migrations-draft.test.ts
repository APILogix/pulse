import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';

import {
  applyMigrationSql,
  DRAFT_MIGRATIONS_DIR,
  listMigrationFiles,
  readMigrationSql,
} from '../../scripts/lib/migrations.js';

describe('canonical migrations draft bootstrap', () => {
  let container: PostgreSqlContainer | null = null;
  let client: Client | null = null;
  let runtimeUnavailableReason: string | null = null;

  beforeAll(async () => {
    try {
      container = await new PostgreSqlContainer('postgres:16-alpine').start();
      client = new Client({
        connectionString: container.getConnectionUri(),
      });
      await client.connect();
    } catch (err) {
      runtimeUnavailableReason =
        err instanceof Error ? err.message : String(err);
    }
  });

  afterAll(async () => {
    if (client) {
      await client.end();
      client = null;
    }
    if (container) {
      await container.stop();
      container = null;
    }
  });

  it('applies and verifies the enterprise project schema on a fresh database', async () => {
    if (!client) {
      console.warn(
        `Skipping draft bootstrap integration test: ${runtimeUnavailableReason ?? 'container runtime unavailable'}`,
      );
      return;
    }

    const files = await listMigrationFiles(DRAFT_MIGRATIONS_DIR);
    expect(files).toContain(
      '04_projects/015_create_environment_sdk_configuration.up.sql',
    );
    expect(files.some((file) => file.startsWith('20_project_module_refactor/'))).toBe(false);
    for (const filename of files) {
      const sql = await readMigrationSql(filename, DRAFT_MIGRATIONS_DIR);
      await applyMigrationSql(client, filename, sql);
    }

    const requiredTables = [
      'project_settings', 'project_environments', 'project_members', 'project_api_keys',
      'project_environment_sdk_configs', 'project_environment_sdk_config_revisions',
      'api_key_usage_minute', 'api_key_usage_hourly', 'api_key_usage_daily',
      'api_key_usage_monthly',
      'project_usage_minute', 'project_usage_hourly', 'project_usage_daily',
      'project_usage_monthly', 'project_usage_current', 'project_alert_thresholds', 'project_alert_channels',
      'project_member_alert_channel_preferences', 'project_notification_preferences',
      'project_connector_subscriptions', 'project_activity', 'project_audit_logs',
    ];
    const tableRows = await client.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema='public' AND table_name = ANY($1::text[])`,
      [requiredTables],
    );
    expect(tableRows.rows.map((row) => row.table_name).sort()).toEqual(
      [...requiredTables].sort(),
    );

    const columns = await client.query<{ table_name: string; columns: string[] }>(
      `SELECT table_name, array_agg(column_name ORDER BY ordinal_position) AS columns
       FROM information_schema.columns
       WHERE table_schema='public' AND table_name = ANY($1::text[])
       GROUP BY table_name`,
      [[...requiredTables, 'projects', 'connector_configs', 'usage_counter_staging', 'alert_delivery_attempts']],
    );
    const byTable = new Map(columns.rows.map((row) => [row.table_name, row.columns]));
    expect(byTable.get('projects')).not.toContain('default_environment');
    expect(byTable.get('connector_configs')).not.toContain('project_id');
    expect(byTable.get('project_api_keys')).toEqual(expect.arrayContaining([
      'organization_id', 'environment_id', 'public_key', 'secret_hash',
      'rotation_state', 'rotated_at', 'grace_period_ends_at', 'revoked_at', 'version',
    ]));
    expect(byTable.get('project_api_keys')).not.toEqual(expect.arrayContaining([
      'org_id', 'environment', 'key_hash', 'key_prefix',
    ]));
    expect(byTable.get('project_settings')).toEqual(expect.arrayContaining([
      'organization_id', 'data_retention_days', 'sampling_rate', 'allowed_domains',
      'pii_scrubbing_enabled', 'trace_ingestion_enabled', 'version',
    ]));
    expect(byTable.get('project_environments')).toEqual(expect.arrayContaining([
      'organization_id', 'slug', 'is_default', 'is_active', 'deleted_at', 'version',
      'rate_limit_per_second', 'rate_limit_per_minute', 'rate_limit_per_hour', 'burst_limit',
      'allowed_event_types', 'max_event_size_bytes', 'max_batch_size', 'require_https',
      'ip_allowlist', 'ip_blocklist', 'alert_email', 'alert_webhook_url',
    ]));
    expect(byTable.get('project_members')).toEqual([
      'id', 'project_id', 'user_id', 'organization_id', 'role', 'invited_by',
      'invited_at', 'joined_at', 'status', 'created_by', 'created_at', 'updated_at',
    ]);
    expect(byTable.get('project_environment_sdk_configs')).toEqual(expect.arrayContaining([
      'environment_id', 'published_revision_id', 'current_revision', 'current_hash', 'version',
    ]));
    expect(byTable.get('project_environment_sdk_config_revisions')).toEqual(expect.arrayContaining([
      'config_id', 'environment_id', 'revision_number', 'config_value', 'config_hash', 'published_at',
    ]));
    expect(byTable.get('project_alert_thresholds')).toEqual(expect.arrayContaining([
      'environment_id', 'threshold_key', 'comparison_operator', 'cooldown_minutes', 'version',
      'current_breaches', 'is_breaching', 'last_evaluated_at',
    ]));
    expect(byTable.get('project_alert_channels')).toEqual(expect.arrayContaining([
      'connector_id', 'channel_type', 'destination_metadata', 'is_default', 'version',
    ]));
    expect(byTable.get('alert_delivery_attempts')).toEqual(expect.arrayContaining([
      'project_alert_channel_id', 'recipient_user_id',
    ]));
    expect(byTable.get('project_connector_subscriptions')).toEqual(expect.arrayContaining([
      'connector_id', 'alert_categories', 'member_ids', 'channel_overrides', 'version',
    ]));
    for (const table of [
      'api_key_usage_minute', 'api_key_usage_hourly',
      'api_key_usage_daily', 'api_key_usage_monthly',
    ]) {
      expect(byTable.get(table)).toEqual(expect.arrayContaining(['bucket', 'events', 'version']));
      expect(byTable.get(table)).not.toContain('total_events');
    }
    for (const table of ['project_usage_minute', 'project_usage_hourly', 'project_usage_daily', 'project_usage_monthly']) {
      expect(byTable.get(table)).toEqual(expect.arrayContaining(['bucket', 'total_events', 'total_bytes', 'version']));
      expect(byTable.get(table)).not.toEqual(expect.arrayContaining(['bucket_hour', 'bucket_date', 'year_month', 'event_count']));
    }
    expect(byTable.get('usage_counter_staging')).toEqual(expect.arrayContaining([
      'api_key_id', 'event_type', 'counter_type', 'increment_by',
    ]));

    const user = await client.query<{ id: string }>(
      `INSERT INTO users(email,full_name,email_verified) VALUES('owner@example.test','Project Owner',true) RETURNING id`,
    );
    const userId = user.rows[0]!.id;
    const organization = await client.query<{ id: string }>(
      `INSERT INTO organizations(name,slug,owner_user_id,created_by,status)
       VALUES('Project Test Org','project-test-org',$1,$1,'active') RETURNING id`,
      [userId],
    );
    const organizationId = organization.rows[0]!.id;
    const project = await client.query<{ id: string }>(
      `INSERT INTO projects(org_id,name,slug,created_by)
       VALUES($1,'Enterprise Project','enterprise-project',$2) RETURNING id`,
      [organizationId, userId],
    );
    const projectId = project.rows[0]!.id;

    const provisioned = await client.query<{
      settings: number; environments: number; default_environments: number;
      config_heads: number; config_revisions: number; owners: number; current_usage: number; thresholds: number;
      notification_defaults: number; activities: number; audits: number;
    }>(
      `SELECT
        (SELECT count(*)::int FROM project_settings WHERE project_id=$1) settings,
        (SELECT count(*)::int FROM project_environments WHERE project_id=$1) environments,
        (SELECT count(*)::int FROM project_environments WHERE project_id=$1 AND is_default) default_environments,
        (SELECT count(*)::int FROM project_environment_sdk_configs WHERE project_id=$1) config_heads,
        (SELECT count(*)::int FROM project_environment_sdk_config_revisions WHERE project_id=$1) config_revisions,
        (SELECT count(*)::int FROM project_members WHERE project_id=$1 AND user_id=$2 AND role='owner' AND status='active') owners,
        (SELECT count(*)::int FROM project_usage_current WHERE project_id=$1) current_usage,
        (SELECT count(*)::int FROM project_alert_thresholds WHERE project_id=$1 AND deleted_at IS NULL) thresholds,
        (SELECT count(*)::int FROM project_notification_preferences WHERE project_id=$1 AND deleted_at IS NULL) notification_defaults,
        (SELECT count(*)::int FROM project_activity WHERE project_id=$1) activities,
        (SELECT count(*)::int FROM project_audit_logs WHERE project_id=$1) audits`,
      [projectId, userId],
    );
    expect(provisioned.rows[0]).toMatchObject({
      settings: 1, environments: 3, default_environments: 1,
      config_heads: 3, config_revisions: 3,
      owners: 1, current_usage: 1, thresholds: 13, notification_defaults: 1,
    });
    expect(provisioned.rows[0]!.activities).toBeGreaterThan(0);
    expect(provisioned.rows[0]!.audits).toBeGreaterThan(0);

    const defaultEnvironment = await client.query<{ id: string }>(
      `SELECT id FROM project_environments WHERE project_id=$1 AND is_default`,
      [projectId],
    );
    const apiKey = await client.query<{ id: string }>(
      `INSERT INTO project_api_keys(
         project_id,organization_id,environment_id,public_key,secret_hash,name,created_by
       ) VALUES($1,$2,$3,'pulsiv_prod_abcdefghijklmnop',$4,'Integration key',$5) RETURNING id`,
      [projectId, organizationId, defaultEnvironment.rows[0]!.id, 'a'.repeat(64), userId],
    );
    await expect(client.query(
      `INSERT INTO project_api_keys(
         project_id,organization_id,environment_id,public_key,secret_hash,name,created_by
       ) VALUES($1,$2,$3,'customer_prod_abcdefghijklmnop',$4,'Spoofed key',$5)`,
      [projectId, organizationId, defaultEnvironment.rows[0]!.id, 'b'.repeat(64), userId],
    )).rejects.toThrow();

    const outsider = await client.query<{ id: string }>(
      `INSERT INTO users(email,full_name,email_verified)
       VALUES('outsider@example.test','Project Outsider',true) RETURNING id`,
    );
    const outsiderId = outsider.rows[0]!.id;
    const otherOrganization = await client.query<{ id: string }>(
      `INSERT INTO organizations(name,slug,owner_user_id,created_by,status)
       VALUES('Other Org','other-project-org',$1,$1,'active') RETURNING id`,
      [outsiderId],
    );
    await expect(client.query(
      `INSERT INTO project_api_keys(
         project_id,organization_id,environment_id,public_key,secret_hash,name,created_by
       ) VALUES($1,$2,$3,'pulsiv_prod_crossorgkey123',$4,'Cross-tenant key',$5)`,
      [projectId, otherOrganization.rows[0]!.id, defaultEnvironment.rows[0]!.id, 'c'.repeat(64), outsiderId],
    )).rejects.toThrow(/tenant|foreign key/i);

    await client.query(
      `INSERT INTO usage_counter_staging(
         project_id,org_id,api_key_id,event_type,counter_type,increment_by,created_at
       ) VALUES
         ($1,$2,$3,'request','requests',2,NOW()-INTERVAL '10 seconds'),
         ($1,$2,$3,'request','events',3,NOW()-INTERVAL '10 seconds'),
         ($1,$2,$3,'request','bytes_ingested',512,NOW()-INTERVAL '10 seconds')`,
      [projectId, organizationId, apiKey.rows[0]!.id],
    );
    await client.query('SELECT flushed_count FROM flush_usage_counters()');
    await client.query('SELECT rollup_project_usage()');
    const usageRollup = await client.query<{
      project_minute_events: string; project_hourly_events: string; project_daily_events: string;
      project_monthly_events: string; api_minute_events: string; api_hourly_events: string;
      api_daily_events: string; api_monthly_events: string; bytes_ingested: string;
    }>(
      `SELECT
        (SELECT SUM(total_events)::text FROM project_usage_minute WHERE project_id=$1) project_minute_events,
        (SELECT SUM(total_events)::text FROM project_usage_hourly WHERE project_id=$1) project_hourly_events,
        (SELECT SUM(total_events)::text FROM project_usage_daily WHERE project_id=$1) project_daily_events,
        (SELECT SUM(total_events)::text FROM project_usage_monthly WHERE project_id=$1) project_monthly_events,
        (SELECT SUM(events)::text FROM api_key_usage_minute WHERE api_key_id=$2) api_minute_events,
        (SELECT SUM(events)::text FROM api_key_usage_hourly WHERE api_key_id=$2) api_hourly_events,
        (SELECT SUM(events)::text FROM api_key_usage_daily WHERE api_key_id=$2) api_daily_events,
        (SELECT SUM(events)::text FROM api_key_usage_monthly WHERE api_key_id=$2) api_monthly_events,
        (SELECT SUM(bytes_ingested)::text FROM api_key_usage_minute WHERE api_key_id=$2) bytes_ingested`,
      [projectId, apiKey.rows[0]!.id],
    );
    expect(usageRollup.rows[0]).toMatchObject({
      project_minute_events: '3', project_hourly_events: '3', project_daily_events: '3',
      project_monthly_events: '3', api_minute_events: '3', api_hourly_events: '3',
      api_daily_events: '3', api_monthly_events: '3', bytes_ingested: '512',
    });

    await client.query(
      `INSERT INTO project_api_keys(
         project_id,organization_id,environment_id,public_key,secret_hash,name,created_by,
         status,is_active,rotated_at,rotation_state,grace_period_ends_at
       ) VALUES($1,$2,$3,'pulsiv_prod_graceperiodkey123',$4,'Grace key',$5,
                'rotated',TRUE,NOW(),'grace_period',NOW()+INTERVAL '1 hour')`,
      [projectId, organizationId, defaultEnvironment.rows[0]!.id, 'd'.repeat(64), userId],
    );
    await client.query(
      `UPDATE project_api_keys SET status='rotated',is_active=FALSE,rotated_at=NOW(),
         rotation_state='completed',grace_period_ends_at=NULL WHERE id=$1`,
      [apiKey.rows[0]!.id],
    );
    await expect(client.query(
      `INSERT INTO project_api_keys(
         project_id,organization_id,environment_id,public_key,secret_hash,name,created_by,
         status,is_active,rotated_at,rotation_state
       ) VALUES($1,$2,$3,'pulsiv_prod_invalidcompleted123',$4,'Invalid lifecycle',$5,
                'rotated',TRUE,NOW(),'completed')`,
      [projectId, organizationId, defaultEnvironment.rows[0]!.id, 'e'.repeat(64), userId],
    )).rejects.toThrow();

    const channel = await client.query<{ id: string }>(
      `INSERT INTO project_alert_channels(
         organization_id,project_id,channel_type,name,destination,created_by
       ) VALUES($1,$2,'email','Owner email','owner@example.test',$3) RETURNING id`,
      [organizationId, projectId, userId],
    );
    await client.query(
      `INSERT INTO project_member_alert_channel_preferences(
         organization_id,project_id,user_id,project_alert_channel_id
       ) VALUES($1,$2,$3,$4)`,
      [organizationId, projectId, userId, channel.rows[0]!.id],
    );
    await expect(client.query(
      `INSERT INTO project_member_alert_channel_preferences(
         organization_id,project_id,user_id,project_alert_channel_id
       ) VALUES($1,$2,$3,$4)`,
      [organizationId, projectId, outsiderId, channel.rows[0]!.id],
    )).rejects.toThrow(/not an active project member/);

    const apdex = await client.query<{ comparison_operator: string; category: string }>(
      `SELECT comparison_operator,category FROM project_alert_thresholds
       WHERE project_id=$1 AND threshold_key='apdex'`,
      [projectId],
    );
    expect(apdex.rows[0]).toMatchObject({ comparison_operator: '<=', category: 'performance' });

    await client.query(`UPDATE projects SET description='audited change' WHERE id=$1`, [projectId]);
    const audit = await client.query<{ id: string }>(
      `SELECT id FROM project_audit_logs WHERE project_id=$1 AND action='project.updated' ORDER BY created_at DESC LIMIT 1`,
      [projectId],
    );
    expect(audit.rowCount).toBe(1);
    await expect(client.query(
      `UPDATE project_audit_logs SET metadata='{"tampered":true}'::jsonb WHERE id=$1`,
      [audit.rows[0]!.id],
    )).rejects.toThrow(/immutable/);
  });
});
