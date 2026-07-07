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

  it('applies the draft domain-based chain to a fresh database', async () => {
    if (!client) {
      console.warn(
        `Skipping draft bootstrap integration test: ${runtimeUnavailableReason ?? 'container runtime unavailable'}`,
      );
      return;
    }

    const files = await listMigrationFiles(DRAFT_MIGRATIONS_DIR);

    for (const filename of files) {
      const sql = await readMigrationSql(filename, DRAFT_MIGRATIONS_DIR);
      await applyMigrationSql(client, filename, sql);
    }

    const existence = await client.query<{
      users_exists: boolean;
      organizations_exists: boolean;
      connector_configs_exists: boolean;
      alert_rules_exists: boolean;
      usage_daily_counters_exists: boolean;
      ingestion_jobs_exists: boolean;
      events_errors_exists: boolean;
      analytics_hourly_rollup_exists: boolean;
      legacy_spans_exists: boolean;
    }>(
      `SELECT
         to_regclass('public.users') IS NOT NULL AS users_exists,
         to_regclass('public.organizations') IS NOT NULL AS organizations_exists,
         to_regclass('public.connector_configs') IS NOT NULL AS connector_configs_exists,
         to_regclass('public.alert_rules') IS NOT NULL AS alert_rules_exists,
         to_regclass('public.usage_daily_counters') IS NOT NULL AS usage_daily_counters_exists,
         to_regclass('public.ingestion_jobs') IS NOT NULL AS ingestion_jobs_exists,
         to_regclass('public.events_errors') IS NOT NULL AS events_errors_exists,
         to_regclass('public.analytics_hourly_rollup') IS NOT NULL AS analytics_hourly_rollup_exists,
         to_regclass('public.spans') IS NOT NULL AS legacy_spans_exists`,
    );

    expect(existence.rows[0]).toMatchObject({
      users_exists: true,
      organizations_exists: true,
      connector_configs_exists: true,
      alert_rules_exists: true,
      usage_daily_counters_exists: true,
      ingestion_jobs_exists: true,
      events_errors_exists: true,
      analytics_hourly_rollup_exists: true,
      legacy_spans_exists: true,
    });
  });
});
