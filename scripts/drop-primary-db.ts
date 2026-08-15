#!/usr/bin/env tsx
/**
 * Drop all tables (and views/types) in the primary PostgreSQL database.
 *
 * Usage:
 *   npm run db:drop:primary -- --dry-run
 *   npm run db:drop:primary -- --yes
 *   npm run db:drop:primary -- --yes --types
 *   npm run db:drop:primary -- --yes --recreate-schema
 *   PRIMARY_DB_DROP=true npm run db:drop:primary -- --yes
 *
 * Options:
 *   --dry-run           List tables and objects to drop without modifying the database.
 *   --yes               Required confirmation flag for destructive drops.
 *   --schema <names>    Comma-separated list of schemas (default: "public").
 *   --types             Also drop custom enums, domains, and composite types.
 *   --functions         Also drop custom functions in target schemas.
 *   --all               Drop tables, views, types, and functions.
 *   --recreate-schema   Completely drop and recreate the public schema (fastest reset).
 *
 * Environment:
 *   DATABASE_URL        Target PostgreSQL connection string.
 *   PRIMARY_DB_DROP     Optional extra safeguard variable (or pass --yes).
 */
import { config } from 'dotenv';
import { Pool, type PoolConfig } from 'pg';

config();

interface CliOptions {
  dryRun: boolean;
  yes: boolean;
  schemas: string[];
  dropTypes: boolean;
  dropFunctions: boolean;
  recreateSchema: boolean;
}

const DEFAULT_SCHEMAS = ['public'];

function parseArgs(argv: string[]): CliOptions {
  const npmFlag = (name: string): boolean => process.env[`npm_config_${name}`] === 'true';
  const options: CliOptions = {
    dryRun: npmFlag('dry_run'),
    yes: npmFlag('yes'),
    schemas: DEFAULT_SCHEMAS,
    dropTypes: npmFlag('types'),
    dropFunctions: npmFlag('functions'),
    recreateSchema: npmFlag('recreate_schema'),
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
    if (arg === '--types') {
      options.dropTypes = true;
      continue;
    }
    if (arg === '--functions') {
      options.dropFunctions = true;
      continue;
    }
    if (arg === '--all') {
      options.dropTypes = true;
      options.dropFunctions = true;
      continue;
    }
    if (arg === '--recreate-schema') {
      options.recreateSchema = true;
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
Drop all tables and objects in the primary PostgreSQL database.

Usage:
  npm run db:drop:primary -- --dry-run
  npm run db:drop:primary -- --yes
  npm run db:drop:primary -- --yes --all
  npm run db:drop:primary -- --yes --recreate-schema

Options:
  --dry-run           List tables and objects to drop without modifying the database.
  --yes               Required confirmation flag for destructive execution.
  --schema <names>    Comma-separated list of schemas (default: "public").
  --types             Also drop custom enums, domains, and composite types.
  --functions         Also drop custom functions in target schemas.
  --all               Drop tables, views, types, and functions.
  --recreate-schema   Drop and recreate the target schema (DROP SCHEMA ... CASCADE).

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
  try {
    const sslMode = new URL(connectionString).searchParams.get('sslmode')?.toLowerCase();
    if (sslMode === 'require' || sslMode === 'verify-ca' || sslMode === 'verify-full') {
      return { rejectUnauthorized: false };
    }
  } catch {
    // Ignore invalid url format for SSL resolution
  }
  return undefined;
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

interface DbObject {
  kind: string;
  schema: string;
  name: string;
}

async function listTablesAndViews(pool: Pool, schemas: string[]): Promise<DbObject[]> {
  const result = await pool.query<{ kind: string; schema: string; name: string }>(
    `
    SELECT 'MATERIALIZED VIEW' AS kind, n.nspname AS schema, c.relname AS name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = ANY($1::text[])
      AND c.relkind = 'm'
    UNION ALL
    SELECT 'VIEW' AS kind, n.nspname AS schema, c.relname AS name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = ANY($1::text[])
      AND c.relkind = 'v'
    UNION ALL
    SELECT 'TABLE' AS kind, n.nspname AS schema, c.relname AS name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = ANY($1::text[])
      AND c.relkind IN ('r', 'p', 'f')
    ORDER BY kind, schema, name
    `,
    [schemas],
  );
  return result.rows;
}

async function listCustomTypes(pool: Pool, schemas: string[]): Promise<DbObject[]> {
  const result = await pool.query<{ kind: string; schema: string; name: string }>(
    `
    SELECT 'TYPE' AS kind, n.nspname AS schema, t.typname AS name
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = ANY($1::text[])
      AND t.typtype IN ('e', 'c', 'd')
      AND NOT EXISTS (
        SELECT 1 FROM pg_class c WHERE c.oid = t.typrelid AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
      )
    ORDER BY schema, name
    `,
    [schemas],
  );
  return result.rows;
}

async function listCustomFunctions(pool: Pool, schemas: string[]): Promise<DbObject[]> {
  const result = await pool.query<{ kind: string; schema: string; name: string }>(
    `
    SELECT 'FUNCTION' AS kind, n.nspname AS schema, p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' AS name
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = ANY($1::text[])
      AND p.prokind IN ('f', 'p')
    ORDER BY schema, name
    `,
    [schemas],
  );
  return result.rows;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error('DATABASE_URL is not set in environment or .env file');
  }

  console.log('='.repeat(65));
  console.log('Primary PostgreSQL Drop / Clean Script');
  console.log('='.repeat(65));
  console.log(`Database: ${redactConnectionString(connectionString)}`);
  console.log(`Target Schemas: ${options.schemas.join(', ')}`);
  console.log(`Mode: ${options.dryRun ? 'DRY-RUN (No changes)' : 'LIVE EXECUTION'}`);
  console.log();

  if (!options.dryRun && !options.yes) {
    console.error('⚠️  SAFETY CHECK FAILED: Refusing to drop tables without --yes flag.');
    console.error('Run with --dry-run to preview, or add --yes to execute:');
    console.error('  npm run db:drop:primary -- --yes');
    console.error('  npm run db:drop:primary -- --dry-run');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString,
    max: 2,
    ssl: resolveSsl(connectionString),
  });

  try {
    if (options.recreateSchema) {
      console.log('Recreating schemas:', options.schemas.join(', '));
      if (options.dryRun) {
        for (const schema of options.schemas) {
          console.log(`[DRY-RUN] DROP SCHEMA IF EXISTS ${quoteIdent(schema)} CASCADE;`);
          console.log(`[DRY-RUN] CREATE SCHEMA ${quoteIdent(schema)};`);
          console.log(`[DRY-RUN] GRANT ALL ON SCHEMA ${quoteIdent(schema)} TO public;`);
        }
        return;
      }

      for (const schema of options.schemas) {
        console.log(`Dropping schema ${quoteIdent(schema)} CASCADE...`);
        await pool.query(`DROP SCHEMA IF EXISTS ${quoteIdent(schema)} CASCADE`);
        console.log(`Creating schema ${quoteIdent(schema)}...`);
        await pool.query(`CREATE SCHEMA ${quoteIdent(schema)}`);
        await pool.query(`GRANT ALL ON SCHEMA ${quoteIdent(schema)} TO public`);
      }
      console.log('Schemas recreated successfully.');
      return;
    }

    const tables = await listTablesAndViews(pool, options.schemas);
    const types = options.dropTypes ? await listCustomTypes(pool, options.schemas) : [];
    const functions = options.dropFunctions ? await listCustomFunctions(pool, options.schemas) : [];

    console.log(`Found:`);
    console.log(`  - Tables / Views / MatViews : ${tables.length}`);
    if (options.dropTypes) console.log(`  - Custom Types/Enums        : ${types.length}`);
    if (options.dropFunctions) console.log(`  - Custom Functions          : ${functions.length}`);
    console.log();

    if (tables.length === 0 && types.length === 0 && functions.length === 0) {
      console.log('No tables or objects found in target schema(s). Nothing to drop.');
      return;
    }

    if (tables.length > 0) {
      console.log('Tables & Views to drop:');
      for (const item of tables) {
        console.log(`  [${item.kind}] ${item.schema}.${item.name}`);
      }
    }

    if (types.length > 0) {
      console.log('Custom Types to drop:');
      for (const item of types) {
        console.log(`  [${item.kind}] ${item.schema}.${item.name}`);
      }
    }

    if (functions.length > 0) {
      console.log('Custom Functions to drop:');
      for (const item of functions) {
        console.log(`  [${item.kind}] ${item.schema}.${item.name}`);
      }
    }

    if (options.dryRun) {
      console.log('\n[DRY-RUN] Preview complete. No objects were dropped.');
      return;
    }

    console.log('\nDropping database objects...');

    // Drop tables, views, and materialized views
    for (const table of tables) {
      const sql = `DROP ${table.kind} IF EXISTS ${quoteIdent(table.schema)}.${quoteIdent(table.name)} CASCADE;`;
      await pool.query(sql);
      console.log(`  ✓ Dropped ${table.kind.toLowerCase()}: ${table.schema}.${table.name}`);
    }

    // Drop custom functions if requested
    if (options.dropFunctions) {
      for (const func of functions) {
        const sql = `DROP FUNCTION IF EXISTS ${quoteIdent(func.schema)}.${func.name} CASCADE;`;
        try {
          await pool.query(sql);
          console.log(`  ✓ Dropped function: ${func.schema}.${func.name}`);
        } catch (err) {
          console.warn(`  ! Could not drop function ${func.name}:`, (err as Error).message);
        }
      }
    }

    // Drop custom types/enums if requested
    if (options.dropTypes) {
      for (const type of types) {
        const sql = `DROP TYPE IF EXISTS ${quoteIdent(type.schema)}.${quoteIdent(type.name)} CASCADE;`;
        try {
          await pool.query(sql);
          console.log(`  ✓ Dropped type: ${type.schema}.${type.name}`);
        } catch (err) {
          console.warn(`  ! Could not drop type ${type.name}:`, (err as Error).message);
        }
      }
    }

    console.log('\n' + '='.repeat(65));
    console.log('Primary DB tables dropped successfully.');
    console.log('='.repeat(65));
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('\n❌ Primary DB drop failed:');
  console.error(err);
  process.exit(1);
});
