import '../src/config/dns.js';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { config } from 'dotenv';
import { Pool, type PoolClient, type PoolConfig } from 'pg';
import {
  getSafePostgresConnectionTarget,
  parsePostgresAddressFamily,
  withPostgresAddressFamily,
} from '../src/config/postgres-network.js';
import { resolvePostgresSslConfig, sanitizePostgresConnectionString } from '../src/config/postgres-ssl.js';

config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_SEEDERS_DIR = path.resolve(
  __dirname,
  '../database/primarydbv2/seeds',
);

interface CliOptions {
  seedersDir: string;
  dryRun: boolean;
  noTransaction: boolean;
}

interface SeederFile {
  name: string;
  fullPath: string;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    seedersDir: DEFAULT_SEEDERS_DIR,
    dryRun: false,
    noTransaction: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dir') {
      const value = argv[i + 1];
      if (!value) throw new Error('--dir requires a directory path');
      options.seedersDir = path.resolve(value);
      i += 1;
      continue;
    }
    if (arg === '--dry-run') {
      options.dryRun = true;
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
Run primary DB seed files one by one.

Usage:
  npm run db:seed:primary
  npm run db:seed:primary -- --dry-run
  npm run db:seed:primary -- --dir src/db/postgres/primary_db_draft/20_seeders

Options:
  --dir <path>        Seeder directory. Defaults to primary_db_draft/20_seeders.
  --dry-run           List seed files without connecting to the database.
  --no-transaction    Run each seed file without wrapping it in a transaction.

Environment:
  DATABASE_URL        Target PostgreSQL connection string.
`);
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

function resolveSsl(connectionString: string): PoolConfig['ssl'] {
  const sslMode = new URL(connectionString).searchParams.get('sslmode');
  if (sslMode === 'require' || sslMode === 'verify-ca' || sslMode === 'verify-full') {
    return { rejectUnauthorized: sslMode !== 'require' };
  }
  return undefined;
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

async function listSeederFiles(seedersDir: string): Promise<SeederFile[]> {
  const entries = await fs.readdir(seedersDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.sql'))
    .map((entry) => ({
      name: entry.name,
      fullPath: path.join(seedersDir, entry.name),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function runSeederFile(
  client: PoolClient,
  file: SeederFile,
  options: CliOptions,
): Promise<void> {
  const sql = (await fs.readFile(file.fullPath, 'utf8')).replace(/^\uFEFF/, '');
  if (sql.trim().length === 0) {
    console.log(`Skipping empty seeder: ${file.name}`);
    return;
  }

  console.log(`Running seeder: ${file.name}`);

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
}


async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const files = await listSeederFiles(options.seedersDir);

  console.log('Primary DB seeders directory:', options.seedersDir);
  console.log(`Found ${files.length} SQL seeder file(s).`);

  if (files.length === 0) return;

  if (options.dryRun) {
    for (const file of files) console.log(file.name);
    console.log('Dry run complete; no database connection opened.');
    return;
  }

  function toDirectPostgresUrl(urlString: string): string {
    try {
      const url = new URL(urlString);
      if (url.hostname.endsWith('.neon.tech') && url.hostname.includes('-pooler')) {
        url.hostname = url.hostname.replace('-pooler', '');
        return url.toString();
      }
    } catch {}
    return urlString;
  }

  const rawUrl = process.env.DATABASE_URL;
  if (!rawUrl) {
    throw new Error('DATABASE_URL is not set');
  }
  const connectionString = toDirectPostgresUrl(rawUrl);

  const pool = new Pool(withPostgresAddressFamily({
    connectionString: sanitizePostgresConnectionString(connectionString),
    max: 1,
    connectionTimeoutMillis: 30000,
    ssl: resolvePostgresSslConfig(connectionString),
  }, parsePostgresAddressFamily(process.env.DB_FAMILY)));

  const client = await pool.connect();
  try {
    const target = getSafePostgresConnectionTarget(connectionString);
    console.log('Applying seeders to:', `${target.host}:${target.port}/${target.database}`);
    for (const file of files) {
      await runSeederFile(client, file, options);
    }
    console.log('All primary DB seeders applied successfully.');
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Primary DB seeder runner failed.');
  console.error(err);
  process.exit(1);
});
