#!/usr/bin/env tsx
/**
 * Run Modular Schema Runner for PrimaryDB and LogDB.
 *
 * Replaces monolithic schema.sql execution by running individual table and object
 * schema files one-by-one in topological and cross-domain dependency order directly
 * from modular schema directories:
 *   - database/primarydbv2/schema (or database/primarydb/schema)
 *   - database/logdbv2/schema (or database/logdb/schema)
 *
 * Usage:
 *   tsx scripts/run-modular-schema.ts
 *   tsx scripts/run-modular-schema.ts --dry-run
 *   tsx scripts/run-modular-schema.ts --only primary
 *   tsx scripts/run-modular-schema.ts --only logdb
 *   tsx scripts/run-modular-schema.ts --recreate --yes
 *   tsx scripts/run-modular-schema.ts --skip-seeds
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
const ROOT_DIR = path.resolve(__dirname, '..');

// ============================================================================
// Directory Resolution Helpers
// ============================================================================

export function resolveDatabasePath(candidates: string[]): string {
  for (const candidate of candidates) {
    const resolved = path.isAbsolute(candidate) ? candidate : path.resolve(ROOT_DIR, candidate);
    if (fs.existsSync(resolved)) {
      return resolved;
    }
  }
  return path.resolve(ROOT_DIR, candidates[0]);
}

export function getDatabaseDirectories(target: 'primary' | 'logdb') {
  if (target === 'primary') {
    const baseDir = resolveDatabasePath([
      'database/primarydbv2',
      'database/primarydb',
      'database/primary_db',
    ]);
    return {
      baseDir,
      schemaDir: path.join(baseDir, 'schema'),
      seedsDir: path.join(baseDir, 'seeds'),
      migrationsDir: path.join(baseDir, 'migrations'),
    };
  } else {
    const baseDir = resolveDatabasePath([
      'database/logdbv2',
      'database/logdb',
      'database/log_db',
    ]);
    return {
      baseDir,
      schemaDir: path.join(baseDir, 'schema'),
      seedsDir: path.join(baseDir, 'seeds'),
      migrationsDir: path.join(baseDir, 'migrations'),
    };
  }
}

// ============================================================================
// Domain Execution Order
// ============================================================================

export const PRIMARY_DOMAIN_ORDER: readonly string[] = [
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
  '18_views',       // views must precede functions querying them
  '17_functions',
  '19_partitions',
  '20_seeders',
  '21_comments',
];

export const LOGDB_DOMAIN_ORDER: readonly string[] = [
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

// ============================================================================
// Types
// ============================================================================

export type StepType = 'schema' | 'trigger' | 'seed';

export interface ExecutionStep {
  step: number;
  type: StepType;
  domain: string;
  filename: string;
  relativePath: string;
  fullPath: string;
}

export interface FileDependencyInfo {
  file: string;
  domain: string;
  relativePath: string;
  fullPath: string;
  createdTables: string[];
  refTables: string[];
}

export interface RunnerOptions {
  dryRun: boolean;
  recreate: boolean;
  yes: boolean;
  skipSeeds: boolean;
  target: 'both' | 'primary' | 'logdb';
}

export interface DatabasePlan {
  dbLabel: 'PrimaryDB' | 'LogDB';
  target: 'primary' | 'logdb';
  connectionString: string | undefined;
  ledgerTable: string;
  migrationsDir: string;
  files: ExecutionStep[];
  schemaCount: number;
  triggerCount: number;
  seedCount: number;
}

// ============================================================================
// Topological Dependency Resolution
// ============================================================================

export function extractTableDependencies(filePath: string, domain: string, file: string): FileDependencyInfo {
  const content = fs.readFileSync(filePath, 'utf8');

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
    domain,
    relativePath: `${domain}/${file}`.replace(/\\/g, '/'),
    fullPath: filePath,
    createdTables,
    refTables: [...new Set(refTables)],
  };
}

export function topologicalSortDomainFiles(domainDir: string, domainName: string): FileDependencyInfo[] {
  if (!fs.existsSync(domainDir)) return [];

  const rawFiles = fs
    .readdirSync(domainDir)
    .filter((f) => f.endsWith('.sql') && f !== '999_triggers.sql')
    .sort();

  const fileInfos = rawFiles.map((file) =>
    extractTableDependencies(path.join(domainDir, file), domainName, file),
  );

  const sorted: FileDependencyInfo[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();

  function visit(info: FileDependencyInfo) {
    if (visited.has(info.file)) return;
    if (visiting.has(info.file)) {
      // Cycle or self-reference detected; break gracefully to avoid infinite loop
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

// ============================================================================
// Plan Builder
// ============================================================================

export function buildDatabasePlan(
  target: 'primary' | 'logdb',
  options: RunnerOptions,
): DatabasePlan {
  const isPrimary = target === 'primary';
  const dbLabel = isPrimary ? 'PrimaryDB' : 'LogDB';
  const dirs = getDatabaseDirectories(target);
  const preferredOrder = isPrimary ? PRIMARY_DOMAIN_ORDER : LOGDB_DOMAIN_ORDER;

  const connectionString = isPrimary
    ? process.env.DATABASE_URL || process.env.PRIMARY_DATABASE_URL
    : process.env.LOG_DB_PRIMARY || process.env.LOG_DATABASE_URL || process.env.DATABASE_URL_LOG || process.env.DATABASE_URL;

  const ledgerTable = isPrimary ? 'schema_migrations' : 'logdb_migrations';

  // Discover all domains present in schema directory
  const availableDomains = fs.existsSync(dirs.schemaDir)
    ? fs
        .readdirSync(dirs.schemaDir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
    : [];

  // Order domains according to preferred list, then append any additional domains found
  const orderedDomains: string[] = [];
  for (const domain of preferredOrder) {
    if (availableDomains.includes(domain)) {
      orderedDomains.push(domain);
    }
  }
  for (const domain of availableDomains.sort()) {
    if (!orderedDomains.includes(domain)) {
      orderedDomains.push(domain);
    }
  }

  const schemaFiles: ExecutionStep[] = [];
  const triggerFiles: ExecutionStep[] = [];
  const seedFiles: ExecutionStep[] = [];
  const executedSeedNames = new Set<string>();

  let counter = 1;

  // 1. Collect table and object schema files domain by domain
  for (const domain of orderedDomains) {
    const domainDir = path.join(dirs.schemaDir, domain);

    // If this is domain 20_seeders, treat files as seeds unless skipSeeds is requested
    if (domain === '20_seeders') {
      if (!options.skipSeeds) {
        const rawFiles = fs
          .readdirSync(domainDir)
          .filter((f) => f.endsWith('.sql'))
          .sort();
        for (const file of rawFiles) {
          executedSeedNames.add(file);
          seedFiles.push({
            step: 0,
            type: 'seed',
            domain,
            filename: file,
            relativePath: `${domain}/${file}`.replace(/\\/g, '/'),
            fullPath: path.join(domainDir, file),
          });
        }
      }
      continue;
    }

    // Topologically sort files in domain
    const sorted = topologicalSortDomainFiles(domainDir, domain);
    for (const item of sorted) {
      schemaFiles.push({
        step: counter++,
        type: 'schema',
        domain,
        filename: item.file,
        relativePath: item.relativePath,
        fullPath: item.fullPath,
      });
    }

    // Check for deferred triggers file
    const triggerPath = path.join(domainDir, '999_triggers.sql');
    if (fs.existsSync(triggerPath)) {
      triggerFiles.push({
        step: 0,
        type: 'trigger',
        domain,
        filename: '999_triggers.sql',
        relativePath: `${domain}/999_triggers.sql`.replace(/\\/g, '/'),
        fullPath: triggerPath,
      });
    }
  }

  // 2. Assign step numbers to deferred triggers (run after all tables & functions)
  for (const trig of triggerFiles) {
    trig.step = counter++;
  }

  // 3. Collect extra seed files from seedsDir (avoid duplicate files already in 20_seeders)
  if (!options.skipSeeds && fs.existsSync(dirs.seedsDir)) {
    const extraSeeds = fs
      .readdirSync(dirs.seedsDir)
      .filter((f) => f.endsWith('.sql') && !executedSeedNames.has(f))
      .sort();
    for (const file of extraSeeds) {
      seedFiles.push({
        step: 0,
        type: 'seed',
        domain: 'seeds',
        filename: file,
        relativePath: `seeds/${file}`.replace(/\\/g, '/'),
        fullPath: path.join(dirs.seedsDir, file),
      });
    }
  }

  // 4. Assign step numbers to seed files
  for (const seed of seedFiles) {
    seed.step = counter++;
  }

  const allFiles = [...schemaFiles, ...triggerFiles, ...seedFiles];

  return {
    dbLabel,
    target,
    connectionString,
    ledgerTable,
    migrationsDir: dirs.migrationsDir,
    files: allFiles,
    schemaCount: schemaFiles.length,
    triggerCount: triggerFiles.length,
    seedCount: seedFiles.length,
  };
}

// ============================================================================
// Database Operations
// ============================================================================

export function createPgPool(connectionString: string, label: string): Pool {
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

export async function connectWithRetry(pool: Pool, maxAttempts = 6): Promise<PoolClient> {
  let attempt = 0;
  while (true) {
    try {
      return await pool.connect();
    } catch (err: any) {
      attempt++;
      if (attempt >= maxAttempts) throw err;
      const delay = Math.min(1000 * Math.pow(1.5, attempt), 5000);
      console.log(`  Waiting for database connection (attempt ${attempt}/${maxAttempts})...`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

export async function dropAndRecreateSchema(client: PoolClient, dbName: string): Promise<void> {
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

export async function syncSchemaMigrations(
  client: PoolClient,
  migrationsDir: string,
  ledgerTable: string,
  dbName: string,
): Promise<void> {
  if (!fs.existsSync(migrationsDir)) return;

  const migrationFiles = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.up.sql'))
    .sort();

  if (migrationFiles.length === 0) return;

  await client.query(`
    CREATE TABLE IF NOT EXISTS ${ledgerTable} (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  for (const file of migrationFiles) {
    await client.query(
      `INSERT INTO ${ledgerTable} (filename, applied_at) VALUES ($1, NOW()) ON CONFLICT (filename) DO NOTHING;`,
      [file],
    );
  }

  console.log(`  ✔ Recorded ${migrationFiles.length} migration(s) in ${ledgerTable} for ${dbName}.`);
}

// ============================================================================
// One-by-One Execution Engine
// ============================================================================

export async function executePlan(
  plan: DatabasePlan,
  options: RunnerOptions,
): Promise<{ totalExecuted: number; elapsedMs: number }> {
  const { dbLabel, files, connectionString } = plan;
  const startTime = Date.now();

  console.log(`\n======================================================================`);
  console.log(`[${dbLabel}] Prepared ${files.length} modular files:`);
  console.log(`  - Tables & Objects : ${plan.schemaCount}`);
  console.log(`  - Deferred Triggers: ${plan.triggerCount}`);
  console.log(`  - Seeds & Catalogs : ${plan.seedCount}`);
  console.log(`Target: ${connectionString ? sanitizePostgresConnectionString(connectionString).replace(/\/\/([^:/@]+):[^@]*@/, '//$1:****@') : '(dry-run)'}`);
  console.log(`Mode:   ${options.recreate ? 'CLEAN RECREATION (DROP & REBUILD)' : 'IDEMPOTENT TABLE-BY-TABLE APPLY'}`);
  console.log(`======================================================================`);

  if (options.dryRun) {
    console.log(`\n--- Dry Run Sequence for ${dbLabel} ---`);
    for (const item of files) {
      const typeTag = item.type === 'trigger' ? '[Trigger]' : item.type === 'seed' ? '[Seed]   ' : '[Table]  ';
      console.log(`  ${String(item.step).padStart(3, ' ')}/ ${files.length} ${typeTag} ${item.relativePath}`);
    }
    return { totalExecuted: files.length, elapsedMs: Date.now() - startTime };
  }

  if (!connectionString) {
    throw new Error(`Missing database connection string for ${dbLabel}.`);
  }

  const pool = createPgPool(connectionString, dbLabel);
  const client = await connectWithRetry(pool);

  try {
    if (options.recreate) {
      await dropAndRecreateSchema(client, dbLabel);
    }

    console.log(`\nExecuting ${files.length} modular files one-by-one for ${dbLabel}:`);
    for (const item of files) {
      const stepStart = Date.now();
      const rawSql = await fsp.readFile(item.fullPath, 'utf8');
      const sql = rawSql.replace(/^\uFEFF/, '').trim();
      if (sql.length === 0) continue;

      const isNonTransactional = /CONCURRENTLY/i.test(sql);
      const typeTag = item.type === 'trigger' ? '[Trigger]' : item.type === 'seed' ? '[Seed]   ' : '[Table]  ';
      process.stdout.write(`  [${String(item.step).padStart(3, ' ')}/${files.length}] ${typeTag} ${item.relativePath}... `);

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
        const elapsed = Date.now() - stepStart;
        console.log(`✓ OK (${elapsed}ms)`);
      } catch (error: any) {
        if (!isNonTransactional) {
          await client.query('ROLLBACK').catch(() => {});
        }
        console.log(`FAILED!`);
        console.error(`\n------------------------------------------------------------`);
        console.error(`❌ FAILED executing ${item.relativePath} in ${dbLabel}:`);
        console.error(`Error: ${error.message || error}`);
        console.error(`Path:  ${item.fullPath}`);
        console.error(`------------------------------------------------------------\n`);
        throw new Error(`Failed executing ${item.relativePath}: ${error.message}`);
      }
    }

    await syncSchemaMigrations(client, plan.migrationsDir, plan.ledgerTable, dbLabel);

    // Verify created table count
    const countRes = await client.query<{ count: string }>(`
      SELECT count(*)::text as count
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE';
    `);

    const totalElapsed = Date.now() - startTime;
    console.log(`\n✔ ${dbLabel} completed successfully in ${totalElapsed}ms. Verified ${countRes.rows[0]?.count} public tables.`);
    return { totalExecuted: files.length, elapsedMs: totalElapsed };
  } finally {
    client.release();
    await pool.end();
  }
}

// ============================================================================
// CLI Argument Parsing
// ============================================================================

export function parseCliOptions(args: string[]): RunnerOptions {
  const options: RunnerOptions = {
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
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function printHelp(): void {
  console.log(`
Modular Database Schema Runner
Executes individual table and object schema files one-by-one under both PrimaryDB and LogDB.

Usage:
  tsx scripts/run-modular-schema.ts [options]
  npm run db:schema:run [options]

Options:
  --dry-run         Print table-by-table execution sequence without executing SQL.
  --only <target>   Execute only "primary", only "logdb", or "both" (default).
  --primary         Alias for --only primary
  --logdb           Alias for --only logdb
  --recreate, --drop
                    Drop and recreate schema 'public' before table creation.
  --yes, -y         Skip interactive confirmation when running with --recreate.
  --skip-seeds      Skip running seed files after schema creation.
  --help, -h        Display this help message.

Environment Variables:
  DATABASE_URL       PrimaryDB PostgreSQL connection string.
  LOG_DB_PRIMARY     LogDB PostgreSQL connection string (or DATABASE_URL_LOG / LOG_DATABASE_URL).
`);
}

// ============================================================================
// Main Entrypoint
// ============================================================================

export async function run(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2));

  console.log(`\n======================================================================`);
  console.log(`Modular Database Schema Runner (One-by-One Table Execution)`);
  console.log(`Target: ${options.target.toUpperCase()} | DryRun: ${options.dryRun} | Recreate: ${options.recreate}`);
  console.log(`======================================================================`);

  if (options.recreate && !options.yes && !options.dryRun) {
    console.error(`\n❌ Error: --recreate drops schema 'public' CASCADE. Pass --yes or -y to confirm.`);
    process.exit(1);
  }

  if (options.target === 'both' || options.target === 'primary') {
    const primaryPlan = buildDatabasePlan('primary', options);
    await executePlan(primaryPlan, options);
  }

  if (options.target === 'both' || options.target === 'logdb') {
    const logPlan = buildDatabasePlan('logdb', options);
    await executePlan(logPlan, options);
  }

  console.log(`\n✨ All requested database operations finished successfully.`);
}

// Auto-run when executed directly
const isDirectlyExecuted =
  process.argv[1] &&
  (process.argv[1].endsWith('run-modular-schema.ts') ||
    process.argv[1].endsWith('run-modular-schema.js'));

if (isDirectlyExecuted) {
  run().catch((err) => {
    console.error('\n❌ Execution failed:', err.message || err);
    process.exit(1);
  });
}
