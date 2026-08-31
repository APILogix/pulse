#!/usr/bin/env tsx
/**
 * Bootstrap fresh PrimaryDB v2 and LogDB v2 databases.
 *
 * This is a final-state baseline installer, not an incremental migration runner.
 * It refuses non-empty databases unless --allow-existing is supplied explicitly.
 */
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { config } from 'dotenv';
import { Pool, type PoolConfig } from 'pg';

config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PRIMARY_SCHEMA_PATH = path.resolve(
  __dirname,
  '../database/primarydbv2/migrations/000001_create_schema.up.sql',
);
const PRIMARY_SEEDS_DIR = path.resolve(__dirname, '../database/primarydbv2/seeds');
const LOGDB_SCHEMA_PATH = path.resolve(
  __dirname,
  '../database/logdbv2/migrations/000001_create_schema.up.sql',
);
const LOGDB_SEEDS_DIR = path.resolve(__dirname, '../database/logdbv2/seeds');

interface Options {
  dryRun: boolean;
  allowExisting: boolean;
}

interface SqlFile {
  name: string;
  path: string;
}

function usage(): void {
  console.log(`
Bootstrap clean PrimaryDB v2 and LogDB v2 schemas, then run their seed files.

Usage:
  npm run db:bootstrap:v2
  npm run db:bootstrap:v2 -- --dry-run
  npm run db:bootstrap:v2 -- --allow-existing

Options:
  --dry-run         List every SQL file without connecting or changing databases.
  --allow-existing  Permit application tables already present in either database.
                    Use only after confirming the v2 baseline is safe to apply.

Environment:
  DATABASE_URL       PrimaryDB v2 write connection.
  LOG_DB_PRIMARY     LogDB v2 write connection (never LOG_DB_REPLICA).
  LOG_DB_SSL_ENABLED Optional true/false override for LogDB SSL.
  LOG_DB_SSL_REJECT_UNAUTHORIZED Optional true/false; defaults to true.
`);
}

function parseOptions(args: string[]): Options {
  const options: Options = { dryRun: false, allowExisting: false };
  for (const arg of args) {
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--allow-existing') options.allowExisting = true;
    else if (arg === '--help' || arg === '-h') {
      usage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function redactConnectionString(value: string): string {
  try {
    const url = new URL(value);
    if (url.password) url.password = '***';
    return url.toString();
  } catch {
    return value.replace(/:\/\/([^:]+):([^@]+)@/, '://$1:***@');
  }
}

function parseBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  if (value.toLowerCase() === 'true') return true;
  if (value.toLowerCase() === 'false') return false;
  throw new Error(`Expected a boolean environment value, received ${value}`);
}

function resolvePrimarySsl(connectionString: string): PoolConfig['ssl'] {
  try {
    const sslMode = new URL(connectionString).searchParams.get('sslmode')?.toLowerCase();
    if (['require', 'verify-ca', 'verify-full'].includes(sslMode ?? '')) {
      return { rejectUnauthorized: sslMode !== 'require' };
    }
  } catch {
    // Let pg use its default when the connection string cannot be parsed.
  }
  return undefined;
}

function resolveLogDbSsl(connectionString: string): PoolConfig['ssl'] {
  const enabled = parseBoolean(process.env.LOG_DB_SSL_ENABLED);
  const rejectUnauthorized = parseBoolean(process.env.LOG_DB_SSL_REJECT_UNAUTHORIZED) ?? true;
  if (enabled !== undefined) return enabled ? { rejectUnauthorized } : false;

  try {
    const sslMode = new URL(connectionString).searchParams.get('sslmode')?.toLowerCase();
    if (['require', 'verify-ca', 'verify-full', 'allow'].includes(sslMode ?? '')) {
      return { rejectUnauthorized };
    }
  } catch {
    // Let pg use its default when the connection string cannot be parsed.
  }
  return false;
}

async function readSql(filePath: string): Promise<string> {
  return (await fs.readFile(filePath, 'utf8')).replace(/^\uFEFF/, '');
}

async function listSqlFiles(directory: string): Promise<SqlFile[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.sql'))
    .map((entry) => ({ name: entry.name, path: path.join(directory, entry.name) }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

async function assertEmptyDatabase(pool: Pool, label: string, allowExisting: boolean): Promise<void> {
  if (allowExisting) return;
  const result = await pool.query<{ table_name: string }>(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = current_schema()
      AND table_type = 'BASE TABLE'
      AND table_name NOT IN (
        'schema_migrations', 'migrations', 'logdb_migrations', 'flyway_schema_history',
        'goose_db_version', 'knex_migrations', 'typeorm_migrations', '_prisma_migrations',
        'databasechangelog', 'databasechangeloglock'
      )
    ORDER BY table_name
  `);
  if (result.rows.length > 0) {
    throw new Error(
      `${label} is not empty (${result.rows.map((row) => row.table_name).join(', ')}). ` +
        'Refusing to apply a consolidated v2 baseline. Use a fresh database, or pass --allow-existing only after a backup and review.',
    );
  }
}

async function applyPrimary(
  pool: Pool,
  schemaSql: string,
  seedFiles: SqlFile[],
): Promise<void> {
  const client = await pool.connect();
  try {
    console.log(`Applying PrimaryDB v2 schema: ${PRIMARY_SCHEMA_PATH}`);
    await client.query('BEGIN');
    try {
      await client.query(schemaSql);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }

    for (const file of seedFiles) {
      const sql = await readSql(file.path);
      if (sql.trim().length === 0) continue;
      console.log(`Running PrimaryDB v2 seed: ${file.name}`);
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
  } finally {
    client.release();
  }
}

async function applyLogDb(pool: Pool, schemaSql: string, seedFiles: SqlFile[]): Promise<void> {
  const client = await pool.connect();
  try {
    // The consolidated LogDB schema has embedded transaction boundaries. Do not add an outer one.
    console.log(`Applying LogDB v2 schema: ${LOGDB_SCHEMA_PATH}`);
    await client.query(schemaSql);

    for (const file of seedFiles) {
      const sql = await readSql(file.path);
      if (sql.trim().length === 0) continue;
      console.log(`Running LogDB v2 seed: ${file.name}`);
      await client.query(sql);
    }
  } finally {
    client.release();
  }
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const primaryUrl = process.env.DATABASE_URL;
  const logDbUrl = process.env.LOG_DB_PRIMARY;
  if (!primaryUrl) throw new Error('DATABASE_URL is required for PrimaryDB v2 bootstrap');
  if (!logDbUrl) throw new Error('LOG_DB_PRIMARY is required for LogDB v2 bootstrap');

  const [primarySchema, logDbSchema, primarySeeds, logDbSeeds] = await Promise.all([
    readSql(PRIMARY_SCHEMA_PATH),
    readSql(LOGDB_SCHEMA_PATH),
    listSqlFiles(PRIMARY_SEEDS_DIR),
    listSqlFiles(LOGDB_SEEDS_DIR),
  ]);

  console.log('Primary database:', redactConnectionString(primaryUrl));
  console.log('Log database:', redactConnectionString(logDbUrl));
  console.log(`PrimaryDB v2 seeds (${primarySeeds.length}): ${primarySeeds.map((file) => file.name).join(', ')}`);
  console.log(`LogDB v2 seeds (${logDbSeeds.length}): ${logDbSeeds.map((file) => file.name).join(', ')}`);

  if (options.dryRun) {
    console.log('Dry run complete; no database connections were opened.');
    return;
  }

  const primaryPool = new Pool({ connectionString: primaryUrl, ssl: resolvePrimarySsl(primaryUrl), max: 1 });
  const logDbPool = new Pool({ connectionString: logDbUrl, ssl: resolveLogDbSsl(logDbUrl), max: 1 });
  try {
    await assertEmptyDatabase(primaryPool, 'PrimaryDB', options.allowExisting);
    await assertEmptyDatabase(logDbPool, 'LogDB', options.allowExisting);
    await applyPrimary(primaryPool, primarySchema, primarySeeds);
    await applyLogDb(logDbPool, logDbSchema, logDbSeeds);
    console.log('PrimaryDB v2 and LogDB v2 bootstrap completed successfully.');
  } finally {
    await Promise.all([primaryPool.end(), logDbPool.end()]);
  }
}

main().catch((error: unknown) => {
  console.error('V2 database bootstrap failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
