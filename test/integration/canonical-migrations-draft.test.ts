import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { compile, compileInitial } from '../../src/modules/projects/sdk-config/compiler.js';

import {
  applyMigrationSql,
  DRAFT_MIGRATIONS_DIR,
  listMigrationFiles,
  readMigrationSql,
} from '../../scripts/lib/migrations.js';

interface LegacySdkHistorySeed {
  headId: string;
  revisionIds: [string, string];
  projectId: string;
  environmentId: string;
}

async function seedLegacySdkHistory(client: Client): Promise<LegacySdkHistorySeed> {
  const user = await client.query<{ id: string }>(
    `INSERT INTO users(email,full_name,email_verified)
     VALUES('legacy-sdk-owner@example.test','Legacy SDK Owner',true) RETURNING id`,
  );
  const userId = user.rows[0]!.id;
  const organization = await client.query<{ id: string }>(
    `INSERT INTO organizations(name,slug,owner_user_id,created_by,status)
     VALUES('Legacy SDK Org','legacy-sdk-org',$1,$1,'active') RETURNING id`,
    [userId],
  );
  const organizationId = organization.rows[0]!.id;
  const project = await client.query<{ id: string }>(
    `INSERT INTO projects(org_id,name,slug,created_by)
     VALUES($1,'Legacy SDK Project','legacy-sdk-project',$2) RETURNING id`,
    [organizationId, userId],
  );
  const projectId = project.rows[0]!.id;

  let environment = await client.query<{ id: string }>(
    `SELECT id FROM project_environments
      WHERE project_id=$1 AND slug='production' AND deleted_at IS NULL LIMIT 1`,
    [projectId],
  );
  if (environment.rowCount === 0) {
    environment = await client.query<{ id: string }>(
      `INSERT INTO project_environments(
         project_id,organization_id,name,slug,type,description,color,is_default,is_active
       ) VALUES($1,$2,'Production','production','production','Legacy production','#16A34A',true,true)
       RETURNING id`,
      [projectId, organizationId],
    );
  }
  const environmentId = environment.rows[0]!.id;

  // Recreate only the old input shape that migration 019 is explicitly meant
  // to bridge. The final chain must remove this column again.
  await client.query(
    `ALTER TABLE project_environment_sdk_config_revisions
       ADD COLUMN config_value JSONB,
       ALTER COLUMN compiled_snapshot DROP NOT NULL`,
  );

  const headId = randomUUID();
  const revisionOneId = randomUUID();
  const revisionTwoId = randomUUID();
  const placeholderHash = '0'.repeat(64);
  const validLegacy = {
    features: { tracing: false },
    instrumentation: { http: { enabled: false } },
    privacy: { pii: { maskPhoneNumbers: false } },
    limits: { maxMemoryMb: 512 },
    transport: { connections: { total: 25 } },
    runtime: { configTtlSeconds: 600 },
  };
  const invalidLegacy = {
    features: { tracing: false },
    limits: { maxMemoryMb: 'automatic' },
  };

  await client.query('BEGIN');
  try {
    await client.query(
      `INSERT INTO project_environment_sdk_configs(
         id,organization_id,project_id,environment_id,published_revision_id,
         current_revision,current_hash,schema_version,created_by,updated_by
       ) VALUES($1,$2,$3,$4,$5,2,$6,'legacy',$7,$7)`,
      [headId, organizationId, projectId, environmentId, revisionTwoId, placeholderHash, userId],
    );
    await client.query(
      `INSERT INTO project_environment_sdk_config_revisions(
         id,config_id,organization_id,project_id,environment_id,revision_number,
         requested_config,compiled_snapshot,config_value,config_hash,schema_version,
         change_type,published_by,published_at
       ) VALUES
         ($1,$3,$4,$5,$6,1,'{}'::jsonb,NULL,$7::jsonb,$9,'legacy','initial',$10,'2025-01-01T00:00:00.000Z'),
         ($2,$3,$4,$5,$6,2,'{}'::jsonb,NULL,$8::jsonb,$9,'legacy','publish',$10,'2025-01-01T00:00:00.001Z')`,
      [
        revisionOneId,
        revisionTwoId,
        headId,
        organizationId,
        projectId,
        environmentId,
        JSON.stringify(validLegacy),
        JSON.stringify(invalidLegacy),
        placeholderHash,
        userId,
      ],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }

  return {
    headId,
    revisionIds: [revisionOneId, revisionTwoId],
    projectId,
    environmentId,
  };
}


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
    let legacySdkHistory: LegacySdkHistorySeed | null = null;
    for (const filename of files) {
      if (filename === '04_projects/019_upgrade_environment_sdk_config_snapshot.up.sql') {
        legacySdkHistory = await seedLegacySdkHistory(client);
      }
      const sql = await readMigrationSql(filename, DRAFT_MIGRATIONS_DIR);
      await applyMigrationSql(client, filename, sql);
    }
    if (!legacySdkHistory) {
      throw new Error('Legacy SDK history was not seeded before migration 019');
    }

    const requiredTables = [
      'project_settings', 'project_environments', 'project_members', 'project_api_keys',
      'project_api_key_rotations', 'telemetry_event_types',
      'project_environment_sdk_configs', 'project_environment_sdk_config_revisions',
      'api_key_usage_minute', 'api_key_usage_daily',
      'project_usage_minute', 'project_usage_hourly', 'project_usage_daily',
      'project_usage_monthly', 'project_usage_current', 'project_alert_thresholds', 'project_alert_channels',
      'project_member_alert_channel_preferences', 'project_notification_preferences',
      'project_connector_subscriptions', 'organization_audit_logs',
    ];
    const tableRows = await client.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema='public' AND table_name = ANY($1::text[])`,
      [requiredTables],
    );
    expect(tableRows.rows.map((row) => row.table_name).sort()).toEqual(
      [...requiredTables].sort(),
    );
    const removedHistoryTables = await client.query<{ project_activity: string | null; project_audit_logs: string | null }>(
      `SELECT to_regclass('public.project_activity')::text AS project_activity,
              to_regclass('public.project_audit_logs')::text AS project_audit_logs`,
    );
    expect(removedHistoryTables.rows[0]).toEqual({ project_activity: null, project_audit_logs: null });
    const auditProjectColumn = await client.query(
      `SELECT 1 FROM information_schema.columns
       WHERE table_schema='public' AND table_name='organization_audit_logs' AND column_name='project_id'`,
    );
    expect(auditProjectColumn.rowCount).toBe(1);
    const usageViews = await client.query<{ table_name: string; is_insertable_into: string }>(
      `SELECT table_name,is_insertable_into FROM information_schema.views
       WHERE table_schema='public' AND table_name IN ('api_key_usage_hourly','api_key_usage_monthly')
       ORDER BY table_name`,
    );
    expect(usageViews.rows).toEqual([
      { table_name: 'api_key_usage_hourly', is_insertable_into: 'NO' },
      { table_name: 'api_key_usage_monthly', is_insertable_into: 'NO' },
    ]);

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
    expect(byTable.get('project_api_keys')?.slice().sort()).toEqual([
      'id', 'organization_id', 'project_id', 'environment_id', 'name', 'public_key',
      'secret_hash', 'status', 'expires_at', 'last_used_at', 'created_by',
      'rotated_from_key_id', 'created_at', 'updated_at', 'deleted_at',
    ].sort());
    expect(byTable.get('project_api_key_rotations')).toEqual(expect.arrayContaining([
      'organization_id', 'project_id', 'environment_id', 'old_key_id', 'new_key_id',
      'state', 'reason', 'initiated_by', 'initiated_at', 'grace_ends_at', 'completed_at',
    ]));
    expect(byTable.get('project_settings')).toEqual(expect.arrayContaining([
      'organization_id', 'data_retention_days', 'sampling_rate', 'allowed_domains',
      'pii_scrubbing_enabled', 'trace_ingestion_enabled', 'version',
    ]));
    expect(byTable.get('project_environments')).toEqual(expect.arrayContaining([
      'organization_id', 'slug', 'type', 'description', 'color', 'is_default',
      'is_active', 'created_at', 'updated_at', 'deleted_at',
    ]));
    expect(byTable.get('project_environments')).not.toEqual(expect.arrayContaining([
      'icon', 'created_by_user_id', 'created_by_api_key_id', 'version',
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
      'config_id', 'environment_id', 'revision_number', 'requested_config',
      'compiled_snapshot', 'config_hash', 'published_at',
    ]));
    expect(byTable.get('project_environment_sdk_config_revisions')).not.toContain('config_value');
    expect(byTable.get('project_alert_thresholds')).toEqual(expect.arrayContaining([
      'environment_id', 'threshold_key', 'comparison_operator', 'cooldown_minutes', 'version',
      'current_breaches', 'is_breaching', 'last_evaluated_at',
    ]));
    expect(byTable.get('project_alert_channels')).toEqual(expect.arrayContaining([
      'connector_id', 'channel_type', 'destination_metadata', 'is_default', 'version',
    ]));

    const migratedHistory = await client.query<{
      id: string;
      revision_number: number;
      requested_config: Record<string, unknown>;
      compiled_snapshot: Record<string, unknown>;
      config_hash: string;
      calculated_hash: string;
    }>(
      `SELECT id,revision_number,requested_config,compiled_snapshot,config_hash,
              pulse_sdk_hash(compiled_snapshot) AS calculated_hash
         FROM project_environment_sdk_config_revisions
        WHERE config_id=$1
        ORDER BY revision_number`,
      [legacySdkHistory.headId],
    );
    expect(migratedHistory.rows.map((row) => row.id)).toEqual(legacySdkHistory.revisionIds);
    expect(migratedHistory.rows.map((row) => row.revision_number)).toEqual([1, 2]);
    expect(migratedHistory.rows[0]!.requested_config).toMatchObject({
      features: { tracing: false },
      instrumentation: { http: false },
      privacy: { piiDetection: { maskPhones: false } },
      limits: { maxMemoryMb: 512 },
      transport: { connections: { maxTotalConnections: 25 } },
      runtime: { configTtlSeconds: 600 },
    });
    expect(migratedHistory.rows[0]!.compiled_snapshot).toMatchObject({
      schemaVersion: 1,
      sdk: { projectId: legacySdkHistory.projectId, environment: 'production', release: '1.0.0' },
      features: { tracing: false },
      instrumentation: { http: false },
      privacy: { piiDetection: { maskPhones: false } },
      limits: { maxMemoryMb: 512 },
      transport: { connections: { maxTotalConnections: 25 } },
      runtime: { configTtlSeconds: 600 },
      meta: { generatedAt: '2025-01-01T00:00:00.000Z' },
    });
    // The second legacy row contains an invalid maxMemoryMb alias. Migration
    // 025 must regenerate a valid default rather than preserve corrupt intent.
    expect(migratedHistory.rows[1]!.requested_config).toEqual({});
    expect(migratedHistory.rows[1]!.compiled_snapshot).toMatchObject({
      schemaVersion: 1,
      sdk: { projectId: legacySdkHistory.projectId, environment: 'production', release: '1.0.0' },
      features: { tracing: true },
      limits: { maxMemoryMb: 'auto' },
      meta: { generatedAt: '2025-01-01T00:00:00.001Z' },
    });
    for (const row of migratedHistory.rows) {
      expect(row.config_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(row.config_hash).toBe(row.calculated_hash);
    }
    const migratedHead = await client.query<{
      current_revision: number;
      current_hash: string;
      published_revision_id: string;
    }>(
      `SELECT current_revision,current_hash,published_revision_id
         FROM project_environment_sdk_configs WHERE id=$1`,
      [legacySdkHistory.headId],
    );
    expect(migratedHead.rows[0]).toEqual({
      current_revision: 2,
      current_hash: migratedHistory.rows[1]!.config_hash,
      published_revision_id: legacySdkHistory.revisionIds[1],
    });

    expect(byTable.get('alert_delivery_attempts')).toEqual(expect.arrayContaining([
      'project_alert_channel_id', 'recipient_user_id',
    ]));
    expect(byTable.get('project_connector_subscriptions')).toEqual(expect.arrayContaining([
      'connector_id', 'alert_categories', 'member_ids', 'channel_overrides', 'version',
    ]));
    for (const table of ['api_key_usage_minute', 'api_key_usage_daily']) {
      expect(byTable.get(table)).toEqual(expect.arrayContaining([
        'bucket', 'event_type_id', 'request_count', 'accepted_event_count',
        'error_event_count', 'ingestion_failure_count', 'accepted_bytes',
        'rate_limited_request_count',
      ]));
      expect(byTable.get(table)).not.toEqual(expect.arrayContaining([
        'event_type', 'events', 'requests', 'errors', 'bytes_ingested', 'rate_limited',
        'latency_ms_p50', 'latency_ms_p95', 'latency_ms_p99', 'version',
      ]));
    }
    for (const table of ['project_usage_minute', 'project_usage_hourly', 'project_usage_daily']) {
      expect(byTable.get(table)).not.toEqual(expect.arrayContaining([
        'latency_ms_p50', 'latency_ms_p75', 'latency_ms_p90', 'latency_ms_p95', 'latency_ms_p99',
      ]));
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

    const databaseProvisioned = await client.query<{
      settings: number; environments: number; config_heads: number;
      config_revisions: number; owners: number; current_usage: number;
    }>(
      `SELECT
        (SELECT count(*)::int FROM project_settings WHERE project_id=$1) settings,
        (SELECT count(*)::int FROM project_environments WHERE project_id=$1) environments,
        (SELECT count(*)::int FROM project_environment_sdk_configs WHERE project_id=$1) config_heads,
        (SELECT count(*)::int FROM project_environment_sdk_config_revisions WHERE project_id=$1) config_revisions,
        (SELECT count(*)::int FROM project_members WHERE project_id=$1) owners,
        (SELECT count(*)::int FROM project_usage_current WHERE project_id=$1) current_usage`,
      [projectId],
    );
    expect(databaseProvisioned.rows[0]).toEqual({
      settings: 0,
      environments: 0,
      config_heads: 0,
      config_revisions: 0,
      owners: 0,
      current_usage: 0,
    });

    // Mirror the application transaction: identity rows are created explicitly,
    // and the sole TypeScript compiler supplies revision 1. No SQL generator or
    // environment trigger is allowed to synthesize a second document.
    await client.query(
      `INSERT INTO project_members(project_id,user_id,organization_id,role,status,created_by)
       VALUES($1,$2,$3,'owner','active',$2)`,
      [projectId, userId, organizationId],
    );
    const defaultEnvironment = await client.query<{ id: string }>(
      `INSERT INTO project_environments(
         project_id,organization_id,name,slug,type,description,color,is_default,is_active
       ) VALUES($1,$2,'Production','production','production','Production telemetry','#16A34A',true,true)
       RETURNING id`,
      [projectId, organizationId],
    );
    const environmentId = defaultEnvironment.rows[0]!.id;
    const compiled = compileInitial(
      { projectId, environment: 'production' },
      { ingestBaseUrl: 'https://ingest.pulse.test' },
      '2026-01-01T00:00:00.000Z',
    );
    const headId = randomUUID();
    const revisionId = randomUUID();
    await client.query('BEGIN');
    try {
      await client.query(
        `INSERT INTO project_environment_sdk_configs(
           id,organization_id,project_id,environment_id,published_revision_id,
           current_revision,current_hash,schema_version,created_by,updated_by
         ) VALUES($1,$2,$3,$4,$5,1,$6,'1',$7,$7)`,
        [headId, organizationId, projectId, environmentId, revisionId, compiled.meta.configHash, userId],
      );
      await client.query(
        `INSERT INTO project_environment_sdk_config_revisions(
           id,config_id,organization_id,project_id,environment_id,revision_number,
           requested_config,compiled_snapshot,config_hash,schema_version,change_type,published_by
         ) VALUES($1,$2,$3,$4,$5,1,'{}'::jsonb,$6::jsonb,$7,'1','initial',$8)`,
        [revisionId, headId, organizationId, projectId, environmentId,
         JSON.stringify(compiled), compiled.meta.configHash, userId],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }

    const persistedConfig = await client.query<{
      requested_config: Record<string, unknown>;
      compiled_snapshot: Record<string, unknown>;
      config_hash: string;
      calculated_hash: string;
    }>(
      `SELECT requested_config,compiled_snapshot,config_hash,
              pulse_sdk_hash(compiled_snapshot) AS calculated_hash
         FROM project_environment_sdk_config_revisions
        WHERE id=$1`,
      [revisionId],
    );
    expect(persistedConfig.rows[0]).toEqual({
      requested_config: {},
      compiled_snapshot: compiled,
      config_hash: compiled.meta.configHash,
      calculated_hash: compiled.meta.configHash,
    });

    const edgeConfig = compile({
      identity: { projectId, environment: 'production' },
      topology: { ingestBaseUrl: 'https://ingest.pulse.test' },
      requestedIntent: {
        sampling: {
          traces: 1e-7,
          routes: {
            '/\uE000': { traces: 0.25 },
            '/😀': { traces: 0.5 },
          },
        },
        limits: { maxMemoryMb: 512 },
      },
      generatedAt: '2026-01-01T00:00:00.001Z',
    });
    const edgeHash = await client.query<{ calculated_hash: string; valid: boolean }>(
      `SELECT pulse_sdk_hash($1::jsonb) AS calculated_hash,
              pulse_sdk_config_valid($1::jsonb) AS valid`,
      [JSON.stringify(edgeConfig)],
    );
    expect(edgeHash.rows[0]).toEqual({
      calculated_hash: edgeConfig.meta.configHash,
      valid: true,
    });

    const removedRuntimeGenerators = await client.query<{
      provisioner: string | null;
      compiler: string | null;
    }>(
      `SELECT to_regprocedure('provision_environment_sdk_config()')::text AS provisioner,
              to_regprocedure('pulse_build_sdk_config(uuid,text,text,jsonb)')::text AS compiler`,
    );
    expect(removedRuntimeGenerators.rows[0]).toEqual({ provisioner: null, compiler: null });

    const apiKey = await client.query<{ id: string }>(
      `INSERT INTO project_api_keys(
         project_id,organization_id,environment_id,public_key,secret_hash,name,created_by
       ) VALUES($1,$2,$3,'pulsiv_prod_abcdefghijklmnop',$4,'Integration key',$5) RETURNING id`,
      [projectId, organizationId, environmentId, 'a'.repeat(64), userId],
    );
    await expect(client.query(
      `INSERT INTO project_api_keys(
         project_id,organization_id,environment_id,public_key,secret_hash,name,created_by
       ) VALUES($1,$2,$3,'customer_prod_abcdefghijklmnop',$4,'Spoofed key',$5)`,
      [projectId, organizationId, environmentId, 'b'.repeat(64), userId],
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
      [projectId, otherOrganization.rows[0]!.id, environmentId, 'c'.repeat(64), outsiderId],
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
      api_daily_events: string; api_monthly_events: string; accepted_bytes: string;
    }>(
      `SELECT
        (SELECT SUM(total_events)::text FROM project_usage_minute WHERE project_id=$1) project_minute_events,
        (SELECT SUM(total_events)::text FROM project_usage_hourly WHERE project_id=$1) project_hourly_events,
        (SELECT SUM(total_events)::text FROM project_usage_daily WHERE project_id=$1) project_daily_events,
        (SELECT SUM(total_events)::text FROM project_usage_monthly WHERE project_id=$1) project_monthly_events,
        (SELECT SUM(accepted_event_count)::text FROM api_key_usage_minute WHERE api_key_id=$2) api_minute_events,
        (SELECT SUM(accepted_event_count)::text FROM api_key_usage_hourly WHERE api_key_id=$2) api_hourly_events,
        (SELECT SUM(accepted_event_count)::text FROM api_key_usage_daily WHERE api_key_id=$2) api_daily_events,
        (SELECT SUM(accepted_event_count)::text FROM api_key_usage_monthly WHERE api_key_id=$2) api_monthly_events,
        (SELECT SUM(accepted_bytes)::text FROM api_key_usage_minute WHERE api_key_id=$2) accepted_bytes`,
      [projectId, apiKey.rows[0]!.id],
    );
    expect(usageRollup.rows[0]).toMatchObject({
      project_minute_events: '3', project_hourly_events: '3', project_daily_events: '3',
      project_monthly_events: '3', api_minute_events: '3', api_hourly_events: '3',
      api_daily_events: '3', api_monthly_events: '3', accepted_bytes: '512',
    });

    const rotatedKey = await client.query<{ id: string }>(
      `INSERT INTO project_api_keys(
         project_id,organization_id,environment_id,public_key,secret_hash,name,created_by,rotated_from_key_id
       ) VALUES($1,$2,$3,'pulsiv_prod_rotatedkey12345',$4,'Rotated key',$5,$6) RETURNING id`,
      [projectId, organizationId, environmentId, 'd'.repeat(64), userId, apiKey.rows[0]!.id],
    );
    await client.query(`UPDATE project_api_keys SET status='rotated' WHERE id=$1`, [apiKey.rows[0]!.id]);
    await client.query(
      `INSERT INTO project_api_key_rotations(
         organization_id,project_id,environment_id,old_key_id,new_key_id,state,reason,
         initiated_by,initiated_at,completed_at
       ) VALUES($1,$2,$3,$4,$5,'completed','routine rotation',$6,NOW(),NOW())`,
      [organizationId, projectId, environmentId,
       apiKey.rows[0]!.id, rotatedKey.rows[0]!.id, userId],
    );
    const rotation = await client.query<{ rotations: number }>(
      `SELECT count(*)::int rotations FROM project_api_key_rotations
       WHERE old_key_id=$1 AND new_key_id=$2 AND state='completed'`,
      [apiKey.rows[0]!.id, rotatedKey.rows[0]!.id],
    );
    expect(rotation.rows[0]).toEqual({ rotations: 1 });
    await expect(client.query(
      `INSERT INTO project_api_key_rotations(
         organization_id,project_id,environment_id,old_key_id,new_key_id,state,initiated_at,completed_at
       ) VALUES($1,$2,$3,$4,$5,'completed',NOW(),NOW())`,
      [otherOrganization.rows[0]!.id, projectId, environmentId,
       apiKey.rows[0]!.id, rotatedKey.rows[0]!.id],
    )).rejects.toThrow(/foreign key/i);

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

    await client.query(`UPDATE projects SET description='audited change' WHERE id=$1`, [projectId]);
    await client.query(
      `INSERT INTO organization_audit_logs(org_id,project_id,actor_user_id,action,entity_type,entity_id,new_values)
       VALUES($1,$2,$3,'project.updated','project',$2,'{"description":"audited change"}'::jsonb)`,
      [organizationId, projectId, userId],
    );
    const audit = await client.query<{ project_id: string }>(
      `SELECT project_id FROM organization_audit_logs
       WHERE org_id=$1 AND project_id=$2 AND action='project.updated'`,
      [organizationId, projectId],
    );
    expect(audit.rows).toEqual([{ project_id: projectId }]);
  });
});
