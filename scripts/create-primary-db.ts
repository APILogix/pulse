import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { config } from 'dotenv';
import { Pool, type PoolConfig } from 'pg';

config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_SCHEMA_PATH = path.resolve(
  __dirname,
  '../src/db/postgres/primary_db_draft/schema.sql',
);

interface CliOptions {
  schemaPath: string;
  dryRun: boolean;
  reset: boolean;
  noTransaction: boolean;
}

function sqlContext(sql: string, position: number, radius = 220): string {
  const start = Math.max(0, position - radius);
  const end = Math.min(sql.length, position + radius);
  return sql
    .slice(start, end)
    .replace(/\r/g, '')
    .split('\n')
    .map((line, index) => `${String(index + 1).padStart(3, '0')}: ${line}`)
    .join('\n');
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    schemaPath: DEFAULT_SCHEMA_PATH,
    dryRun: false,
    reset: false,
    noTransaction: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--schema') {
      const value = argv[i + 1];
      if (!value) throw new Error('--schema requires a file path');
      options.schemaPath = path.resolve(value);
      i += 1;
      continue;
    }
    if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    }
    if (arg === '--reset') {
      options.reset = true;
      continue;
    }
    if (arg === '--no-transaction') {
      options.noTransaction = true;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function printHelp(): void {
  console.log(`
Create a fresh primary PostgreSQL database from primary_db_draft/schema.sql.

Usage:
  npm run db:create:primary
  npm run db:create:primary -- --dry-run
  PRIMARY_DB_RESET=true npm run db:create:primary -- --reset

Options:
  --schema <path>      Apply a custom schema SQL file.
  --dry-run           Read and summarize the schema without connecting.
  --reset             Drop and recreate the public schema before applying.
  --no-transaction    Apply schema without wrapping it in one transaction.

Environment:
  DATABASE_URL         Target PostgreSQL connection string.
  PRIMARY_DB_RESET    Must be "true" when using --reset.
`);
}

function redactConnectionString(value: string): string {
  try {
    const url = new URL(value);
    if (url.password) url.password = '***';
    if (url.username) url.username = url.username ? `${url.username}` : '';
    return url.toString();
  } catch {
    return value.replace(/:\/\/([^:]+):([^@]+)@/, '://$1:***@');
  }
}

function resolveSsl(connectionString: string): PoolConfig['ssl'] {
  const sslMode = new URL(connectionString).searchParams.get('sslmode');
  if (sslMode === 'require' || sslMode === 'verify-ca' || sslMode === 'verify-full') {
    return { rejectUnauthorized: sslMode !== 'require' };
  }
  return undefined;
}

function summarizeSql(sql: string): Record<string, number> {
  const count = (pattern: RegExp) => (sql.match(pattern) ?? []).length;
  return {
    tables: count(/\bCREATE\s+TABLE\b/gi),
    indexes: count(/\bCREATE\s+(?:UNIQUE\s+)?INDEX\b/gi),
    functions: count(/\bCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\b/gi),
    views: count(/\bCREATE\s+(?:OR\s+REPLACE\s+)?VIEW\b/gi),
    triggers: count(/\bCREATE\s+TRIGGER\b/gi),
    extensions: count(/\bCREATE\s+EXTENSION\b/gi),
  };
}

async function applySchema(pool: Pool, sql: string, options: CliOptions): Promise<void> {
  const client = await pool.connect();
  try {
    if (options.reset) {
      if (process.env.PRIMARY_DB_RESET !== 'true') {
        throw new Error('Refusing --reset unless PRIMARY_DB_RESET=true is set');
      }
      await client.query('DROP SCHEMA IF EXISTS public CASCADE');
      await client.query('CREATE SCHEMA public');
      await client.query('GRANT ALL ON SCHEMA public TO public');
    }

    if (options.noTransaction) {
      try {
        await client.query(sql);
      } catch (err) {
        printSqlErrorContext(sql, err);
        throw err;
      }
      return;
    }

    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      printSqlErrorContext(sql, err);
      throw err;
    }
  } finally {
    client.release();
  }
}

function printSqlErrorContext(sql: string, err: unknown): void {
  const positionRaw =
    typeof err === 'object' &&
    err !== null &&
    'position' in err &&
    typeof (err as { position?: unknown }).position === 'string'
      ? (err as { position: string }).position
      : null;

  const position = positionRaw ? Number(positionRaw) : Number.NaN;
  if (!Number.isFinite(position)) return;

  console.error(`SQL error context around character ${position}:`);
  console.error(sqlContext(sql, position));
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const sql = (await fs.readFile(options.schemaPath, 'utf8')).replace(/^\uFEFF/, '');
  const summary = summarizeSql(sql);

  console.log('Primary DB schema file:', options.schemaPath);
  console.log('Schema summary:', summary);

  if (options.dryRun) {
    console.log('Dry run complete; no database connection opened.');
    return;
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set');
  }

  const pool = new Pool({
    connectionString,
    max: 1,
    ssl: resolveSsl(connectionString),
  });

  try {
    console.log('Applying primary DB baseline to:', redactConnectionString(connectionString));
    await applySchema(pool, sql, options);
    console.log('Primary DB baseline applied successfully.');
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Primary DB creation failed.');
  console.error(err);
  process.exit(1);
});
