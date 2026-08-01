import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';

/**
 * Verifies the analytics engine schema against a real Postgres instance:
 *   - both migrations apply cleanly and are replayable
 *   - every documented rollup table exists with the documented primary key
 *   - partition helpers are idempotent and refuse non-analytics tables
 *   - a whole-bucket recompute upsert converges on replay (the core idempotency
 *     guarantee from docs/analytics/00-architecture-overview.md §4)
 *
 * Skips with a warning when no container runtime is available, matching the
 * behaviour of test/integration/logdb-migrations.test.ts.
 */

const LOGDB_ROOT = fileURLToPath(new URL('../../database/migrations/logdb/', import.meta.url));

const MIGRATIONS = [
  '00_shared/001_foundation.up.sql',
  '02_ingestion/001_ingestion_runtime.up.sql',
  '03_observability/001_canonical_events.up.sql',
  '03_observability/002_typed_event_runtime.up.sql',
  '03_observability/003_add_events_metrics_request_id.up.sql',
  '04_analytics/001_analytics_runtime.up.sql',
  '04_analytics/002_typed_analytics_runtime.up.sql',
  '04_analytics/003_analytics_engine_rollups.up.sql',
  '04_analytics/004_analytics_engine_partitions.up.sql',
  '10_lookup/001_lookup_dimensions.up.sql',
  '11_geo/001_geo_reference.up.sql',
  '12_retention/001_retention.up.sql',
] as const;

/** Every rollup table declared in docs/analytics/07-rollup-tables.md §2. */
const SHAPE_A_TABLES = [
  'request_metrics_1m', 'request_metrics_5m', 'request_metrics_1h', 'request_metrics_1d',
  'error_metrics_1m', 'error_metrics_5m', 'error_metrics_1h', 'error_metrics_1d',
  'log_metrics_1m', 'log_metrics_5m', 'log_metrics_1h', 'log_metrics_1d',
  'trace_metrics_1m', 'trace_metrics_5m', 'trace_metrics_1h',
  'replay_metrics_1h', 'session_metrics_1h', 'user_metrics_1d',
  'cost_metrics_1d', 'project_health_5m',
] as const;

const SHAPE_B_TABLES = [
  'endpoint_metrics_1m', 'endpoint_metrics_5m', 'endpoint_metrics_1h', 'endpoint_metrics_1d',
  'service_metrics_1m', 'service_metrics_5m', 'service_metrics_1h', 'service_metrics_1d',
  'error_group_metrics_1m', 'error_group_metrics_1h', 'error_group_metrics_1d',
  'error_dimension_metrics_1h', 'logger_metrics_1h',
  'metric_series_1m', 'metric_series_1h', 'metric_series_1d',
  'runtime_metrics_1m', 'runtime_metrics_1h',
  'gc_metrics_1m', 'gc_metrics_1h',
  'span_metrics_1m', 'span_metrics_1h',
  'db_metrics_1h', 'dependency_metrics_1h', 'trace_edge_metrics_1h',
  'cron_metrics_1m', 'cron_metrics_1h',
  'profile_metrics_1h', 'profile_function_metrics_1h',
  'geo_metrics_1h', 'device_metrics_1h', 'sdk_metrics_1h', 'release_metrics_1h',
  'slo_metrics_5m', 'slo_metrics_1h', 'security_metrics_1h',
  'usage_metrics_1d', 'ingest_health_metrics_5m',
  'alert_metrics_1h', 'ai_metrics_1h',
] as const;

const STATE_TABLES = [
  'cron_monitor_state',
  'release_comparison',
  'slo_definition_cache',
  'anomaly_detections',
  'analytics_watermarks',
  'analytics_worker_runs',
] as const;

const ORG = '11111111-1111-4111-8111-111111111111';
const PROJECT = '22222222-2222-4222-8222-222222222222';

describe('analytics engine migrations', () => {
  let container: PostgreSqlContainer | null = null;
  let client: Client | null = null;
  let skipReason: string | null = null;

  beforeAll(async () => {
    try {
      container = await new PostgreSqlContainer('postgres:16-alpine').start();
      client = new Client({ connectionString: container.getConnectionUri() });
      await client.connect();
      for (const migration of MIGRATIONS) {
        const sql = await readFile(`${LOGDB_ROOT}/${migration}`, 'utf8');
        await client.query(sql);
      }
    } catch (error) {
      skipReason = error instanceof Error ? error.message : String(error);
    }
  });

  afterAll(async () => {
    await client?.end();
    client = null;
    await container?.stop();
    container = null;
  });

  const guard = (): Client | null => {
    if (!client) {
      console.warn(`Skipping analytics engine migration test: ${skipReason ?? 'no container runtime'}`);
      return null;
    }
    return client;
  };

  it('creates every documented rollup table as a partitioned relation', async () => {
    const db = guard();
    if (!db) return;

    const expected = [...SHAPE_A_TABLES, ...SHAPE_B_TABLES];
    const result = await db.query<{ relname: string; relkind: string }>(
      `SELECT relname, relkind FROM pg_class
        WHERE relname = ANY($1::text[]) AND relnamespace = 'public'::regnamespace
        ORDER BY relname`,
      [expected],
    );

    expect(result.rows).toHaveLength(expected.length);
    expect(result.rows.every((row) => row.relkind === 'p')).toBe(true);
  });

  it('creates the engine state and ledger tables', async () => {
    const db = guard();
    if (!db) return;

    const result = await db.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
      [[...STATE_TABLES]],
    );
    expect(result.rows).toHaveLength(STATE_TABLES.length);
  });

  it('uses the documented primary keys per shape', async () => {
    const db = guard();
    if (!db) return;

    const keys = async (table: string): Promise<string[]> => {
      const result = await db.query<{ column_name: string }>(
        `SELECT a.attname AS column_name
           FROM pg_index i
           JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
          WHERE i.indrelid = $1::regclass AND i.indisprimary
          ORDER BY array_position(i.indkey, a.attnum)`,
        [table],
      );
      return result.rows.map((row) => row.column_name);
    };

    expect(await keys('request_metrics_1m')).toEqual([
      'organization_id', 'project_id', 'environment', 'bucket',
    ]);
    expect(await keys('endpoint_metrics_1m')).toEqual([
      'organization_id', 'project_id', 'environment', 'bucket', 'entity_key',
    ]);
    expect(await keys('analytics_watermarks')).toEqual([
      'worker_id', 'organization_id', 'window_size',
    ]);
  });

  it('gives every rollup a tenant/time index and a BRIN index on bucket', async () => {
    const db = guard();
    if (!db) return;

    const sample = ['request_metrics_1m', 'endpoint_metrics_1h', 'geo_metrics_1h'];
    for (const table of sample) {
      const result = await db.query<{ indexdef: string }>(
        `SELECT indexdef FROM pg_indexes WHERE schemaname='public' AND tablename=$1`,
        [table],
      );
      const definitions = result.rows.map((row) => row.indexdef).join('\n');
      expect(definitions).toContain('organization_id, project_id, environment, bucket');
      expect(definitions).toContain('USING brin (bucket)');
    }
  });

  it('adds the ingest watermark index to all ten canonical event tables', async () => {
    const db = guard();
    if (!db) return;

    const result = await db.query<{ tablename: string }>(
      `SELECT tablename FROM pg_indexes
        WHERE schemaname='public' AND indexname LIKE 'idx_events_%_tenant_env_ingested'`,
    );
    expect(result.rows).toHaveLength(10);
  });

  it('creates partitions idempotently', async () => {
    const db = guard();
    if (!db) return;

    // The migration already ran ensure_partitions(7); a second call must be a no-op.
    const second = await db.query<{ created: number }>(
      'SELECT analytics_engine_ensure_partitions(7) AS created',
    );
    expect(Number(second.rows[0]!.created)).toBe(0);

    // Extending the horizon creates more.
    const extended = await db.query<{ created: number }>(
      'SELECT analytics_engine_ensure_partitions(14) AS created',
    );
    expect(Number(extended.rows[0]!.created)).toBeGreaterThan(0);

    const partitions = await db.query<{ count: string }>(
      `SELECT COUNT(*)::bigint AS count FROM pg_class
        WHERE relname LIKE 'request_metrics_1m_p%'`,
    );
    expect(Number(partitions.rows[0]!.count)).toBeGreaterThan(0);
  });

  it('refuses to drop partitions of a table outside the analytics allowlist', async () => {
    const db = guard();
    if (!db) return;

    await expect(
      db.query(`SELECT analytics_engine_drop_partitions_before('events_requests', NOW())`),
    ).rejects.toThrow(/not an analytics-engine partitioned table/);
  });

  it('never drops the default partition', async () => {
    const db = guard();
    if (!db) return;

    const dropped = await db.query<{ dropped: number }>(
      `SELECT analytics_engine_drop_partitions_before('request_metrics_1m', NOW() + INTERVAL '365 days') AS dropped`,
    );
    expect(Number(dropped.rows[0]!.dropped)).toBeGreaterThan(0);

    const stillThere = await db.query<{ count: string }>(
      `SELECT COUNT(*)::bigint AS count FROM pg_class WHERE relname = 'request_metrics_1m_default'`,
    );
    expect(Number(stillThere.rows[0]!.count)).toBe(1);

    // Restore the horizon for later assertions.
    await db.query('SELECT analytics_engine_ensure_partitions(7)');
  });

  it('converges on replay: the same upsert twice yields the same row', async () => {
    const db = guard();
    if (!db) return;

    const upsert = `
      INSERT INTO request_metrics_1m
        (organization_id, project_id, environment, bucket, total_count, error_count, sample_count)
      VALUES ($1, $2, 'production', '2026-08-01T10:00:00Z', 100, 5, 100)
      ON CONFLICT (organization_id, project_id, environment, bucket) DO UPDATE
         SET total_count = EXCLUDED.total_count,
             error_count = EXCLUDED.error_count,
             sample_count = EXCLUDED.sample_count,
             updated_at = NOW()`;

    await db.query(upsert, [ORG, PROJECT]);
    await db.query(upsert, [ORG, PROJECT]);
    await db.query(upsert, [ORG, PROJECT]);

    const result = await db.query<{ total_count: string; error_count: string; rows: string }>(
      `SELECT total_count, error_count, COUNT(*) OVER ()::bigint AS rows
         FROM request_metrics_1m
        WHERE organization_id = $1 AND project_id = $2`,
      [ORG, PROJECT],
    );
    expect(result.rows).toHaveLength(1);
    expect(Number(result.rows[0]!.total_count)).toBe(100);
    expect(Number(result.rows[0]!.error_count)).toBe(5);
  });

  it('routes rows into the correct daily partition', async () => {
    const db = guard();
    if (!db) return;

    const today = new Date();
    today.setUTCHours(10, 0, 0, 0);

    await db.query(
      `INSERT INTO request_metrics_1m
         (organization_id, project_id, environment, bucket, total_count, sample_count)
       VALUES ($1, $2, 'staging', $3, 7, 7)
       ON CONFLICT (organization_id, project_id, environment, bucket) DO NOTHING`,
      [ORG, PROJECT, today],
    );

    const located = await db.query<{ partition: string }>(
      `SELECT tableoid::regclass::text AS partition
         FROM request_metrics_1m
        WHERE organization_id = $1 AND environment = 'staging'`,
      [ORG],
    );
    expect(located.rows).toHaveLength(1);
    expect(located.rows[0]!.partition).not.toBe('request_metrics_1m_default');
    expect(located.rows[0]!.partition).toMatch(/request_metrics_1m_p\d{8}/);
  });

  it('stores and merges HLL sketches as bytea without an extension', async () => {
    const db = guard();
    if (!db) return;

    const sketch = Buffer.alloc(2 + (1 << 14));
    sketch[0] = 1;
    sketch[1] = 14;
    sketch[2] = 3;

    await db.query(
      `UPDATE request_metrics_1m SET unique_users_hll = $3
        WHERE organization_id = $1 AND project_id = $2 AND environment = 'production'`,
      [ORG, PROJECT, sketch],
    );

    const result = await db.query<{ length: number }>(
      `SELECT octet_length(unique_users_hll) AS length
         FROM request_metrics_1m
        WHERE organization_id = $1 AND environment = 'production'`,
      [ORG],
    );
    expect(result.rows[0]!.length).toBe(2 + (1 << 14));
  });

  it('stores latency histograms as bigint arrays', async () => {
    const db = guard();
    if (!db) return;

    const histogram = Array.from({ length: 24 }, (_, index) => index);
    await db.query(
      `UPDATE request_metrics_1m SET latency_hist = $3::bigint[]
        WHERE organization_id = $1 AND project_id = $2 AND environment = 'production'`,
      [ORG, PROJECT, histogram],
    );

    const result = await db.query<{ latency_hist: string[] }>(
      `SELECT latency_hist FROM request_metrics_1m
        WHERE organization_id = $1 AND environment = 'production'`,
      [ORG],
    );
    expect(result.rows[0]!.latency_hist.map(Number)).toEqual(histogram);
  });

  it('freezes the superseded legacy analytics tables with a comment', async () => {
    const db = guard();
    if (!db) return;

    const result = await db.query<{ relname: string; description: string | null }>(
      `SELECT c.relname, obj_description(c.oid) AS description
         FROM pg_class c
        WHERE c.relname = ANY($1::text[])`,
      [['analytics_hourly_rollup', 'analytics_daily_rollup', 'analytics_performance_summary']],
    );
    expect(result.rows.length).toBeGreaterThan(0);
    for (const row of result.rows) {
      expect(row.description ?? '').toContain('FROZEN');
    }
  });

  it('records ownership decisions in logdb_schema_notes', async () => {
    const db = guard();
    if (!db) return;

    const result = await db.query<{ subject: string }>(
      `SELECT subject FROM logdb_schema_notes WHERE subject LIKE 'analytics_engine%'`,
    );
    const subjects = result.rows.map((row) => row.subject);
    expect(subjects).toContain('analytics_engine_ownership');
    expect(subjects).toContain('analytics_engine_sentinels');
    expect(subjects).toContain('analytics_engine_partitioning');
  });

  it('is replayable: applying both migrations twice is a no-op', async () => {
    const db = guard();
    if (!db) return;

    for (const migration of [
      '04_analytics/003_analytics_engine_rollups.up.sql',
      '04_analytics/004_analytics_engine_partitions.up.sql',
    ]) {
      const sql = await readFile(`${LOGDB_ROOT}/${migration}`, 'utf8');
      await expect(db.query(sql)).resolves.toBeDefined();
    }
  });
});
