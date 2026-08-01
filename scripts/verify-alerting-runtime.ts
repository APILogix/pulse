#!/usr/bin/env tsx
/**
 * Verify the alerting redesign's database ownership and Increment 1 schema.
 *
 * Architecture: docs/alerting-redesign/adr/0006-database-ownership.md
 *               docs/alerting-redesign/07-migration-plan.md §9 (verification gates)
 *               docs/alerting-redesign/PROGRESS.md (Increment 1 → Outstanding)
 *
 * Reports, for BOTH databases:
 *   - which database each pool is actually attached to
 *   - whether telemetry (events_requests) is visible from each pool  → audit finding B1
 *   - whether the Increment 1 objects exist (enums, tables, indexes, partitions)
 *   - primary migration ledger: applied vs pending
 *   - Log DB migration ledger: each new file recorded exactly once
 *
 * Usage:
 *   npx tsx scripts/verify-alerting-runtime.ts
 *   npx tsx scripts/verify-alerting-runtime.ts --assert    # exit 1 when a gate fails
 *
 * Read-only. It never creates, alters, or drops anything.
 */
import { Pool } from 'pg';
import { env } from '../src/config/env.js';
import { listMigrationFiles } from './lib/migrations.js';
import { findLogDbMigrationFiles } from '../src/shared/logdb/migrations.js';

const ASSERT = process.argv.includes('--assert');

const LOGDB_INCREMENT1_FILES = [
  '00_shared/002_alerting_v2_types.up.sql',
  '05_connectors_runtime/002_connector_runtime_v2.up.sql',
  '06_alert_runtime/002_alert_runtime_v2.up.sql',
];

const ALERT_RUNTIME_TABLES = [
  'alert_events_v2',
  'alert_event_state',
  'alert_event_history_v2',
  'alert_rule_eval_state',
  'alert_notification_jobs',
  'alert_notification_ledger',
  'alert_delivery_attempts_v2',
  'alert_acknowledgments_v2',
  'alert_metrics_v2',
  'alert_dead_letter_events_v2',
];

const CONNECTOR_RUNTIME_TABLES = [
  'connector_deliveries_v2',
  'connector_delivery_attempts_v2',
  'connector_health_checks_v2',
  'connector_test_runs_v2',
  'connector_audit_logs_v2',
  'connector_dead_letters',
];

const LOGDB_ENUMS = [
  'notification_channel_kind',
  'alert_event_kind',
  'alert_state',
  'notification_job_status',
  'alert_usage_kind',
  'connector_delivery_status_v2',
];

const PRIMARY_GUARD_TABLES = ['connector_rate_buckets', 'connector_circuit_state'];

const failures: string[] = [];

function gate(ok: boolean, label: string, detail = ''): void {
  const mark = ok ? 'PASS' : 'FAIL';
  console.log(`  [${mark}] ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(label);
}

function redact(connectionString: string): string {
  try {
    const url = new URL(connectionString);
    return `${url.host}/${url.pathname.replace(/^\//, '')}`;
  } catch {
    return '(unparseable)';
  }
}

async function tablesPresent(pool: Pool, names: string[]): Promise<Set<string>> {
  const result = await pool.query<{ name: string }>(
    `SELECT t AS name FROM unnest($1::text[]) AS t WHERE to_regclass(t) IS NOT NULL`,
    [names],
  );
  return new Set(result.rows.map((row) => row.name));
}

async function enumsPresent(pool: Pool, names: string[]): Promise<Set<string>> {
  const result = await pool.query<{ typname: string }>(
    `SELECT typname FROM pg_type WHERE typname = ANY($1::text[])`,
    [names],
  );
  return new Set(result.rows.map((row) => row.typname));
}

async function main(): Promise<void> {
  const primary = new Pool({ connectionString: env.DATABASE_URL, max: 2 });
  const logdbUrl = env.LOG_DB_PRIMARY ?? env.DATABASE_URL;
  const logdb = new Pool({ connectionString: logdbUrl, max: 2 });

  try {
    console.log('='.repeat(72));
    console.log('Alerting runtime verification');
    console.log('='.repeat(72));
    console.log(`primary : ${redact(env.DATABASE_URL)}`);
    console.log(`log db  : ${redact(logdbUrl)}`);
    console.log();

    const [primaryDb, logDb] = await Promise.all([
      primary.query<{ db: string }>('SELECT current_database() AS db'),
      logdb.query<{ db: string }>('SELECT current_database() AS db'),
    ]);
    const primaryName = primaryDb.rows[0]!.db;
    const logName = logDb.rows[0]!.db;

    console.log('ADR-0006 database ownership');
    const separate = primaryName !== logName;
    console.log(`  primary database = ${primaryName}`);
    console.log(`  log db database  = ${logName}`);
    console.log(`  separate databases: ${separate ? 'YES' : 'no (Log DB falls back to primary)'}`);

    // Audit finding B1: telemetry must be visible from the pool the alert runtime uses.
    const telemetryInPrimary = (await tablesPresent(primary, ['events_requests'])).size === 1;
    const telemetryInLogDb = (await tablesPresent(logdb, ['events_requests'])).size === 1;
    console.log(`  events_requests visible from primary pool: ${telemetryInPrimary}`);
    console.log(`  events_requests visible from log db pool : ${telemetryInLogDb}`);
    gate(
      telemetryInLogDb,
      'telemetry is visible from the Log DB pool (alerting runtime pool)',
      telemetryInLogDb ? '' : 'apply Log DB migrations',
    );
    if (separate && !telemetryInPrimary) {
      console.log(
        '  NOTE: audit finding B1 is ACTIVE — any evaluator still reading events_* through the\n'
        + '        control-plane pool sees no telemetry and can never fire. This is exactly what\n'
        + '        the ADR-0006 boot assertion now prevents.',
      );
    }
    console.log();

    console.log('Increment 1 — Log DB objects (L1 enums)');
    const enums = await enumsPresent(logdb, LOGDB_ENUMS);
    for (const name of LOGDB_ENUMS) gate(enums.has(name), `enum ${name}`);
    console.log();

    console.log('Increment 1 — Log DB objects (L3 alert runtime)');
    const alertTables = await tablesPresent(logdb, ALERT_RUNTIME_TABLES);
    for (const name of ALERT_RUNTIME_TABLES) gate(alertTables.has(name), `table ${name}`);
    console.log();

    console.log('Increment 1 — Log DB objects (L6 connector runtime)');
    const connectorTables = await tablesPresent(logdb, CONNECTOR_RUNTIME_TABLES);
    for (const name of CONNECTOR_RUNTIME_TABLES) gate(connectorTables.has(name), `table ${name}`);
    console.log();

    console.log('Increment 1 — partitioned tables have a DEFAULT partition');
    const partitions = await logdb.query<{ parent: string; defaults: string }>(
      `SELECT c.relname AS parent,
              COUNT(*) FILTER (WHERE p.relname LIKE '%\\_default')::text AS defaults
         FROM pg_class c
         JOIN pg_partitioned_table pt ON pt.partrelid = c.oid
         LEFT JOIN pg_inherits i ON i.inhparent = c.oid
         LEFT JOIN pg_class p ON p.oid = i.inhrelid
        WHERE c.relname = ANY($1::text[])
        GROUP BY c.relname
        ORDER BY c.relname`,
      [[...ALERT_RUNTIME_TABLES, ...CONNECTOR_RUNTIME_TABLES]],
    );
    for (const row of partitions.rows) {
      gate(Number(row.defaults) >= 1, `${row.parent} has a DEFAULT partition`);
    }
    console.log();

    console.log('Increment 1 — idempotency indexes (audit C3)');
    const expectedIndexes = [
      'uq_alert_events_v2_idem',
      'uq_alert_notification_jobs_idem',
      'uq_alert_delivery_attempts_v2_idem',
      'uq_alert_metrics_v2_bucket',
      'uq_connector_deliveries_v2_idem',
      'uq_connector_deliveries_v2_correlation',
      'uq_connector_delivery_attempts_v2_idem',
    ];
    const indexes = await logdb.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE indexname = ANY($1::text[])`,
      [expectedIndexes],
    );
    const indexSet = new Set(indexes.rows.map((row) => row.indexname));
    for (const name of expectedIndexes) gate(indexSet.has(name), `index ${name}`);
    console.log();

    console.log('Increment 1 — primary DB objects (P7 global guards)');
    const guardTables = await tablesPresent(primary, PRIMARY_GUARD_TABLES);
    for (const name of PRIMARY_GUARD_TABLES) gate(guardTables.has(name), `table ${name}`);
    console.log();

    console.log('Log DB migration ledger');
    const ledgerExists = (await tablesPresent(logdb, ['logdb_migrations'])).size === 1;
    if (!ledgerExists) {
      gate(false, 'logdb_migrations ledger exists');
    } else {
      const ledger = await logdb.query<{ filename: string; count: string }>(
        `SELECT filename, COUNT(*)::text AS count
           FROM logdb_migrations
          WHERE filename = ANY($1::text[])
          GROUP BY filename`,
        [LOGDB_INCREMENT1_FILES],
      );
      const counts = new Map(ledger.rows.map((row) => [row.filename, Number(row.count)]));
      for (const file of LOGDB_INCREMENT1_FILES) {
        const count = counts.get(file) ?? 0;
        gate(count === 1, `${file} recorded exactly once`, `count=${count}`);
      }
      const total = await logdb.query<{ count: string }>(
        'SELECT COUNT(*)::text AS count FROM logdb_migrations',
      );
      console.log(`  total Log DB migrations applied: ${total.rows[0]!.count}`);
      const allLogDbFiles = await findLogDbMigrationFiles();
      console.log(`  Log DB migration files on disk : ${allLogDbFiles.length}`);
    }
    console.log();

    console.log('Primary migration ledger');
    const primaryLedgerExists = (await tablesPresent(primary, ['schema_migrations'])).size === 1;
    if (!primaryLedgerExists) {
      console.log('  schema_migrations does not exist — no primary migrations have been applied');
    } else {
      const applied = await primary.query<{ filename: string }>(
        'SELECT filename FROM schema_migrations',
      );
      const appliedSet = new Set(applied.rows.map((row) => row.filename));
      const files = await listMigrationFiles();
      const pending = files.filter((file) => !appliedSet.has(file));
      console.log(`  applied: ${appliedSet.size}`);
      console.log(`  on disk: ${files.length}`);
      console.log(`  pending: ${pending.length}`);
      if (pending.length > 0) {
        for (const file of pending.slice(0, 20)) console.log(`    - ${file}`);
        if (pending.length > 20) console.log(`    … and ${pending.length - 20} more`);
      }
    }
    console.log();

    console.log('='.repeat(72));
    if (failures.length === 0) {
      console.log('All gates passed.');
    } else {
      console.log(`${failures.length} gate(s) failed:`);
      for (const failure of failures) console.log(`  - ${failure}`);
    }
    console.log('='.repeat(72));
  } finally {
    await primary.end();
    await logdb.end();
  }

  if (ASSERT && failures.length > 0) process.exit(1);
}

main().catch((error) => {
  console.error('Verification failed to run:', error);
  process.exit(1);
});
