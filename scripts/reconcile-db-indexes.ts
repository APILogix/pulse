#!/usr/bin/env tsx
/**
 * Reconcile a LIVE PrimaryDB / LogDB with the canonical modular schema files
 * for the Tiger-Data-style index optimizations.
 *
 * Why this exists:
 *   `npm run db:bootstrap` is idempotent (CREATE ... IF NOT EXISTS). That is safe,
 *   but it can never DROP an index that was removed from a schema file, and it
 *   never rebuilds an existing index whose options changed (e.g. BRIN
 *   pages_per_range). On a database that already exists, the removed indexes keep
 *   costing write amplification until they are dropped explicitly.
 *
 *   This is NOT a migration file. Index definitions that must exist are read
 *   directly from the canonical schema files under database/*v2/schema, so the
 *   schema files stay the single source of truth.
 *
 * Safety:
 *   - Default mode is a DRY RUN that only reports the live state and the plan.
 *   - `--apply` executes. Regular tables use CREATE/DROP INDEX CONCURRENTLY (no
 *     write blocking). Partitioned parents do not support CONCURRENTLY, so a
 *     plain statement is used (short lock; BRIN builds are cheap).
 *   - lock_timeout is bounded so a busy table fails fast instead of queueing writers.
 *   - Before dropping, the script checks the index is not backing a constraint.
 *
 * Usage:
 *   npm run db:reconcile:indexes                 # dry run, both DBs
 *   npm run db:reconcile:indexes -- --apply      # execute, both DBs
 *   npm run db:reconcile:indexes -- --only logdb --apply
 */
import '../src/config/dns.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from 'dotenv';
import { Pool, type PoolClient } from 'pg';
import { parsePostgresAddressFamily, withPostgresAddressFamily } from '../src/config/postgres-network.js';
import { resolvePostgresSslConfig, sanitizePostgresConnectionString } from '../src/config/postgres-ssl.js';

config({ quiet: true });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PRIMARY_SCHEMA = path.resolve(__dirname, '../database/primarydbv2/schema');
const LOG_SCHEMA = path.resolve(__dirname, '../database/logdbv2/schema');

interface EnsureIndex {
  name: string;
  /** Schema file (relative to the schema dir) holding the canonical definition. */
  file: string;
  /** Optional reloption that must be present, e.g. pages_per_range=128. */
  requiredOption?: string;
}

interface Plan {
  label: 'PrimaryDB' | 'LogDB';
  schemaDir: string;
  connEnv: string[];
  /** Indexes removed from the canonical schema (redundant / duplicate / low selectivity). */
  drop: string[];
  /** Indexes that must exist exactly as defined in the canonical schema. */
  ensure: EnsureIndex[];
  /** Tables to ANALYZE after changes so the planner sees the new index set. */
  analyze: string[];
}

const PLANS: Plan[] = [
  {
    label: 'PrimaryDB',
    schemaDir: PRIMARY_SCHEMA,
    connEnv: ['DATABASE_URL'],
    drop: [
      'idx_cap_plan',
      'idx_cap_coupon',
      'idx_plan_prices_active',
      'uq_connector_credential_key',
      'idx_credentials_connector',
      'uq_oauth_state',
      'idx_alert_delivery_attempts_event_created',
      'idx_audit_logs_created_at',
    ],
    ensure: [
      { name: 'idx_project_api_keys_auth_covering', file: '06_project/001_create_project_api_keys.sql' },
    ],
    analyze: [
      'project_api_keys', 'coupon_applicable_plans', 'plan_prices', 'connector_credentials',
      'connector_oauth_states', 'alert_delivery_attempts', 'audit_logs',
    ],
  },
  {
    label: 'LogDB',
    schemaDir: LOG_SCHEMA,
    connEnv: ['LOG_DB_PRIMARY', 'LOG_DATABASE_URL', 'DATABASE_URL_LOG'],
    drop: [
      // events_requests
      'idx_events_requests_org_time',
      'idx_events_requests_org_env_time',
      // events_errors
      'idx_events_errors_tenant_env_time',
      'idx_events_errors_org_time',
      'idx_events_errors_org_env_direct_time',
      'idx_events_errors_group',
      'idx_events_errors_fingerprint_time',
      'idx_events_errors_severity',
      'idx_events_errors_status',
      'idx_events_errors_handled',
      'idx_events_errors_method',
      'idx_events_errors_release_time',
      // events_spans
      'idx_events_spans_org_time',
      'idx_events_spans_org_env_direct_time',
      'idx_events_spans_span',
      'idx_events_spans_request',
      'idx_events_spans_session',
      'idx_events_spans_user',
      'idx_events_spans_tenant',
      'idx_events_spans_kind',
      'idx_events_spans_db_time',
      'idx_events_spans_host_time',
      'idx_events_spans_release_time',
      'idx_events_spans_trace_time',
      'idx_events_spans_parent_time',
      'idx_events_spans_type_time',
      'idx_events_spans_status_time',
    ],
    ensure: [
      { name: 'idx_events_requests_occurred_brin', file: '05_observability/001_create_events_requests.sql', requiredOption: 'pages_per_range=128' },
      { name: 'idx_events_errors_occurred_brin', file: '05_observability/002_create_events_errors.sql', requiredOption: 'pages_per_range=128' },
      { name: 'idx_events_spans_occurred_brin', file: '05_observability/005_create_events_spans.sql', requiredOption: 'pages_per_range=128' },
      { name: 'idx_telemetry_outbox_fast_claim', file: '11_outbox/001_create_telemetry_outbox.sql' },
    ],
    analyze: ['events_requests', 'events_errors', 'events_spans', 'telemetry_outbox'],
  },
];

function parseArgs(argv: string[]): { apply: boolean; only: 'both' | 'primary' | 'logdb' } {
  let apply = false;
  let only: 'both' | 'primary' | 'logdb' = 'both';
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--apply') apply = true;
    else if (a === '--dry-run') apply = false;
    else if (a === '--only') {
      const v = (argv[i + 1] ?? '').toLowerCase();
      if (v === 'primary' || v === 'logdb' || v === 'both') only = v;
      else throw new Error('--only must be primary | logdb | both');
      i += 1;
    } else throw new Error(`Unknown argument: ${a}`);
  }
  return { apply, only };
}

function readIndexStatement(schemaDir: string, file: string, name: string): { sql: string; table: string } {
  const content = fs.readFileSync(path.join(schemaDir, file), 'utf8');
  const re = new RegExp(`CREATE\\s+(?:UNIQUE\\s+)?INDEX\\s+IF\\s+NOT\\s+EXISTS\\s+${name}\\b[\\s\\S]*?;`, 'i');
  const match = content.match(re);
  if (!match) throw new Error(`Canonical definition for ${name} not found in ${file}`);
  const table = match[0].match(/\bON\s+(?:ONLY\s+)?([a-zA-Z0-9_."]+)/i)?.[1]?.replace(/"/g, '');
  if (!table) throw new Error(`Could not determine table for ${name}`);
  return { sql: match[0].trim().replace(/;$/, ''), table };
}

function createPool(connectionString: string, label: string): Pool {
  return new Pool(withPostgresAddressFamily({
    connectionString: sanitizePostgresConnectionString(connectionString),
    ssl: resolvePostgresSslConfig(connectionString, { databaseLabel: label }),
    max: 1,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 30_000,
    keepAlive: true,
  }, parsePostgresAddressFamily(process.env.POSTGRES_ADDRESS_FAMILY || process.env.NODE_ADDRESS_FAMILY)));
}

async function connectWithRetry(pool: Pool, attempts = 12): Promise<PoolClient> {
  for (let i = 1; ; i += 1) {
    try {
      return await pool.connect();
    } catch (err) {
      if (i >= attempts) throw err;
      console.log(`  Waiting for database connection (attempt ${i}/${attempts})...`);
      await new Promise((r) => setTimeout(r, Math.min(1000 * 1.5 ** i, 5000)));
    }
  }
}

interface LiveIndex {
  relkind: string; // 'i' regular, 'I' partitioned
  table: string;
  table_relkind: string;
  reloptions: string[] | null;
  constraint_name: string | null;
  size: string;
}

async function liveIndex(client: PoolClient, name: string): Promise<LiveIndex | null> {
  const res = await client.query<LiveIndex>(
    `SELECT ic.relkind::text AS relkind,
            tc.relname AS table,
            tc.relkind::text AS table_relkind,
            ic.reloptions,
            con.conname AS constraint_name,
            pg_size_pretty(COALESCE(
              (SELECT sum(pg_relation_size(i.inhrelid)) FROM pg_inherits i WHERE i.inhparent = ic.oid), 0
            ) + pg_relation_size(ic.oid)) AS size
       FROM pg_class ic
       JOIN pg_namespace n ON n.oid = ic.relnamespace AND n.nspname = 'public'
       JOIN pg_index x ON x.indexrelid = ic.oid
       JOIN pg_class tc ON tc.oid = x.indrelid
       LEFT JOIN pg_constraint con ON con.conindid = ic.oid
      WHERE ic.relname = $1`,
    [name],
  );
  return res.rows[0] ?? null;
}

async function tableRelkind(client: PoolClient, table: string): Promise<string | null> {
  const res = await client.query<{ relkind: string }>(
    `SELECT c.relkind::text AS relkind FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
      WHERE c.relname = $1`,
    [table],
  );
  return res.rows[0]?.relkind ?? null;
}

async function run(client: PoolClient, sql: string, apply: boolean): Promise<void> {
  console.log(`    ${apply ? 'EXEC' : 'PLAN'}: ${sql.replace(/\s+/g, ' ')}`);
  if (apply) await client.query(sql);
}

async function reconcile(plan: Plan, apply: boolean): Promise<{ dropped: number; created: number; skipped: number }> {
  const conn = plan.connEnv.map((k) => process.env[k]).find(Boolean);
  if (!conn) throw new Error(`${plan.label}: missing connection string (${plan.connEnv.join(' / ')})`);

  console.log(`\n============================================================`);
  console.log(`${plan.label} — ${apply ? 'APPLY' : 'DRY RUN'}`);
  console.log(`============================================================`);

  const pool = createPool(conn, plan.label);
  const client = await connectWithRetry(pool);
  const stats = { dropped: 0, created: 0, skipped: 0 };
  try {
    // Fail fast instead of queueing ingestion writers behind our lock.
    await client.query(`SET lock_timeout = '10s'; SET statement_timeout = 0;`);

    console.log(`\n  [1/3] Redundant indexes to drop (${plan.drop.length})`);
    for (const name of plan.drop) {
      const idx = await liveIndex(client, name);
      if (!idx) {
        console.log(`    ✓ ${name}: already absent`);
        stats.skipped += 1;
        continue;
      }
      if (idx.constraint_name) {
        console.log(`    ! ${name}: backs constraint ${idx.constraint_name} — left untouched`);
        stats.skipped += 1;
        continue;
      }
      console.log(`    - ${name} on ${idx.table} (${idx.size}${idx.relkind === 'I' ? ', partitioned' : ''})`);
      const concurrently = idx.relkind === 'i' ? 'CONCURRENTLY ' : '';
      await run(client, `DROP INDEX ${concurrently}IF EXISTS public.${name}`, apply);
      stats.dropped += 1;
    }

    console.log(`\n  [2/3] Canonical indexes to ensure (${plan.ensure.length})`);
    for (const want of plan.ensure) {
      const { sql, table } = readIndexStatement(plan.schemaDir, want.file, want.name);
      const relkind = await tableRelkind(client, table);
      if (!relkind) {
        console.log(`    ! ${want.name}: table ${table} does not exist — run db:bootstrap first`);
        stats.skipped += 1;
        continue;
      }
      const idx = await liveIndex(client, want.name);
      const optionOk = !want.requiredOption
        || (idx?.reloptions ?? []).some((o) => o.replace(/\s/g, '') === want.requiredOption);
      if (idx && optionOk) {
        console.log(`    ✓ ${want.name}: present and matches canonical options`);
        stats.skipped += 1;
        continue;
      }
      const partitioned = relkind === 'p';
      if (idx && !optionOk) {
        console.log(`    ~ ${want.name}: present with options ${JSON.stringify(idx.reloptions)} — rebuilding with ${want.requiredOption}`);
        await run(client, `DROP INDEX ${idx.relkind === 'i' ? 'CONCURRENTLY ' : ''}IF EXISTS public.${want.name}`, apply);
      } else {
        console.log(`    + ${want.name}: missing — creating on ${table}${partitioned ? ' (partitioned)' : ''}`);
      }
      const createSql = partitioned
        ? sql
        : sql.replace(/CREATE\s+(UNIQUE\s+)?INDEX\s+IF\s+NOT\s+EXISTS/i, (_m, u) => `CREATE ${u ?? ''}INDEX CONCURRENTLY IF NOT EXISTS`);
      await run(client, createSql, apply);
      stats.created += 1;
    }

    console.log(`\n  [3/3] Refresh planner statistics`);
    for (const table of plan.analyze) {
      if (!(await tableRelkind(client, table))) continue;
      await run(client, `ANALYZE public.${table}`, apply);
    }
  } finally {
    client.release();
    await pool.end();
  }
  console.log(`\n  ${plan.label} summary: dropped=${stats.dropped} created/rebuilt=${stats.created} unchanged=${stats.skipped}`);
  return stats;
}

async function main(): Promise<void> {
  const { apply, only } = parseArgs(process.argv.slice(2));
  const selected = PLANS.filter((p) => only === 'both' || (only === 'primary' ? p.label === 'PrimaryDB' : p.label === 'LogDB'));
  for (const plan of selected) await reconcile(plan, apply);
  console.log(apply
    ? '\n✔ Live databases reconciled with canonical schema indexes.'
    : '\n✔ Dry run complete. Re-run with --apply to execute.');
}

main().catch((err) => {
  console.error('\n✖ Index reconciliation failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
