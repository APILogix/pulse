import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import {
  applyMigrationSql,
  DRAFT_MIGRATIONS_DIR,
  listMigrationFiles,
  readMigrationSql,
} from '../../scripts/lib/migrations.js';

describe('API-key normalization forward migration', () => {
  let container: PostgreSqlContainer | null = null;
  let client: Client | null = null;
  let unavailable: string | null = null;

  beforeAll(async () => {
    try {
      container = await new PostgreSqlContainer('postgres:16-alpine').start();
      client = new Client({ connectionString: container.getConnectionUri() });
      await client.connect();
      const files = await listMigrationFiles(DRAFT_MIGRATIONS_DIR);
      for (const filename of files) {
        if (filename === '04_projects/018_normalize_project_api_keys_and_usage.up.sql') break;
        const sql = await readMigrationSql(filename, DRAFT_MIGRATIONS_DIR);
        await applyMigrationSql(client, filename, sql);
      }
    } catch (error) {
      unavailable = error instanceof Error ? error.message : String(error);
      await client?.end().catch(() => undefined);
      client = null;
      await container?.stop().catch(() => undefined);
      container = null;
    }
  }, 120_000);

  afterAll(async () => {
    await client?.end();
    await container?.stop();
  });

  it('backfills rotations and usage before replacing legacy columns and grains', async () => {
    if (!client) {
      console.warn(`Skipping API-key normalization test: ${unavailable ?? 'container unavailable'}`);
      return;
    }

    const user = await client.query<{ id: string }>(
      `INSERT INTO users(email,full_name,email_verified)
       VALUES('normalization@example.test','Normalization Owner',true) RETURNING id`,
    );
    const organization = await client.query<{ id: string }>(
      `INSERT INTO organizations(name,slug,owner_user_id,created_by,status)
       VALUES('Normalization Org','normalization-org',$1,$1,'active') RETURNING id`,
      [user.rows[0]!.id],
    );
    const project = await client.query<{ id: string }>(
      `INSERT INTO projects(org_id,name,slug,created_by)
       VALUES($1,'Normalization Project','normalization-project',$2) RETURNING id`,
      [organization.rows[0]!.id, user.rows[0]!.id],
    );
    const environment = await client.query<{ id: string }>(
      `SELECT id FROM project_environments WHERE project_id=$1 AND is_default`,
      [project.rows[0]!.id],
    );
    const oldKey = await client.query<{ id: string }>(
      `INSERT INTO project_api_keys(
         project_id,organization_id,environment_id,public_key,secret_hash,name,created_by,
         status,is_active,rotated_at,rotation_state,rotation_reason
       ) VALUES($1,$2,$3,'pulsiv_prod_normalizeold123',$4,'Old key',$5,
                'rotated',FALSE,NOW(),'completed','legacy rotation') RETURNING id`,
      [project.rows[0]!.id, organization.rows[0]!.id, environment.rows[0]!.id,
       'a'.repeat(64), user.rows[0]!.id],
    );
    const newKey = await client.query<{ id: string }>(
      `INSERT INTO project_api_keys(
         project_id,organization_id,environment_id,public_key,secret_hash,name,created_by,
         rotated_from_key_id,rotation_state,rotated_at,rotation_reason
       ) VALUES($1,$2,$3,'pulsiv_prod_normalizenew123',$4,'New key',$5,$6,
                'completed',NOW(),'legacy linked rotation') RETURNING id`,
      [project.rows[0]!.id, organization.rows[0]!.id, environment.rows[0]!.id,
       'b'.repeat(64), user.rows[0]!.id, oldKey.rows[0]!.id],
    );

    await client.query(
      `INSERT INTO api_key_usage_minute(
         api_key_id,project_id,organization_id,environment_id,bucket,event_type,
         requests,events,errors,bytes_ingested,rate_limited
       ) VALUES($1,$2,$3,$4,date_trunc('minute',NOW()),'span',2,3,1,100,1)`,
      [newKey.rows[0]!.id, project.rows[0]!.id, organization.rows[0]!.id, environment.rows[0]!.id],
    );
    await client.query(
      `INSERT INTO api_key_usage_daily(
         api_key_id,project_id,organization_id,environment_id,bucket,event_type,
         requests,events,errors,bytes_ingested,rate_limited
       ) VALUES($1,$2,$3,$4,CURRENT_DATE,'span',7,11,2,700,3)`,
      [newKey.rows[0]!.id, project.rows[0]!.id, organization.rows[0]!.id, environment.rows[0]!.id],
    );

    const sql = await readMigrationSql(
      '04_projects/018_normalize_project_api_keys_and_usage.up.sql',
      DRAFT_MIGRATIONS_DIR,
    );
    await applyMigrationSql(client, '04_projects/018_normalize_project_api_keys_and_usage.up.sql', sql);

    const keyColumns = await client.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema='public' AND table_name='project_api_keys'`,
    );
    expect(keyColumns.rows.map((row) => row.column_name).sort()).toEqual([
      'id', 'organization_id', 'project_id', 'environment_id', 'name', 'public_key',
      'secret_hash', 'status', 'expires_at', 'last_used_at', 'created_by',
      'rotated_from_key_id', 'created_at', 'updated_at', 'deleted_at',
    ].sort());
    const rotation = await client.query<{ count: number }>(
      `SELECT count(*)::int count FROM project_api_key_rotations
       WHERE old_key_id=$1 AND new_key_id=$2 AND state='completed'`,
      [oldKey.rows[0]!.id, newKey.rows[0]!.id],
    );
    expect(rotation.rows[0]).toEqual({ count: 1 });

    const relations = await client.query<{ relname: string; relkind: string }>(
      `SELECT relname,relkind FROM pg_class
       WHERE relname IN ('api_key_usage_minute','api_key_usage_daily',
                         'api_key_usage_hourly','api_key_usage_monthly')
       ORDER BY relname`,
    );
    expect(relations.rows).toEqual([
      { relname: 'api_key_usage_daily', relkind: 'p' },
      { relname: 'api_key_usage_hourly', relkind: 'v' },
      { relname: 'api_key_usage_minute', relkind: 'p' },
      { relname: 'api_key_usage_monthly', relkind: 'v' },
    ]);

    const migrated = await client.query<{
      minute_events: string; daily_events: string; event_type: string;
    }>(
      `SELECT
         (SELECT sum(accepted_event_count)::text FROM api_key_usage_minute WHERE api_key_id=$1) minute_events,
         (SELECT sum(accepted_event_count)::text FROM api_key_usage_daily WHERE api_key_id=$1) daily_events,
         (SELECT t.name FROM api_key_usage_minute m JOIN telemetry_event_types t ON t.id=m.event_type_id
          WHERE m.api_key_id=$1 LIMIT 1) event_type`,
      [newKey.rows[0]!.id],
    );
    expect(migrated.rows[0]).toEqual({ minute_events: '3', daily_events: '11', event_type: 'span' });

    const eventType = await client.query<{ id: number }>(
      `SELECT id FROM telemetry_event_types WHERE name='span'`,
    );
    await expect(client.query(
      `INSERT INTO api_key_usage_minute(
         api_key_id,project_id,organization_id,environment_id,bucket,event_type_id,request_count
       ) VALUES($1,$2,$3,$4,date_trunc('minute',NOW()),$5,1)`,
      [newKey.rows[0]!.id, project.rows[0]!.id,
       '00000000-0000-4000-8000-000000000001', environment.rows[0]!.id, eventType.rows[0]!.id],
    )).rejects.toThrow(/tenant dimensions/i);
  }, 60_000);
});
