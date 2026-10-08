#!/usr/bin/env tsx
/**
 * Bootstrap PrimaryDB and LogDB by executing modular SQL schema files table-by-table.
 *
 * Replaces monolithic schema.sql execution with clean, ordered, file-by-file execution
 * directly from canonical modular schema directories under `database/primarydbv2/schema`
 * and `database/logdbv2/schema`.
 *
 * Key guarantees:
 *   - Topological dependency ordering within every domain (e.g. users before user_sessions,
 *     organizations before organization_members, projects before project_members, plans before prices).
 *   - Correct cross-domain order (views before functions, notification routes before alerting).
 *   - Deferred execution of 999_triggers.sql files until after all tables and functions exist.
 *   - Safe non-transactional statement handling for concurrent indexes.
 *   - Safe, non-destructive execution by default (IF NOT EXISTS), with optional --recreate / --drop mode.
 *   - Full synchronization with schema_migrations ledger table.
 */
import '../src/config/dns.js';
import fs from 'fs';
import { promises as fsp } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { config } from 'dotenv';
import { Pool, type PoolClient, type PoolConfig } from 'pg';
import {
  parsePostgresAddressFamily,
  withPostgresAddressFamily,
} from '../src/config/postgres-network.js';
import {
  resolvePostgresSslConfig,
  sanitizePostgresConnectionString,
} from '../src/config/postgres-ssl.js';

config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PRIMARY_SCHEMA_DIR = path.resolve(__dirname, '../database/primarydbv2/schema');
const PRIMARY_SEEDS_DIR = path.resolve(__dirname, '../database/primarydbv2/seeds');
const PRIMARY_MIGRATIONS_DIR = path.resolve(__dirname, '../database/primarydbv2/migrations');

const LOGDB_SCHEMA_DIR = path.resolve(__dirname, '../database/logdbv2/schema');
const LOGDB_SEEDS_DIR = path.resolve(__dirname, '../database/logdbv2/seeds');
const LOGDB_MIGRATIONS_DIR = path.resolve(__dirname, '../database/logdbv2/migrations');

// Strict cross-domain execution order
const PRIMARY_DOMAIN_ORDER = [
  '00_extensions',
  '01_schemas',
  '02_types',
  '03_reference',
  '04_user',
  '05_organization',
  '06_project',
  '07_billing',
  '08_connector',
  '10_notification', // notification routes must precede alert rules referencing them
  '09_alerting',
  '11_observability',
  '12_usage',
  '13_ai',
  '14_automation',
  '15_analytics',
  '16_security',
  '18_views',       // views must precede functions (e.g. get_effective_integer_feature queries v_effective_entitlements)
  '17_functions',
  '19_partitions',
  '21_comments',
];

const LOGDB_DOMAIN_ORDER = [
  '00_extensions',
  '01_types',
  '02_schema_notes',
  '03_lookup',
  '04_ingestion',
  '05_observability',
  '06_error_groups',
  '07_analytics',
  '08_connectors',
  '09_alerting',
  '10_ai',
  '11_outbox',
  '12_search',
  '13_geo',
  '14_retention',
  '15_functions',
];

interface Options {
  dryRun: boolean;
  recreate: boolean;
  yes: boolean;
  skipSeeds: boolean;
  target: 'both' | 'primary' | 'logdb';
}

interface StepFile {
  step: number;
  label: string;
  relativePath: string;
  fullPath: string;
}

interface FileDependencyInfo {
  file: string;
  relativePath: string;
  fullPath: string;
  createdTables: string[];
  refTables: string[];
}

function usage(): void {
  console.log(`
Bootstrap PrimaryDB and LogDB by creating tables and objects one-by-one from modular schema folders.

Usage:
  npm run db:bootstrap
  npm run db:bootstrap -- --only primary
  npm run db:bootstrap -- --only logdb
  npm run db:bootstrap -- --dry-run
  npm run db:bootstrap -- --recreate --yes
  npm run db:bootstrap -- --skip-seeds

Options:
  --dry-run         Print table-by-table execution sequence without executing.
  --only <target>   Execute only "primary", only "logdb", or "both" (default).
  --primary         Alias for --only primary
  --logdb           Alias for --only logdb
  --recreate, --drop
                    Drop and recreate schema 'public' before table creation.
  --yes, -y         Skip interactive confirmation when running with --recreate.
  --skip-seeds      Skip running seed files after schema creation.

Environment:
  DATABASE_URL       PrimaryDB PostgreSQL connection string.
  LOG_DB_PRIMARY     LogDB PostgreSQL connection string (or DATABASE_URL_LOG / LOG_DATABASE_URL).
`);
}

function parseOptions(args: string[]): Options {
  const options: Options = {
    dryRun: false,
    recreate: false,
    yes: false,
    skipSeeds: false,
    target: 'both',
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--recreate' || arg === '--drop') {
      options.recreate = true;
    } else if (arg === '--yes' || arg === '-y') {
      options.yes = true;
    } else if (arg === '--skip-seeds') {
      options.skipSeeds = true;
    } else if (arg === '--primary') {
      options.target = 'primary';
    } else if (arg === '--logdb' || arg === '--log') {
      options.target = 'logdb';
    } else if (arg === '--only') {
      const target = (args[i + 1] || '').toLowerCase();
      if (target !== 'primary' && target !== 'logdb' && target !== 'both') {
        throw new Error('Expected --only to be one of: primary, logdb, both');
      }
      options.target = target as 'both' | 'primary' | 'logdb';
      i += 1;
    } else if (arg === '--allow-existing') {
      // Retained for backward compatibility
      options.recreate = false;
    } else if (arg === '--help' || arg === '-h') {
      usage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

/**
 * Topologically sort SQL files within a single domain directory.
 * Ensures tables referenced by foreign keys or partitioned tables are ordered after their dependencies.
 */
function topologicalSortDomainFiles(domainDir: string, domainName: string): FileDependencyInfo[] {
  const rawFiles = fs
    .readdirSync(domainDir)
    .filter((f) => f.endsWith('.sql') && f !== '999_triggers.sql')
    .sort();

  const fileInfos: FileDependencyInfo[] = rawFiles.map((file) => {
    const fullPath = path.join(domainDir, file);
    const content = fs.readFileSync(fullPath, 'utf8');

    const createdTables: string[] = [];
    const tableRegex = /CREATE\s+(?:TEMP\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-zA-Z0-9_]+)/gi;
    let m: RegExpExecArray | null;
    while ((m = tableRegex.exec(content)) !== null) {
      createdTables.push(m[1].toLowerCase());
    }

    const refTables: string[] = [];
    const refRegex = /REFERENCES\s+([a-zA-Z0-9_]+)/gi;
    while ((m = refRegex.exec(content)) !== null) {
      refTables.push(m[1].toLowerCase());
    }

    const partOfRegex = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-zA-Z0-9_]+)\s+PARTITION\s+OF\s+([a-zA-Z0-9_]+)/gi;
    while ((m = partOfRegex.exec(content)) !== null) {
      createdTables.push(m[1].toLowerCase());
      refTables.push(m[2].toLowerCase());
    }

    const partParentRegex = /PARTITION\s+OF\s+([a-zA-Z0-9_]+)/gi;
    while ((m = partParentRegex.exec(content)) !== null) {
      refTables.push(m[1].toLowerCase());
    }

    return {
      file,
      relativePath: `${domainName}/${file}`.replace(/\\/g, '/'),
      fullPath,
      createdTables,
      refTables: [...new Set(refTables)],
    };
  });

  const sorted: FileDependencyInfo[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();

  function visit(info: FileDependencyInfo) {
    if (visited.has(info.file)) return;
    if (visiting.has(info.file)) {
      // Self-reference or cycle within domain; break gracefully
      return;
    }
    visiting.add(info.file);

    for (const other of fileInfos) {
      if (other.file === info.file) continue;
      if (info.refTables.some((t) => other.createdTables.includes(t))) {
        visit(other);
      }
    }

    visiting.delete(info.file);
    visited.add(info.file);
    sorted.push(info);
  }

  for (const info of fileInfos) {
    visit(info);
  }

  return sorted;
}

async function collectDomainFiles(
  baseDir: string,
  domainOrder: string[],
): Promise<{
  schemaFiles: StepFile[];
  triggerFiles: StepFile[];
}> {
  const schemaFiles: StepFile[] = [];
  const triggerFiles: StepFile[] = [];
  let counter = 1;

  for (const domain of domainOrder) {
    const domainDir = path.join(baseDir, domain);
    if (!fs.existsSync(domainDir)) continue;

    // 1. Sort domain files topologically
    const sortedInfos = topologicalSortDomainFiles(domainDir, domain);
    for (const info of sortedInfos) {
      schemaFiles.push({
        step: counter++,
        label: `[Table/Object] ${info.relativePath}`,
        relativePath: info.relativePath,
        fullPath: info.fullPath,
      });
    }

    // 2. Collect trigger files to execute at the end
    const triggerPath = path.join(domainDir, '999_triggers.sql');
    if (fs.existsSync(triggerPath)) {
      const relPath = `${domain}/999_triggers.sql`.replace(/\\/g, '/');
      triggerFiles.push({
        step: 0,
        label: `[Trigger] ${relPath}`,
        relativePath: relPath,
        fullPath: triggerPath,
      });
    }
  }

  // Assign sequential steps to deferred triggers
  for (const trig of triggerFiles) {
    trig.step = counter++;
  }

  return { schemaFiles, triggerFiles };
}

async function collectSeedFiles(seedsDir: string, startStep: number): Promise<StepFile[]> {
  const seedFiles: StepFile[] = [];
  if (!fs.existsSync(seedsDir)) return seedFiles;

  const entries = await fsp.readdir(seedsDir);
  const sqlFiles = entries.filter((e) => e.endsWith('.sql')).sort();
  let step = startStep;
  for (const file of sqlFiles) {
    const fullPath = path.join(seedsDir, file);
    seedFiles.push({
      step: step++,
      label: `[Seed] ${file}`,
      relativePath: `seeds/${file}`.replace(/\\/g, '/'),
      fullPath,
    });
  }
  return seedFiles;
}

function createPgPool(connectionString: string, label: string): Pool {
  const ssl = resolvePostgresSslConfig(connectionString, {
    databaseLabel: label,
  });

  const parsedFamily = parsePostgresAddressFamily(
    process.env.POSTGRES_ADDRESS_FAMILY || process.env.NODE_ADDRESS_FAMILY,
  );

  const poolConfig: PoolConfig = {
    connectionString: sanitizePostgresConnectionString(connectionString),
    ssl,
    max: 3,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 15000,
  };

  return new Pool(withPostgresAddressFamily(poolConfig, parsedFamily));
}

async function connectWithRetry(pool: Pool, maxAttempts = 6): Promise<PoolClient> {
  let attempt = 0;
  while (true) {
    try {
      return await pool.connect();
    } catch (err) {
      attempt++;
      if (attempt >= maxAttempts) throw err;
      const delay = Math.min(1000 * Math.pow(1.5, attempt), 5000);
      console.log(`  Waiting for database connection (attempt ${attempt}/${maxAttempts})...`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

async function dropAndRecreateSchema(client: PoolClient, dbName: string): Promise<void> {
  console.log(`\n▶ [${dbName}] Dropping and recreating schema 'public'...`);
  await client.query(`DROP TABLE IF EXISTS tmp_enterprise_billing_feature_seed;`).catch(() => {});
  await client.query(`
    DROP SCHEMA IF EXISTS public CASCADE;
    CREATE SCHEMA public;
    GRANT ALL ON SCHEMA public TO CURRENT_USER;
    GRANT ALL ON SCHEMA public TO public;
    COMMENT ON SCHEMA public IS 'standard public schema';
  `);
  console.log(`  ✔ Schema 'public' reset successfully.`);
}

async function syncSchemaMigrations(client: PoolClient, migrationsDir: string, dbName: string): Promise<void> {
  if (!fs.existsSync(migrationsDir)) return;

  const migrationFiles = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.up.sql'))
    .sort();

  if (migrationFiles.length === 0) return;

  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  for (const file of migrationFiles) {
    await client.query(
      `INSERT INTO schema_migrations (filename, applied_at) VALUES ($1, NOW()) ON CONFLICT (filename) DO NOTHING;`,
      [file],
    );
  }

  console.log(`  ✔ Synced ${migrationFiles.length} migration(s) into schema_migrations for ${dbName}.`);
}

async function runStepFiles(
  client: PoolClient | null,
  files: StepFile[],
  options: Options,
  dbName: string,
): Promise<void> {
  console.log(`\n------------------------------------------------------------`);
  console.log(`Executing ${files.length} modular schema files for ${dbName}`);
  console.log(`------------------------------------------------------------`);

  for (const item of files) {
    if (options.dryRun || !client) {
      console.log(`  [DRY RUN] Step ${String(item.step).padStart(3, ' ')}: ${item.label}`);
      continue;
    }

    const start = Date.now();
    const rawSql = await fsp.readFile(item.fullPath, 'utf8');
    const sql = rawSql.replace(/^\uFEFF/, '').trim();
    if (sql.length === 0) continue;

    const isNonTransactional = /CONCURRENTLY/i.test(sql);

    process.stdout.write(`  [${String(item.step).padStart(3, ' ')}/${files.length}] ${item.label}... `);

    try {
      if (isNonTransactional) {
        const statements = sql
          .split(';')
          .map((s) => s.trim())
          .filter((s) => s.length > 0 && s.replace(/--.*$/gm, '').trim().length > 0);
        for (const stmt of statements) {
          await client.query(stmt);
        }
      } else {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('COMMIT');
      }
      const elapsed = Date.now() - start;
      console.log(`✓ OK (${elapsed}ms)`);
    } catch (error: any) {
      if (!isNonTransactional) {
        await client.query('ROLLBACK').catch(() => {});
      }
      console.log(`FAILED!`);
      console.error(`\n[ERROR in ${item.relativePath}]:`);
      console.error(error.message || error);
      throw new Error(`Failed executing ${item.relativePath}: ${error.message}`);
    }
  }
}

async function bootstrapDatabase(
  target: 'primary' | 'logdb',
  options: Options,
): Promise<void> {
  const isPrimary = target === 'primary';
  const dbName = isPrimary ? 'PrimaryDB' : 'LogDB';
  const schemaDir = isPrimary ? PRIMARY_SCHEMA_DIR : LOGDB_SCHEMA_DIR;
  const seedsDir = isPrimary ? PRIMARY_SEEDS_DIR : LOGDB_SEEDS_DIR;
  const migrationsDir = isPrimary ? PRIMARY_MIGRATIONS_DIR : LOGDB_MIGRATIONS_DIR;
  const domainOrder = isPrimary ? PRIMARY_DOMAIN_ORDER : LOGDB_DOMAIN_ORDER;

  const connString = isPrimary
    ? process.env.DATABASE_URL
    : process.env.LOG_DB_PRIMARY || process.env.LOG_DATABASE_URL || process.env.DATABASE_URL_LOG;

  if (!options.dryRun && !connString) {
    throw new Error(
      `Missing connection string for ${dbName}. Required: ${
        isPrimary ? 'DATABASE_URL' : 'LOG_DB_PRIMARY / LOG_DATABASE_URL / DATABASE_URL_LOG'
      }`,
    );
  }

  // 1. Collect all schema files and triggers in topological order
  const { schemaFiles, triggerFiles } = await collectDomainFiles(schemaDir, domainOrder);

  // 2. Collect seed files
  const allCoreFiles = [...schemaFiles, ...triggerFiles];
  allCoreFiles.forEach((f, idx) => {
    f.step = idx + 1;
  });

  let seedFiles: StepFile[] = [];
  if (!options.skipSeeds) {
    seedFiles = await collectSeedFiles(seedsDir, allCoreFiles.length + 1);
  }

  const allExecutionFiles = [...allCoreFiles, ...seedFiles];

  console.log(`\n============================================================`);
  console.log(`[${dbName}] Prepared ${allExecutionFiles.length} files (${schemaFiles.length} tables/objects + ${triggerFiles.length} triggers + ${seedFiles.length} seeds)`);
  console.log(`Target: ${connString ? sanitizePostgresConnectionString(connString).replace(/\/\/([^:/@]+):[^@]*@/, '//$1:****@') : '(dry-run)'}`);
  console.log(`Mode:   ${options.recreate ? 'CLEAN RECREATION (DROP & REBUILD)' : 'IDEMPOTENT SCHEMA APPLY'}`);
  console.log(`============================================================`);

  if (options.dryRun) {
    await runStepFiles(null, allExecutionFiles, options, dbName);
    return;
  }

  const pool = createPgPool(connString!, dbName);
  const client = await connectWithRetry(pool);

  try {
    if (options.recreate) {
      await dropAndRecreateSchema(client, dbName);
    }
    await runStepFiles(client, allExecutionFiles, options, dbName);
    await syncSchemaMigrations(client, migrationsDir, dbName);

    // Verify object count
    const countRes = await client.query<{ count: string }>(`
      SELECT count(*)::text as count
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE';
    `);
    console.log(`\n✔ ${dbName} bootstrap completed successfully. Verified ${countRes.rows[0]?.count} public tables.`);
  } finally {
    client.release();
    await pool.end();
  }
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));

  console.log(`\n============================================================`);
  console.log(`Modular Database Schema Bootstrap Runner`);
  console.log(`Target: ${options.target.toUpperCase()} | DryRun: ${options.dryRun} | Recreate: ${options.recreate}`);
  console.log(`============================================================`);

  if (options.recreate && !options.yes && !options.dryRun) {
    console.error(`\n❌ Error: --recreate drops schema 'public' CASCADE. Pass --yes or -y to confirm.`);
    process.exit(1);
  }

  if (options.target === 'both' || options.target === 'primary') {
    await bootstrapDatabase('primary', options);
  }

  if (options.target === 'both' || options.target === 'logdb') {
    await bootstrapDatabase('logdb', options);
  }

  console.log(`\n✨ All requested database operations finished successfully.`);
}

main().catch((err) => {
  console.error('\n❌ Bootstrap failed:', err.message || err);
  process.exit(1);
});
