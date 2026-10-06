import { config } from 'dotenv';
config();
import pg from 'pg';
const { Pool } = pg;
import * as fs from 'fs';

async function auditDb(name: string, connStr: string | undefined, canonicalPath: string) {
  console.log(`\n======================================================`);
  console.log(`AUDITING LIVE ${name}`);
  console.log(`======================================================`);
  
  if (!connStr) {
    console.log(`No connection string for ${name}`);
    return;
  }

  const pool = new Pool({
    connectionString: connStr,
    ssl: { rejectUnauthorized: false }
  });

  const client = await pool.connect();
  try {
    // 1. Live tables
    const tablesRes = await client.query(`
      SELECT c.relname AS table_name, c.relkind
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
      ORDER BY c.relname;
    `);
    const liveTables = new Set(tablesRes.rows.map((r: any) => r.table_name.toLowerCase()));
    console.log(`Live base tables/partitioned tables in public: ${liveTables.size}`);

    // 2. Live indexes
    const indexesRes = await client.query(`
      SELECT i.relname AS index_name, t.relname AS table_name
      FROM pg_index ix
      JOIN pg_class t ON t.oid = ix.indrelid
      JOIN pg_class i ON i.oid = ix.indexrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = 'public'
      ORDER BY i.relname;
    `);
    const liveIndexes = new Set(indexesRes.rows.map((r: any) => r.index_name.toLowerCase()));
    console.log(`Live indexes in public: ${liveIndexes.size}`);

    // 3. Parse canonical schema
    const canonicalSql = fs.readFileSync(canonicalPath, 'utf8');
    const canonicalTables = new Set<string>();
    const tableRegex = /CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+([a-zA-Z0-9_."]+)/gi;
    let m;
    while ((m = tableRegex.exec(canonicalSql)) !== null) {
      canonicalTables.add(m[1].toLowerCase().replace(/"/g, '').replace('public.', ''));
    }

    const canonicalIndexes = new Set<string>();
    const idxRegex = /CREATE\s+(?:UNIQUE\s+)?INDEX(?:\s+CONCURRENTLY)?(?:\s+IF\s+NOT\s+EXISTS)?\s+([a-zA-Z0-9_]+)/gi;
    while ((m = idxRegex.exec(canonicalSql)) !== null) {
      canonicalIndexes.add(m[1].toLowerCase());
    }

    console.log(`Canonical schema tables: ${canonicalTables.size}`);
    console.log(`Canonical schema indexes: ${canonicalIndexes.size}`);

    // Compare tables
    const missingInLiveTables: string[] = [];
    for (const t of canonicalTables) {
      if (!liveTables.has(t)) missingInLiveTables.push(t);
    }
    const extraInLiveTables: string[] = [];
    for (const t of liveTables) {
      if (!canonicalTables.has(t)) extraInLiveTables.push(t);
    }

    console.log(`\nTable Comparison:`);
    console.log(`- Canonical tables missing in live DB: ${missingInLiveTables.length}`);
    if (missingInLiveTables.length > 0) {
      console.log(`  Sample missing: ${missingInLiveTables.slice(0, 10).join(', ')}`);
    }
    console.log(`- Extra tables in live DB (e.g. partition ranges / migrations / system): ${extraInLiveTables.length}`);
    if (extraInLiveTables.length > 0) {
      console.log(`  Sample extra: ${extraInLiveTables.slice(0, 10).join(', ')}`);
    }

    // Compare key indexes
    console.log(`\nKey Indexes Check:`);
    if (name === 'PrimaryDB') {
      const checkKeys = [
        'idx_user_sessions_purge',
        'uq_email_verifications_user_email_purpose',
        'uq_project_api_keys_public_key',
        'idx_project_api_keys_public_key',
        'idx_sessions_purge'
      ];
      for (const k of checkKeys) {
        console.log(`  ${k}: live=${liveIndexes.has(k)}, canonical=${canonicalIndexes.has(k)}`);
      }
    } else {
      const checkKeys = [
        'idx_events_spans_org_trace_time_asc',
        'idx_events_spans_org_span_id',
        'idx_events_spans_slow_db',
        'idx_events_spans_db_collection',
        'idx_events_spans_org_session_time',
        'idx_events_requests_payload_gin',
        'idx_events_spans_attributes_gin',
        'idx_events_requests_tenant_env_time'
      ];
      for (const k of checkKeys) {
        console.log(`  ${k}: live=${liveIndexes.has(k)}, canonical=${canonicalIndexes.has(k)}`);
      }
    }

  } finally {
    client.release();
    await pool.end();
  }
}

async function main() {
  await auditDb('PrimaryDB', process.env.DATABASE_URL, 'database/primarydbv2/schema.sql');
  await auditDb('LogDB', process.env.LOG_DB_PRIMARY, 'database/logdbv2/schema.sql');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
