/**
 * Read-only PostgreSQL catalog audit for ingestion hot-path tables.
 *
 * The final ingestion optimization evidence needs current table, index,
 * constraint, trigger, and partition state from the benchmark database. This
 * script captures that state without changing schema or data.
 */
import { writeFile } from 'fs/promises';
import { pool as primaryPool, closeDatabase } from '../src/config/database.js';
import { logDB } from '../src/config/log-database.js';

type OutputFormat = 'markdown' | 'json';

interface AuditConfig {
  format: OutputFormat;
  outPath: string | null;
  tables: string[];
  includeFunctions: boolean;
}

interface TableRow {
  schema_name: string;
  table_name: string;
  relkind: string;
  row_estimate: number;
  bytes: string;
  partitioned: boolean;
}

interface IndexRow {
  schema_name: string;
  table_name: string;
  index_name: string;
  index_def: string;
}

interface ConstraintRow {
  schema_name: string;
  table_name: string;
  constraint_name: string;
  constraint_type: string;
  constraint_def: string;
}

interface TriggerRow {
  schema_name: string;
  table_name: string;
  trigger_name: string;
  enabled: string;
  timing: string;
  events: string[];
  function_name: string;
  definition: string;
  function_source: string | null;
}

interface PartitionRow {
  parent_schema: string;
  parent_table: string;
  child_schema: string;
  child_table: string;
}

interface TimescaleRow {
  hypertable_schema: string;
  hypertable_name: string;
  compression_enabled: boolean | null;
}

interface QueueRow {
  name: string;
  policy: string;
  partition: boolean;
  table_name: string;
  notify: boolean;
  queued_count: number;
  ready_count: number;
  deferred_count: number;
  active_count: number;
  failed_count: number;
  total_count: number;
}

interface AuditOutput {
  generatedAt: string;
  logDatabase: string;
  primaryDatabase: string;
  tablesRequested: string[];
  tables: TableRow[];
  indexes: IndexRow[];
  constraints: ConstraintRow[];
  triggers: TriggerRow[];
  partitions: PartitionRow[];
  timescaleHypertables: TimescaleRow[];
  primaryAuthIndexes: IndexRow[];
  pgbossTables: TableRow[];
  pgbossQueues: QueueRow[];
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

function tableFilterSql(alias: string): string {
  return `(${alias}.nspname = 'public' AND ${alias === 'n' ? 'c' : alias}.relname = ANY($1::text[]))
      OR (${alias}.nspname || '.' || ${alias === 'n' ? 'c' : alias}.relname = ANY($1::text[]))`;
}

function usage(): void {
  console.error(`Usage:
  npm run ingestion:db:audit -- [--format markdown|json] [--out audit.md] [--tables table_a,table_b] [--no-functions]
`);
  process.exit(2);
}

function parseArgs(): AuditConfig {
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
  const tables = typeof args.tables === 'string'
    ? args.tables.split(',').map((table) => table.trim()).filter(Boolean)
    : defaultTables;
  if (tables.length === 0) usage();

  return {
    format: args.format === 'json' ? 'json' : 'markdown',
    outPath: typeof args.out === 'string' ? args.out : null,
    tables,
    includeFunctions: args['no-functions'] !== true,
  };
}

function renderCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.join(', ').replace(/\|/g, '\\|');
  return String(value).replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim();
}

function renderMarkdown(audit: AuditOutput): string {
  const lines = [
    '# Ingestion Database Schema Audit',
    '',
    `Generated at: ${audit.generatedAt}`,
    `Log database: ${audit.logDatabase}`,
    `Primary database: ${audit.primaryDatabase}`,
    `Tables requested: ${audit.tablesRequested.join(', ')}`,
    '',
    '## Tables',
    '',
    '| Schema | Table | Kind | Partitioned | Row estimate | Bytes |',
    '| --- | --- | --- | --- | ---: | ---: |',
    ...audit.tables.map((row) => `| ${[
      row.schema_name,
      row.table_name,
      row.relkind,
      row.partitioned,
      row.row_estimate,
      row.bytes,
    ].map(renderCell).join(' | ')} |`),
    '',
    '## Indexes',
    '',
    '| Schema | Table | Index | Definition |',
    '| --- | --- | --- | --- |',
    ...audit.indexes.map((row) => `| ${[
      row.schema_name,
      row.table_name,
      row.index_name,
      row.index_def,
    ].map(renderCell).join(' | ')} |`),
    '',
    '## Constraints',
    '',
    '| Schema | Table | Constraint | Type | Definition |',
    '| --- | --- | --- | --- | --- |',
    ...audit.constraints.map((row) => `| ${[
      row.schema_name,
      row.table_name,
      row.constraint_name,
      row.constraint_type,
      row.constraint_def,
    ].map(renderCell).join(' | ')} |`),
    '',
    '## Triggers',
    '',
    '| Schema | Table | Trigger | Enabled | Timing | Events | Function | Definition |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...audit.triggers.map((row) => `| ${[
      row.schema_name,
      row.table_name,
      row.trigger_name,
      row.enabled,
      row.timing,
      row.events,
      row.function_name,
      row.definition,
    ].map(renderCell).join(' | ')} |`),
    '',
    '## Partitions',
    '',
    '| Parent schema | Parent table | Child schema | Child table |',
    '| --- | --- | --- | --- |',
    ...audit.partitions.map((row) => `| ${[
      row.parent_schema,
      row.parent_table,
      row.child_schema,
      row.child_table,
    ].map(renderCell).join(' | ')} |`),
    '',
    '## Timescale Hypertables',
    '',
    '| Schema | Hypertable | Compression enabled |',
    '| --- | --- | --- |',
    ...audit.timescaleHypertables.map((row) => `| ${[
      row.hypertable_schema,
      row.hypertable_name,
      row.compression_enabled,
    ].map(renderCell).join(' | ')} |`),
    '',
    '## Primary Auth Indexes',
    '',
    '| Schema | Table | Index | Definition |',
    '| --- | --- | --- | --- |',
    ...audit.primaryAuthIndexes.map((row) => `| ${[
      row.schema_name,
      row.table_name,
      row.index_name,
      row.index_def,
    ].map(renderCell).join(' | ')} |`),
    '',
    '## pg-boss Tables',
    '',
    '| Schema | Table | Kind | Partitioned | Row estimate | Bytes |',
    '| --- | --- | --- | --- | ---: | ---: |',
    ...audit.pgbossTables.map((row) => `| ${[
      row.schema_name,
      row.table_name,
      row.relkind,
      row.partitioned,
      row.row_estimate,
      row.bytes,
    ].map(renderCell).join(' | ')} |`),
    '',
    '## pg-boss Queues',
    '',
    '| Queue | Policy | Partitioned | Table | Notify | Queued | Ready | Deferred | Active | Failed | Total |',
    '| --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...audit.pgbossQueues.map((row) => `| ${[
      row.name,
      row.policy,
      row.partition,
      row.table_name,
      row.notify,
      row.queued_count,
      row.ready_count,
      row.deferred_count,
      row.active_count,
      row.failed_count,
      row.total_count,
    ].map(renderCell).join(' | ')} |`),
    '',
  ];

  if (audit.triggers.some((trigger) => trigger.function_source)) {
    lines.push('## Trigger Functions', '');
    for (const trigger of audit.triggers) {
      if (!trigger.function_source) continue;
      lines.push(`### ${trigger.function_name}`, '', '```sql', trigger.function_source.trim(), '```', '');
    }
  }

  return `${lines.join('\n')}\n`;
}

async function collectAudit(config: AuditConfig): Promise<AuditOutput> {
  await logDB.connect();
  const pool = logDB.getPrimaryPool();

  const database = await pool.query<{ current_database: string }>('SELECT current_database()');
  const primaryDatabase = await primaryPool.query<{ current_database: string }>('SELECT current_database()');

  const tables = await pool.query<TableRow>(
    `
    SELECT
      n.nspname AS schema_name,
      c.relname AS table_name,
      c.relkind::text AS relkind,
      c.reltuples::bigint AS row_estimate,
      pg_total_relation_size(c.oid)::text AS bytes,
      c.relkind = 'p' AS partitioned
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE (${tableFilterSql('n')})
      AND c.relkind IN ('r', 'p')
    ORDER BY n.nspname, c.relname
    `,
    [config.tables],
  );

  const indexes = await pool.query<IndexRow>(
    `
    SELECT
      schemaname AS schema_name,
      tablename AS table_name,
      indexname AS index_name,
      indexdef AS index_def
    FROM pg_indexes
    WHERE (schemaname = 'public' AND tablename = ANY($1::text[]))
       OR (schemaname || '.' || tablename = ANY($1::text[]))
    ORDER BY schemaname, tablename, indexname
    `,
    [config.tables],
  );

  const constraints = await pool.query<ConstraintRow>(
    `
    SELECT
      n.nspname AS schema_name,
      c.relname AS table_name,
      con.conname AS constraint_name,
      con.contype::text AS constraint_type,
      pg_get_constraintdef(con.oid, true) AS constraint_def
    FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE (${tableFilterSql('n')})
    ORDER BY n.nspname, c.relname, con.conname
    `,
    [config.tables],
  );

  const triggers = await pool.query<TriggerRow>(
    `
    SELECT
      n.nspname AS schema_name,
      c.relname AS table_name,
      t.tgname AS trigger_name,
      t.tgenabled::text AS enabled,
      CASE
        WHEN (t.tgtype & 2) = 2 THEN 'BEFORE'
        WHEN (t.tgtype & 64) = 64 THEN 'INSTEAD OF'
        ELSE 'AFTER'
      END AS timing,
      ARRAY_REMOVE(ARRAY[
        CASE WHEN (t.tgtype & 4) = 4 THEN 'INSERT' END,
        CASE WHEN (t.tgtype & 8) = 8 THEN 'DELETE' END,
        CASE WHEN (t.tgtype & 16) = 16 THEN 'UPDATE' END,
        CASE WHEN (t.tgtype & 32) = 32 THEN 'TRUNCATE' END
      ], NULL)::text[] AS events,
      p.proname AS function_name,
      pg_get_triggerdef(t.oid, true) AS definition,
      CASE WHEN $2::boolean THEN pg_get_functiondef(p.oid) ELSE NULL END AS function_source
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_proc p ON p.oid = t.tgfoid
    WHERE NOT t.tgisinternal
      AND (${tableFilterSql('n')})
    ORDER BY n.nspname, c.relname, t.tgname
    `,
    [config.tables, config.includeFunctions],
  );

  const partitions = await pool.query<PartitionRow>(
    `
    SELECT
      pn.nspname AS parent_schema,
      pc.relname AS parent_table,
      cn.nspname AS child_schema,
      cc.relname AS child_table
    FROM pg_inherits i
    JOIN pg_class pc ON pc.oid = i.inhparent
    JOIN pg_namespace pn ON pn.oid = pc.relnamespace
    JOIN pg_class cc ON cc.oid = i.inhrelid
    JOIN pg_namespace cn ON cn.oid = cc.relnamespace
    WHERE (pn.nspname = 'public' AND pc.relname = ANY($1::text[]))
       OR (pn.nspname || '.' || pc.relname = ANY($1::text[]))
    ORDER BY pn.nspname, pc.relname, cn.nspname, cc.relname
    `,
    [config.tables],
  );

  const timescaleAvailable = await pool.query<{ exists: boolean }>(
    `SELECT to_regclass('timescaledb_information.hypertables') IS NOT NULL AS exists`,
  );
  let timescaleHypertables = { rows: [] as TimescaleRow[] };
  if (timescaleAvailable.rows[0]?.exists) {
    const columns = await pool.query<{ column_name: string }>(
      `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'timescaledb_information'
        AND table_name = 'hypertables'
      `,
    );
    const columnNames = new Set(columns.rows.map((row) => row.column_name));
    const schemaColumn = columnNames.has('hypertable_schema') ? 'hypertable_schema' : 'schema_name';
    const tableColumn = columnNames.has('hypertable_name') ? 'hypertable_name' : 'table_name';
    const compressionExpr = columnNames.has('compression_enabled')
      ? 'compression_enabled'
      : columnNames.has('compression_state')
        ? 'compression_state IS NOT NULL'
        : 'NULL::boolean';
    timescaleHypertables = await pool.query<TimescaleRow>(
      `
      SELECT
        ${schemaColumn} AS hypertable_schema,
        ${tableColumn} AS hypertable_name,
        ${compressionExpr} AS compression_enabled
      FROM timescaledb_information.hypertables
      WHERE ${schemaColumn} = 'public'
        AND ${tableColumn} = ANY($1::text[])
      ORDER BY ${schemaColumn}, ${tableColumn}
      `,
      [config.tables],
    );
  }

  const pgbossTables = await primaryPool.query<TableRow>(
    `
    SELECT
      n.nspname AS schema_name,
      c.relname AS table_name,
      c.relkind::text AS relkind,
      c.reltuples::bigint AS row_estimate,
      pg_total_relation_size(c.oid)::text AS bytes,
      c.relkind = 'p' AS partitioned
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'pgboss'
      AND c.relname IN ('job', 'archive')
      AND c.relkind IN ('r', 'p')
    ORDER BY n.nspname, c.relname
    `,
  );

  const primaryAuthIndexes = await primaryPool.query<IndexRow>(
    `
    SELECT
      schemaname AS schema_name,
      tablename AS table_name,
      indexname AS index_name,
      indexdef AS index_def
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename IN ('project_api_keys', 'organization_subscriptions', 'project_api_key_rotations')
      AND indexname IN (
        'idx_project_api_keys_public_key',
        'uq_project_api_keys_public_key',
        'idx_org_subscriptions_live_latest',
        'idx_project_api_key_rotations_grace_lookup'
      )
    ORDER BY schemaname, tablename, indexname
    `,
  );

  const pgbossQueueTable = await primaryPool.query<{ exists: boolean }>(
    `SELECT to_regclass('pgboss.queue') IS NOT NULL AS exists`,
  );
  let pgbossQueues = { rows: [] as QueueRow[] };
  if (pgbossQueueTable.rows[0]?.exists) {
    pgbossQueues = await primaryPool.query<QueueRow>(
      `
      SELECT
        name,
        policy,
        partition,
        table_name,
        notify,
        queued_count,
        ready_count,
        deferred_count,
        active_count,
        failed_count,
        total_count
      FROM pgboss.queue
      WHERE name LIKE 'ingest.%'
      ORDER BY name
      `,
    );
  }

  return {
    generatedAt: new Date().toISOString(),
    logDatabase: database.rows[0]?.current_database ?? '',
    primaryDatabase: primaryDatabase.rows[0]?.current_database ?? '',
    tablesRequested: config.tables,
    tables: tables.rows,
    indexes: indexes.rows,
    constraints: constraints.rows,
    triggers: triggers.rows,
    partitions: partitions.rows,
    timescaleHypertables: timescaleHypertables.rows,
    primaryAuthIndexes: primaryAuthIndexes.rows,
    pgbossTables: pgbossTables.rows,
    pgbossQueues: pgbossQueues.rows,
  };
}

async function main(): Promise<void> {
  const config = parseArgs();
  try {
    const audit = await collectAudit(config);
    const output = config.format === 'json'
      ? `${JSON.stringify(audit, null, 2)}\n`
      : renderMarkdown(audit);
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
