import '../src/config/dns.js';
import { Pool } from 'pg';
import {
  parsePostgresAddressFamily,
  withPostgresAddressFamily,
} from '../src/config/postgres-network.js';
import { config } from 'dotenv';
import { resolvePostgresSslConfig, sanitizePostgresConnectionString } from '../src/config/postgres-ssl.js';

config();

// Tables that MUST NEVER be truncated (Lookups, Schema migrations, Dictionaries, Configurations)
export const PRESERVED_TABLES = new Set([
  'logdb_migrations',
  'logdb_schema_notes',
  'organization_lookup',
  'project_lookup',
  'environment_lookup',
  'environment_sdk_config_lookup',
  'api_key_lookup',
  'release_lookup',
  'release_comparison',
  'geo_countries',
  'geo_locations',
  'geo_networks',
  'telemetry_dimensions_browser',
  'telemetry_dimensions_endpoint',
  'telemetry_dimensions_host',
  'telemetry_dimensions_os',
  'telemetry_dimensions_region',
  'telemetry_dimensions_release',
  'telemetry_dimensions_runtime',
  'telemetry_dimensions_service',
  'slo_definition_cache',
  'user_notification_preferences',
  'analytics_dashboards',
  'analytics_saved_queries',
  'analytics_watermarks',
]);

function printHelp(): void {
  console.log(`
Truncate all event and telemetry storing tables in Log DB.
Preserves schema definitions, migrations history, lookups, and configuration tables.

Usage:
  npm run db:truncate:logdb:events -- --dry-run
  npm run db:truncate:logdb:events -- --yes

Options:
  --dry-run   Show preview of tables and row counts without deleting anything (default)
  --yes       Actually execute TRUNCATE TABLE ... RESTART IDENTITY CASCADE
  --help      Show this help text
`);
}

async function main() {
  const args = new Set(process.argv.slice(2));
  if (args.has('--help') || args.has('-h')) {
    printHelp();
    process.exit(0);
  }

  const isLive = args.has('--yes') || args.has('--execute');
  const connectionString = process.env.LOG_DB_PRIMARY;
  if (!connectionString) throw new Error('LOG_DB_PRIMARY is not set in environment or .env');

  const pool = new Pool(withPostgresAddressFamily({
    connectionString: sanitizePostgresConnectionString(connectionString),
    max: 1,
    connectionTimeoutMillis: 20000,
    ssl: resolvePostgresSslConfig(connectionString, {
      enabled: true,
      rejectUnauthorized: false,
    }),
  }, parsePostgresAddressFamily(process.env.DB_FAMILY)));

  try {
    const client = await pool.connect();

    // Fetch all root tables in public schema
    const res = await client.query(`
      SELECT 
        c.relname AS table_name,
        c.relkind
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind IN ('r', 'p')
        AND c.relispartition = false
      ORDER BY c.relname;
    `);

    const allRootTables = res.rows.map(r => r.table_name);
    const tablesToTruncate: string[] = [];
    const tablesPreserved: string[] = [];

    for (const tableName of allRootTables) {
      if (PRESERVED_TABLES.has(tableName)) {
        tablesPreserved.push(tableName);
      } else {
        tablesToTruncate.push(tableName);
      }
    }

    console.log(`\n======================================================`);
    console.log(`LOG DB EVENT TABLE TRUNCATION AUDIT`);
    console.log(`======================================================`);
    console.log(`Mode: ${isLive ? 'LIVE (Destructive)' : 'DRY-RUN (Preview only)'}`);
    console.log(`Total root tables in Log DB: ${allRootTables.length}`);
    console.log(`Tables targeted for truncation: ${tablesToTruncate.length}`);
    console.log(`Preserved lookup/system tables: ${tablesPreserved.length}`);

    console.log(`\n--- PRESERVED SYSTEM/LOOKUP TABLES (${tablesPreserved.length}) ---`);
    for (const t of tablesPreserved) {
      const c = await client.query(`SELECT count(*) as count FROM "${t}"`);
      console.log(`  [PRESERVED] ${t}: ${c.rows[0].count} rows`);
    }

    console.log(`\n--- TARGET EVENT TABLES STATUS ---`);
    const tablesWithRows: { name: string; count: number }[] = [];
    for (const t of tablesToTruncate) {
      const c = await client.query(`SELECT count(*) as count FROM "${t}"`);
      const count = parseInt(c.rows[0].count, 10);
      if (count > 0) {
        tablesWithRows.push({ name: t, count });
        console.log(`  >>> [HAS DATA] ${t}: ${count} rows`);
      }
    }
    console.log(`Total event tables currently containing data: ${tablesWithRows.length}`);
    for (const item of tablesWithRows) {
      console.log(`    * ${item.name} (${item.count} rows)`);
    }

    if (!isLive) {
      console.log(`\n[DRY RUN] No tables were truncated. Pass --yes to execute.`);
      client.release();
      return;
    }

    console.log(`\n======================================================`);
    console.log(`EXECUTING TRUNCATE ON ${tablesToTruncate.length} EVENT TABLES`);
    console.log(`======================================================`);

    const chunkSize = 25;
    for (let i = 0; i < tablesToTruncate.length; i += chunkSize) {
      const chunk = tablesToTruncate.slice(i, i + chunkSize);
      const quoted = chunk.map(t => `"public"."${t}"`).join(', ');
      const sql = `TRUNCATE TABLE ${quoted} RESTART IDENTITY CASCADE;`;
      console.log(`Truncating chunk ${Math.floor(i / chunkSize) + 1}/${Math.ceil(tablesToTruncate.length / chunkSize)} (${chunk.length} tables)...`);
      await client.query(sql);
    }

    console.log(`\nAll truncate statements executed successfully!`);

    console.log(`\n======================================================`);
    console.log(`VERIFYING ROW COUNTS AFTER TRUNCATION`);
    console.log(`======================================================`);

    let anyRemaining = false;
    for (const item of tablesWithRows) {
      const c = await client.query(`SELECT count(*) as count FROM "${item.name}"`);
      const count = parseInt(c.rows[0].count, 10);
      console.log(`  ${item.name}: ${count} rows (was ${item.count})`);
      if (count > 0) anyRemaining = true;
    }

    if (anyRemaining) {
      console.error(`\nFAILED: Some tables still have rows!`);
      process.exit(1);
    } else {
      console.log(`\nSUCCESS: All event tables successfully truncated to 0 rows!`);
    }

    console.log(`\nVerifying preserved tables are intact:`);
    for (const t of tablesPreserved) {
      const c = await client.query(`SELECT count(*) as count FROM "${t}"`);
      console.log(`  [PRESERVED OK] ${t}: ${c.rows[0].count} rows`);
    }

    client.release();
  } finally {
    await pool.end();
  }
}

main().catch(err => {
  console.error('Truncation error:', err);
  process.exit(1);
});
