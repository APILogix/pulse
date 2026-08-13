import { config } from 'dotenv';
import { Pool, type PoolConfig } from 'pg';

config();

interface CliOptions {
  dryRun: boolean;
  yes: boolean;
  schemas: string[];
}

interface TableRow {
  schema_name: string;
  table_name: string;
}

const DEFAULT_SCHEMAS = ['public'];

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    dryRun: false,
    yes: false,
    schemas: DEFAULT_SCHEMAS,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    }
    if (arg === '--yes') {
      options.yes = true;
      continue;
    }
    if (arg === '--schema') {
      const value = argv[i + 1];
      if (!value) throw new Error('--schema requires a schema name');
      options.schemas = value.split(',').map((item) => item.trim()).filter(Boolean);
      if (options.schemas.length === 0) throw new Error('--schema must include at least one schema name');
      i += 1;
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
Truncate all primary PostgreSQL tables without dropping schema objects.

Usage:
  npm run db:truncate:primary -- --dry-run
  PRIMARY_DB_TRUNCATE=true npm run db:truncate:primary -- --yes
  PRIMARY_DB_TRUNCATE=true npm run db:truncate:primary -- --yes --schema public

Options:
  --dry-run           List tables and print the generated TRUNCATE statement.
  --yes               Required for destructive truncation.
  --schema <names>    Comma-separated schema names to truncate. Defaults to public.

Environment:
  DATABASE_URL         Target PostgreSQL connection string.
  PRIMARY_DB_TRUNCATE  Must be "true" when using --yes.
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

function quoteIdentifier(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

async function listTables(pool: Pool, schemas: string[]): Promise<TableRow[]> {
  const result = await pool.query<TableRow>(
    `
    SELECT n.nspname AS schema_name, c.relname AS table_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = ANY($1::text[])
      AND c.relkind IN ('r', 'p')
      AND c.relispartition = false
    ORDER BY n.nspname, c.relname
    `,
    [schemas],
  );
  return result.rows;
}

function truncateSql(tables: TableRow[]): string {
  const names = tables.map((table) =>
    `${quoteIdentifier(table.schema_name)}.${quoteIdentifier(table.table_name)}`,
  );
  return `TRUNCATE TABLE ${names.join(', ')} RESTART IDENTITY CASCADE;`;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set');

  if (!options.dryRun && (!options.yes || process.env.PRIMARY_DB_TRUNCATE !== 'true')) {
    throw new Error('Refusing to truncate primary DB unless --yes and PRIMARY_DB_TRUNCATE=true are both set');
  }

  const pool = new Pool({
    connectionString,
    max: 1,
    ssl: resolveSsl(connectionString),
  });

  try {
    console.log('Target primary DB:', redactConnectionString(connectionString));
    console.log('Schemas:', options.schemas.join(', '));

    const tables = await listTables(pool, options.schemas);
    console.log(`Tables found: ${tables.length}`);

    if (tables.length === 0) {
      console.log('No tables to truncate.');
      return;
    }

    const sql = truncateSql(tables);
    if (options.dryRun) {
      console.log(sql);
      return;
    }

    await pool.query('BEGIN');
    try {
      await pool.query(sql);
      await pool.query('COMMIT');
      console.log('Primary DB tables truncated successfully.');
    } catch (err) {
      await pool.query('ROLLBACK');
      throw err;
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Primary DB truncate failed.');
  console.error(err);
  process.exit(1);
});
