import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { config } from 'dotenv';
import { Pool, type PoolClient, type PoolConfig } from 'pg';

config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PRIMARY_DRAFT_DIR = path.resolve(__dirname, '../src/db/postgres/primary_db_draft');

interface CliOptions {
  targetDir: string;
  dryRun: boolean;
  noTransaction: boolean;
  recursive: boolean;
}

interface SqlFile {
  name: string;
  relativePath: string;
  fullPath: string;
}

function printHelp(): void {
  console.log(`
Run SQL files from a folder under primary_db_draft.

Usage:
  npm run db:primary:draft -- 06_project
  npm run db:primary:draft -- 06_project --dry-run
  npm run db:primary:draft -- --dir 06_project
  npm run db:primary:draft -- --dir 06_project --recursive

Options:
  --dir <folder>      Folder under src/db/postgres/primary_db_draft.
  --dry-run           List SQL files without connecting to the database.
  --recursive         Include SQL files in nested subfolders.
  --no-transaction    Run each SQL file without wrapping it in a transaction.

Environment:
  DATABASE_URL        Target primary PostgreSQL connection string.
`);
}

function parseArgs(argv: string[]): CliOptions {
  let folderArg: string | undefined;
  const options = {
    dryRun: false,
    noTransaction: false,
    recursive: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
    if (arg === '--dir') {
      const value = argv[i + 1];
      if (!value) throw new Error('--dir requires a folder path');
      folderArg = value;
      i += 1;
      continue;
    }
    if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    }
    if (arg === '--recursive') {
      options.recursive = true;
      continue;
    }
    if (arg === '--no-transaction') {
      options.noTransaction = true;
      continue;
    }
    if (!arg.startsWith('--') && !folderArg) {
      folderArg = arg;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!folderArg) {
    throw new Error('Missing folder. Example: npm run db:primary:draft -- 06_project');
  }

  const targetDir = resolvePrimaryDraftPath(folderArg);
  return { targetDir, ...options };
}

function resolvePrimaryDraftPath(folderArg: string): string {
  const target = path.resolve(PRIMARY_DRAFT_DIR, folderArg);
  const relative = path.relative(PRIMARY_DRAFT_DIR, target);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Target must be a subfolder under primary_db_draft: ${folderArg}`);
  }
  return target;
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

async function collectSqlFiles(targetDir: string, recursive: boolean): Promise<SqlFile[]> {
  async function walk(dir: string): Promise<SqlFile[]> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const files = await Promise.all(entries.map(async (entry) => {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory() && recursive) return walk(fullPath);
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.sql')) return [];
      if (entry.name.toLowerCase().endsWith('.down.sql')) return [];
      return [{
        name: entry.name,
        relativePath: path.relative(targetDir, fullPath).split(path.sep).join('/'),
        fullPath,
      }];
    }));
    return files.flat();
  }

  return (await walk(targetDir)).sort((a, b) => a.relativePath.localeCompare(b.relativePath));
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

async function runSqlFile(client: PoolClient, file: SqlFile, options: CliOptions): Promise<void> {
  const sql = (await fs.readFile(file.fullPath, 'utf8')).replace(/^\uFEFF/, '');
  if (sql.trim().length === 0) {
    console.log(`Skipping empty SQL file: ${file.relativePath}`);
    return;
  }

  console.log(`Running SQL file: ${file.relativePath}`);
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
  const stat = await fs.stat(options.targetDir);
  if (!stat.isDirectory()) throw new Error(`Target is not a directory: ${options.targetDir}`);

  const files = await collectSqlFiles(options.targetDir, options.recursive);
  console.log('Primary draft base:', PRIMARY_DRAFT_DIR);
  console.log('Target folder     :', path.relative(PRIMARY_DRAFT_DIR, options.targetDir));
  console.log(`Found ${files.length} SQL file(s).`);

  for (const file of files) console.log(`  - ${file.relativePath}`);
  if (files.length === 0 || options.dryRun) {
    if (options.dryRun) console.log('Dry run complete; no database connection opened.');
    return;
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set');

  const pool = new Pool({
    connectionString,
    max: 1,
    ssl: resolveSsl(connectionString),
  });

  const client = await pool.connect();
  try {
    console.log('Applying SQL to:', redactConnectionString(connectionString));
    for (const file of files) await runSqlFile(client, file, options);
    console.log('All primary draft SQL files applied successfully.');
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Primary draft SQL runner failed.');
  console.error(err);
  process.exit(1);
});
