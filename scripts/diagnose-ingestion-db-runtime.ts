/**
 * Read-only runtime diagnostics for ingestion DB latency investigations.
 *
 * Use this while a benchmark or production-like worker run is active. The
 * schema audit proves what is deployed; this script captures live database
 * pressure that can explain high insertMs/commitMs such as lock waits, WAL /
 * checkpoint movement, dead tuples, table/index churn, and pg-boss backlog.
 */
import { writeFile } from 'fs/promises';
import type { Pool, QueryResultRow } from 'pg';
import { pool as primaryPool, closeDatabase } from '../src/config/database.js';
import { logDB } from '../src/config/log-database.js';

type OutputFormat = 'json' | 'markdown';

interface DiagnosticConfig {
  format: OutputFormat;
  outPath: string | null;
  tables: string[];
  samples: number;
  intervalMs: number;
  activityLimit: number;
}

interface RuntimeSnapshot {
  sampledAt: string;
  logDbPool: ReturnType<typeof logDB.getPoolStats>;
  logDb: {
    database: string;
    version: string;
    activity: QueryResultRow[];
    waitingActivity: QueryResultRow[];
    locks: QueryResultRow[];
    wal: QueryResultRow | null;
    bgwriter: QueryResultRow | null;
    databaseStats: QueryResultRow | null;
    relationStats: QueryResultRow[];
    indexStats: QueryResultRow[];
    relationSizes: QueryResultRow[];
    optionalStatsUnavailable: string[];
  };
  primaryDb: {
    database: string;
    activity: QueryResultRow[];
    waitingActivity: QueryResultRow[];
    locks: QueryResultRow[];
    wal: QueryResultRow | null;
    databaseStats: QueryResultRow | null;
    pgbossQueues: QueryResultRow[];
    pgbossActivity: QueryResultRow[];
    pgbossRelationStats: QueryResultRow[];
    pgbossRelationSizes: QueryResultRow[];
    optionalStatsUnavailable: string[];
  };
}

interface RuntimeDiagnostics {
  generatedAt: string;
  intervalMs: number;
  tables: string[];
  snapshots: RuntimeSnapshot[];
  deltas: QueryResultRow[];
}

const defaultTables = [
  'events_requests',
  'events_errors',
  'events_logs',
  'events_metrics',
  'events_spans',
  'events_traces',
  'events_messages',
  'events_profiles',
  'events_replays',
  'events_cron_checkins',
  'telemetry_outbox',
  'alert_runtime_idempotency_keys',
  'error_groups',
  'analytics_error_groups',
  'ingestion_dead_letter_jobs',
];

function usage(): void {
  console.error(`Usage:
  npm run ingestion:db:runtime -- [--format json|markdown] [--out artifacts/ingestion-db-runtime.json] [--tables table_a,table_b] [--samples 2] [--interval-ms 5000] [--activity-limit 20]
`);
  process.exit(2);
}

function parseArgs(): DiagnosticConfig {
  const args: Record<string, string | boolean> = {};
  for (let i = 2; i < process.argv.length; i += 1) {
    const arg = process.argv[i];
    if (!arg?.startsWith('--')) continue;
    const key = arg.slice(2);
    const value = process.argv[i + 1];
    if (!value || value.startsWith('--')) args[key] = true;
    else {
      args[key] = value;
      i += 1;
    }
  }

  if (args.help === true || args.h === true) usage();
  const samples = Number(args.samples ?? 1);
  const intervalMs = Number(args['interval-ms'] ?? 0);
  const activityLimit = Number(args['activity-limit'] ?? 20);
  const tables = typeof args.tables === 'string'
    ? args.tables.split(',').map((table) => table.trim()).filter(Boolean)
    : defaultTables;

  if (tables.length === 0) usage();
  return {
    format: args.format === 'markdown' ? 'markdown' : 'json',
    outPath: typeof args.out === 'string' ? args.out : null,
    tables,
    samples: Number.isFinite(samples) && samples > 0 ? Math.floor(samples) : 1,
    intervalMs: Number.isFinite(intervalMs) && intervalMs > 0 ? Math.floor(intervalMs) : 0,
    activityLimit: Number.isFinite(activityLimit) && activityLimit > 0 ? Math.floor(activityLimit) : 20,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function optionalOne(pool: Pool, sql: string, unavailable: string[], label: string): Promise<QueryResultRow | null> {
  try {
    const result = await pool.query(sql);
    return result.rows[0] ?? null;
  } catch (err) {
    unavailable.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

function relationFilterSql(alias: string): string {
  return `(${alias}.schemaname = 'public' AND ${alias}.relname = ANY($1::text[]))
      OR (${alias}.schemaname || '.' || ${alias}.relname = ANY($1::text[]))`;
}

async function collectSnapshot(config: DiagnosticConfig): Promise<RuntimeSnapshot> {
  const logPool = logDB.getPrimaryPool();
  const unavailable: string[] = [];
  const primaryUnavailable: string[] = [];
  const [
    logDbInfo,
    primaryDbInfo,
    activity,
    waitingActivity,
    locks,
    wal,
    bgwriter,
    databaseStats,
    relationStats,
    indexStats,
    relationSizes,
    primaryActivity,
    primaryWaitingActivity,
    primaryLocks,
    primaryWal,
    primaryDatabaseStats,
    pgbossQueues,
    pgbossActivity,
    pgbossRelationStats,
    pgbossRelationSizes,
  ] = await Promise.all([
    logPool.query<{ database: string; version: string }>(
      `SELECT current_database() AS database, version() AS version`,
    ),
    primaryPool.query<{ database: string }>(`SELECT current_database() AS database`),
    logPool.query(
      `
      SELECT
        pid,
        application_name,
        state,
        wait_event_type,
        wait_event,
        now() - query_start AS query_age,
        now() - xact_start AS transaction_age,
        left(regexp_replace(query, '\\s+', ' ', 'g'), 240) AS query_sample
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND pid <> pg_backend_pid()
        AND (
          application_name ILIKE '%ingestion%'
          OR application_name ILIKE '%log_primary%'
          OR application_name ILIKE '%worker%'
          OR state <> 'idle'
        )
      ORDER BY query_start NULLS LAST
      LIMIT $1
      `,
      [config.activityLimit],
    ),
    logPool.query(
      `
      SELECT
        pid,
        application_name,
        state,
        wait_event_type,
        wait_event,
        now() - query_start AS query_age,
        now() - xact_start AS transaction_age,
        left(regexp_replace(query, '\\s+', ' ', 'g'), 240) AS query_sample
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND wait_event_type IS NOT NULL
        AND pid <> pg_backend_pid()
      ORDER BY query_start NULLS LAST
      LIMIT $1
      `,
      [config.activityLimit],
    ),
    logPool.query(
      `
      SELECT
        a.pid,
        a.application_name,
        a.state,
        a.wait_event_type,
        a.wait_event,
        l.locktype,
        l.mode,
        l.granted,
        n.nspname AS schema_name,
        c.relname AS relation_name,
        now() - a.query_start AS query_age,
        left(regexp_replace(a.query, '\\s+', ' ', 'g'), 240) AS query_sample
      FROM pg_locks l
      JOIN pg_stat_activity a ON a.pid = l.pid
      LEFT JOIN pg_class c ON c.oid = l.relation
      LEFT JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE a.datname = current_database()
        AND (l.granted = false OR a.wait_event_type = 'Lock')
      ORDER BY l.granted, a.query_start NULLS LAST
      LIMIT $1
      `,
      [config.activityLimit],
    ),
    optionalOne(logPool, `SELECT to_jsonb(pg_stat_wal.*) AS stats FROM pg_stat_wal`, unavailable, 'pg_stat_wal'),
    optionalOne(logPool, `SELECT to_jsonb(pg_stat_bgwriter.*) AS stats FROM pg_stat_bgwriter`, unavailable, 'pg_stat_bgwriter'),
    optionalOne(
      logPool,
      `
      SELECT to_jsonb(s.*) AS stats
      FROM pg_stat_database s
      WHERE s.datname = current_database()
      `,
      unavailable,
      'pg_stat_database',
    ),
    logPool.query(
      `
      SELECT
        schemaname,
        relname,
        seq_scan,
        seq_tup_read,
        idx_scan,
        idx_tup_fetch,
        n_tup_ins,
        n_tup_upd,
        n_tup_del,
        n_tup_hot_upd,
        n_live_tup,
        n_dead_tup,
        vacuum_count,
        autovacuum_count,
        analyze_count,
        autoanalyze_count,
        last_vacuum,
        last_autovacuum,
        last_analyze,
        last_autoanalyze
      FROM pg_stat_user_tables s
      WHERE ${relationFilterSql('s')}
      ORDER BY schemaname, relname
      `,
      [config.tables],
    ),
    logPool.query(
      `
      SELECT
        schemaname,
        relname,
        indexrelname,
        idx_scan,
        idx_tup_read,
        idx_tup_fetch
      FROM pg_stat_user_indexes s
      WHERE ${relationFilterSql('s')}
      ORDER BY schemaname, relname, indexrelname
      `,
      [config.tables],
    ),
    logPool.query(
      `
      SELECT
        n.nspname AS schema_name,
        c.relname AS relation_name,
        pg_total_relation_size(c.oid) AS total_bytes,
        pg_relation_size(c.oid) AS heap_bytes,
        pg_indexes_size(c.oid) AS indexes_bytes
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind IN ('r', 'p')
        AND (
          (n.nspname = 'public' AND c.relname = ANY($1::text[]))
          OR (n.nspname || '.' || c.relname = ANY($1::text[]))
        )
      ORDER BY n.nspname, c.relname
      `,
      [config.tables],
    ),
    primaryPool.query(
      `
      SELECT
        pid,
        application_name,
        state,
        wait_event_type,
        wait_event,
        now() - query_start AS query_age,
        now() - xact_start AS transaction_age,
        left(regexp_replace(query, '\\s+', ' ', 'g'), 240) AS query_sample
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND pid <> pg_backend_pid()
        AND (
          application_name ILIKE '%pgboss%'
          OR application_name ILIKE '%ingestion%'
          OR query ILIKE '%pgboss.%'
          OR state <> 'idle'
        )
      ORDER BY query_start NULLS LAST
      LIMIT $1
      `,
      [config.activityLimit],
    ),
    primaryPool.query(
      `
      SELECT
        pid,
        application_name,
        state,
        wait_event_type,
        wait_event,
        now() - query_start AS query_age,
        now() - xact_start AS transaction_age,
        left(regexp_replace(query, '\\s+', ' ', 'g'), 240) AS query_sample
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND wait_event_type IS NOT NULL
        AND pid <> pg_backend_pid()
        AND (
          application_name ILIKE '%pgboss%'
          OR application_name ILIKE '%ingestion%'
          OR query ILIKE '%pgboss.%'
        )
      ORDER BY query_start NULLS LAST
      LIMIT $1
      `,
      [config.activityLimit],
    ),
    primaryPool.query(
      `
      SELECT
        a.pid,
        a.application_name,
        a.state,
        a.wait_event_type,
        a.wait_event,
        l.locktype,
        l.mode,
        l.granted,
        n.nspname AS schema_name,
        c.relname AS relation_name,
        now() - a.query_start AS query_age,
        left(regexp_replace(a.query, '\\s+', ' ', 'g'), 240) AS query_sample
      FROM pg_locks l
      JOIN pg_stat_activity a ON a.pid = l.pid
      LEFT JOIN pg_class c ON c.oid = l.relation
      LEFT JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE a.datname = current_database()
        AND (l.granted = false OR a.wait_event_type = 'Lock')
        AND (
          n.nspname = 'pgboss'
          OR a.application_name ILIKE '%pgboss%'
          OR a.application_name ILIKE '%ingestion%'
          OR a.query ILIKE '%pgboss.%'
        )
      ORDER BY l.granted, a.query_start NULLS LAST
      LIMIT $1
      `,
      [config.activityLimit],
    ),
    optionalOne(primaryPool, `SELECT to_jsonb(pg_stat_wal.*) AS stats FROM pg_stat_wal`, primaryUnavailable, 'primary_pg_stat_wal'),
    optionalOne(
      primaryPool,
      `
      SELECT to_jsonb(s.*) AS stats
      FROM pg_stat_database s
      WHERE s.datname = current_database()
      `,
      primaryUnavailable,
      'primary_pg_stat_database',
    ),
    primaryPool.query(
      `
      SELECT
        q.name,
        q.policy,
        q.partition,
        q.table_name,
        q.notify,
        count(j.*) FILTER (WHERE j.state = 'created') AS queued_count,
        count(j.*) FILTER (WHERE j.state = 'retry') AS retry_count,
        count(j.*) FILTER (WHERE j.state = 'active') AS active_count,
        count(j.*) FILTER (WHERE j.state = 'failed') AS failed_count,
        count(j.*) AS total_count,
        min(j.created_on) FILTER (WHERE j.state IN ('created', 'retry')) AS oldest_pending_created_on
      FROM pgboss.queue q
      LEFT JOIN pgboss.job j ON j.name = q.name
      WHERE q.name LIKE 'ingest.%'
      GROUP BY q.name, q.policy, q.partition, q.table_name, q.notify
      ORDER BY q.name
      `,
    ),
    primaryPool.query(
      `
      SELECT
        pid,
        application_name,
        state,
        wait_event_type,
        wait_event,
        now() - query_start AS query_age,
        now() - xact_start AS transaction_age,
        left(regexp_replace(query, '\\s+', ' ', 'g'), 240) AS query_sample
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND pid <> pg_backend_pid()
        AND (
          application_name ILIKE '%pgboss%'
          OR application_name ILIKE '%ingestion%'
          OR query ILIKE '%pgboss.%'
        )
      ORDER BY query_start NULLS LAST
      LIMIT $1
      `,
      [config.activityLimit],
    ),
    primaryPool.query(
      `
      SELECT
        schemaname,
        relname,
        seq_scan,
        seq_tup_read,
        idx_scan,
        idx_tup_fetch,
        n_tup_ins,
        n_tup_upd,
        n_tup_del,
        n_tup_hot_upd,
        n_live_tup,
        n_dead_tup,
        vacuum_count,
        autovacuum_count,
        analyze_count,
        autoanalyze_count
      FROM pg_stat_user_tables
      WHERE schemaname = 'pgboss'
      ORDER BY relname
      `,
    ),
    primaryPool.query(
      `
      SELECT
        n.nspname AS schema_name,
        c.relname AS relation_name,
        pg_total_relation_size(c.oid) AS total_bytes,
        pg_relation_size(c.oid) AS heap_bytes,
        pg_indexes_size(c.oid) AS indexes_bytes
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'pgboss'
        AND c.relkind IN ('r', 'p')
      ORDER BY pg_total_relation_size(c.oid) DESC
      `,
    ),
  ]);

  return {
    sampledAt: new Date().toISOString(),
    logDbPool: logDB.getPoolStats(),
    logDb: {
      database: logDbInfo.rows[0]?.database ?? '',
      version: logDbInfo.rows[0]?.version ?? '',
      activity: activity.rows,
      waitingActivity: waitingActivity.rows,
      locks: locks.rows,
      wal,
      bgwriter,
      databaseStats,
      relationStats: relationStats.rows,
      indexStats: indexStats.rows,
      relationSizes: relationSizes.rows,
      optionalStatsUnavailable: unavailable,
    },
    primaryDb: {
      database: primaryDbInfo.rows[0]?.database ?? '',
      activity: primaryActivity.rows,
      waitingActivity: primaryWaitingActivity.rows,
      locks: primaryLocks.rows,
      wal: primaryWal,
      databaseStats: primaryDatabaseStats,
      pgbossQueues: pgbossQueues.rows,
      pgbossActivity: pgbossActivity.rows,
      pgbossRelationStats: pgbossRelationStats.rows,
      pgbossRelationSizes: pgbossRelationSizes.rows,
      optionalStatsUnavailable: primaryUnavailable,
    },
  };
}

function numeric(value: unknown): number | null {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function statsObject(row: QueryResultRow | null): Record<string, unknown> {
  const stats = row?.stats;
  return stats && typeof stats === 'object' && !Array.isArray(stats)
    ? stats as Record<string, unknown>
    : {};
}

function computeDeltas(snapshots: RuntimeSnapshot[]): QueryResultRow[] {
  if (snapshots.length < 2) return [];
  const first = snapshots[0]!;
  const last = snapshots[snapshots.length - 1]!;
  const deltas: QueryResultRow[] = [];

  const firstWal = statsObject(first.logDb.wal);
  const lastWal = statsObject(last.logDb.wal);
  for (const key of ['wal_records', 'wal_fpi', 'wal_bytes', 'wal_write', 'wal_sync', 'wal_write_time', 'wal_sync_time']) {
    const start = numeric(firstWal[key]);
    const end = numeric(lastWal[key]);
    if (start !== null && end !== null) deltas.push({ scope: 'log_db_wal', metric: key, delta: end - start });
  }

  const firstDb = statsObject(first.logDb.databaseStats);
  const lastDb = statsObject(last.logDb.databaseStats);
  for (const key of ['xact_commit', 'xact_rollback', 'blks_read', 'blks_hit', 'tup_inserted', 'tup_updated', 'tup_deleted', 'deadlocks', 'temp_bytes']) {
    const start = numeric(firstDb[key]);
    const end = numeric(lastDb[key]);
    if (start !== null && end !== null) deltas.push({ scope: 'log_db_database', metric: key, delta: end - start });
  }

  const firstTables = new Map(first.logDb.relationStats.map((row) => [`${row.schemaname}.${row.relname}`, row]));
  for (const row of last.logDb.relationStats) {
    const key = `${row.schemaname}.${row.relname}`;
    const start = firstTables.get(key);
    if (!start) continue;
    for (const metric of ['seq_scan', 'seq_tup_read', 'idx_scan', 'n_tup_ins', 'n_tup_upd', 'n_tup_del', 'n_dead_tup']) {
      const startValue = numeric(start[metric]);
      const endValue = numeric(row[metric]);
      if (startValue !== null && endValue !== null) {
        deltas.push({ scope: 'log_db_table', relation: key, metric, delta: endValue - startValue });
      }
    }
  }

  const firstRelationSizes = new Map(first.logDb.relationSizes.map((row) => [`${row.schema_name}.${row.relation_name}`, row]));
  for (const row of last.logDb.relationSizes) {
    const key = `${row.schema_name}.${row.relation_name}`;
    const start = firstRelationSizes.get(key);
    if (!start) continue;
    for (const metric of ['total_bytes', 'heap_bytes', 'indexes_bytes']) {
      const startValue = numeric(start[metric]);
      const endValue = numeric(row[metric]);
      if (startValue !== null && endValue !== null) {
        deltas.push({ scope: 'log_db_relation_size', relation: key, metric, delta: endValue - startValue });
      }
    }
  }

  const firstPrimaryWal = statsObject(first.primaryDb.wal);
  const lastPrimaryWal = statsObject(last.primaryDb.wal);
  for (const key of ['wal_records', 'wal_fpi', 'wal_bytes', 'wal_write', 'wal_sync', 'wal_write_time', 'wal_sync_time']) {
    const start = numeric(firstPrimaryWal[key]);
    const end = numeric(lastPrimaryWal[key]);
    if (start !== null && end !== null) deltas.push({ scope: 'primary_db_wal', metric: key, delta: end - start });
  }

  const firstPrimaryDb = statsObject(first.primaryDb.databaseStats);
  const lastPrimaryDb = statsObject(last.primaryDb.databaseStats);
  for (const key of ['xact_commit', 'xact_rollback', 'blks_read', 'blks_hit', 'tup_inserted', 'tup_updated', 'tup_deleted', 'deadlocks', 'temp_bytes']) {
    const start = numeric(firstPrimaryDb[key]);
    const end = numeric(lastPrimaryDb[key]);
    if (start !== null && end !== null) deltas.push({ scope: 'primary_db_database', metric: key, delta: end - start });
  }

  const firstPgbossTables = new Map(first.primaryDb.pgbossRelationStats.map((row) => [`${row.schemaname}.${row.relname}`, row]));
  for (const row of last.primaryDb.pgbossRelationStats) {
    const key = `${row.schemaname}.${row.relname}`;
    const start = firstPgbossTables.get(key);
    if (!start) continue;
    for (const metric of ['seq_scan', 'seq_tup_read', 'idx_scan', 'n_tup_ins', 'n_tup_upd', 'n_tup_del', 'n_dead_tup']) {
      const startValue = numeric(start[metric]);
      const endValue = numeric(row[metric]);
      if (startValue !== null && endValue !== null) {
        deltas.push({ scope: 'primary_pgboss_table', relation: key, metric, delta: endValue - startValue });
      }
    }
  }

  const firstPgbossRelationSizes = new Map(first.primaryDb.pgbossRelationSizes.map((row) => [`${row.schema_name}.${row.relation_name}`, row]));
  for (const row of last.primaryDb.pgbossRelationSizes) {
    const key = `${row.schema_name}.${row.relation_name}`;
    const start = firstPgbossRelationSizes.get(key);
    if (!start) continue;
    for (const metric of ['total_bytes', 'heap_bytes', 'indexes_bytes']) {
      const startValue = numeric(start[metric]);
      const endValue = numeric(row[metric]);
      if (startValue !== null && endValue !== null) {
        deltas.push({ scope: 'primary_pgboss_relation_size', relation: key, metric, delta: endValue - startValue });
      }
    }
  }
  return deltas;
}

function renderCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value).replace(/\|/g, '\\|');
  return String(value).replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim();
}

function renderRows(headers: string[], rows: QueryResultRow[]): string[] {
  return [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${headers.map((header) => renderCell(row[header])).join(' | ')} |`),
  ];
}

function renderMarkdown(report: RuntimeDiagnostics): string {
  const last = report.snapshots[report.snapshots.length - 1]!;
  return [
    '# Ingestion Runtime DB Diagnostics',
    '',
    `Generated at: ${report.generatedAt}`,
    `Samples: ${report.snapshots.length}`,
    `Interval ms: ${report.intervalMs}`,
    `Tables: ${report.tables.join(', ')}`,
    '',
    '## Log DB Pool',
    '',
    '```json',
    JSON.stringify(last.logDbPool, null, 2),
    '```',
    '',
    '## Waiting Log DB Activity',
    '',
    ...renderRows(['pid', 'application_name', 'state', 'wait_event_type', 'wait_event', 'query_age', 'transaction_age', 'query_sample'], last.logDb.waitingActivity),
    '',
    '## Log DB Lock Waits',
    '',
    ...renderRows(['pid', 'application_name', 'locktype', 'mode', 'granted', 'schema_name', 'relation_name', 'query_age', 'query_sample'], last.logDb.locks),
    '',
    '## Log DB Table Stats',
    '',
    ...renderRows(['schemaname', 'relname', 'seq_scan', 'idx_scan', 'n_tup_ins', 'n_tup_upd', 'n_tup_del', 'n_live_tup', 'n_dead_tup'], last.logDb.relationStats),
    '',
    '## Log DB Relation Sizes',
    '',
    ...renderRows(['schema_name', 'relation_name', 'total_bytes', 'heap_bytes', 'indexes_bytes'], last.logDb.relationSizes),
    '',
    '## pg-boss Queues',
    '',
    ...renderRows(['name', 'policy', 'partition', 'notify', 'queued_count', 'retry_count', 'active_count', 'failed_count', 'total_count', 'oldest_pending_created_on'], last.primaryDb.pgbossQueues),
    '',
    '## Primary DB pg-boss Activity',
    '',
    ...renderRows(['pid', 'application_name', 'state', 'wait_event_type', 'wait_event', 'query_age', 'transaction_age', 'query_sample'], last.primaryDb.activity),
    '',
    '## Waiting Primary DB pg-boss Activity',
    '',
    ...renderRows(['pid', 'application_name', 'state', 'wait_event_type', 'wait_event', 'query_age', 'transaction_age', 'query_sample'], last.primaryDb.waitingActivity),
    '',
    '## Primary DB pg-boss Lock Waits',
    '',
    ...renderRows(['pid', 'application_name', 'locktype', 'mode', 'granted', 'schema_name', 'relation_name', 'query_age', 'query_sample'], last.primaryDb.locks),
    '',
    '## Primary DB pg-boss Table Stats',
    '',
    ...renderRows(['schemaname', 'relname', 'seq_scan', 'idx_scan', 'n_tup_ins', 'n_tup_upd', 'n_tup_del', 'n_live_tup', 'n_dead_tup'], last.primaryDb.pgbossRelationStats),
    '',
    '## Primary DB pg-boss Relation Sizes',
    '',
    ...renderRows(['schema_name', 'relation_name', 'total_bytes', 'heap_bytes', 'indexes_bytes'], last.primaryDb.pgbossRelationSizes),
    '',
    '## Deltas',
    '',
    ...renderRows(['scope', 'relation', 'metric', 'delta'], report.deltas),
    '',
    last.logDb.optionalStatsUnavailable.length > 0 ? '## Optional Stats Unavailable' : '',
    ...last.logDb.optionalStatsUnavailable.map((item) => `- ${item}`),
    ...last.primaryDb.optionalStatsUnavailable.map((item) => `- ${item}`),
    '',
  ].join('\n');
}

async function main(): Promise<void> {
  const config = parseArgs();
  const snapshots: RuntimeSnapshot[] = [];
  try {
    for (let i = 0; i < config.samples; i += 1) {
      if (i > 0 && config.intervalMs > 0) await sleep(config.intervalMs);
      snapshots.push(await collectSnapshot(config));
    }

    const report: RuntimeDiagnostics = {
      generatedAt: new Date().toISOString(),
      intervalMs: config.intervalMs,
      tables: config.tables,
      snapshots,
      deltas: computeDeltas(snapshots),
    };
    const output = config.format === 'markdown'
      ? renderMarkdown(report)
      : `${JSON.stringify(report, null, 2)}\n`;
    if (config.outPath) await writeFile(config.outPath, output, 'utf8');
    process.stdout.write(output);
  } finally {
    await logDB.close().catch(() => undefined);
    await closeDatabase().catch(() => undefined);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
