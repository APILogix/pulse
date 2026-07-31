#!/usr/bin/env tsx
/**
 * Destructively reset LOG_DB_PRIMARY and recreate the Log DB schema.
 *
 * Usage:
 *   npm run db:reset:logdb -- --yes
 *   npm run db:reset:logdb -- --dry-run
 *   npm run db:reset:logdb -- --yes --drop-only
 *   npm run db:reset:logdb -- --create-only
 *
 * The recreate step applies every .up.sql file under database/migrations/logdb
 * in lexical path order, matching scripts/migrate-logdb.ts. This is intended
 * for local/dev Log DB rebuilds only; never run against production data.
 */
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Pool } from "pg";
import { env } from "../src/config/env.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGDB_MIGRATIONS_DIR = path.resolve(__dirname, "../database/migrations/logdb");

interface MigrationFile {
  filename: string;
  filepath: string;
}

interface ResetOptions {
  dryRun: boolean;
  yes: boolean;
  dropOnly: boolean;
  createOnly: boolean;
}

function parseOptions(): ResetOptions {
  const args = new Set(process.argv.slice(2));
  const npmFlag = (name: string): boolean => process.env[`npm_config_${name}`] === "true";
  const options = {
    dryRun: args.has("--dry-run") || npmFlag("dry_run"),
    yes: args.has("--yes") || npmFlag("yes"),
    dropOnly: args.has("--drop-only") || npmFlag("drop_only"),
    createOnly: args.has("--create-only") || npmFlag("create_only"),
  };
  if (options.dropOnly && options.createOnly) {
    throw new Error("--drop-only and --create-only cannot be used together");
  }
  return options;
}

async function findMigrationFiles(dir: string): Promise<MigrationFile[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: MigrationFile[] = [];

  for (const entry of entries) {
    const filepath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await findMigrationFiles(filepath));
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith(".sql") || entry.name.endsWith(".down.sql")) continue;

    files.push({
      filename: path.relative(LOGDB_MIGRATIONS_DIR, filepath).replace(/\\/g, "/"),
      filepath,
    });
  }

  return files.sort((a, b) => a.filename.localeCompare(b.filename));
}

function createLogDbPool(): Pool {
  const connectionString = env.LOG_DB_PRIMARY;
  if (!connectionString) throw new Error("LOG_DB_PRIMARY is required for Log DB reset");

  let ssl: boolean | { rejectUnauthorized: boolean } = false;
  if (env.LOG_DB_SSL_ENABLED !== undefined) {
    ssl = env.LOG_DB_SSL_ENABLED
      ? { rejectUnauthorized: env.LOG_DB_SSL_REJECT_UNAUTHORIZED }
      : false;
  } else {
    try {
      const url = new URL(connectionString);
      const sslMode = url.searchParams.get("sslmode")?.toLowerCase();
      if (["require", "verify-ca", "verify-full", "allow"].includes(sslMode ?? "")) {
        ssl = { rejectUnauthorized: env.LOG_DB_SSL_REJECT_UNAUTHORIZED };
      }
    } catch {
      // Leave SSL disabled when the connection string cannot be parsed.
    }
  }

  return new Pool({
    connectionString,
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    ssl,
  });
}

function redactConnectionString(connectionString: string): string {
  return connectionString.replace(/:[^:@]+@/, ":****@");
}

async function listResetObjects(pool: Pool): Promise<string[]> {
  const result = await pool.query<{ kind: string; qualified_name: string }>(`
    SELECT 'materialized view' AS kind, format('%I.%I', schemaname, matviewname) AS qualified_name
      FROM pg_matviews
     WHERE schemaname = 'public'
    UNION ALL
    SELECT 'view' AS kind, format('%I.%I', schemaname, viewname) AS qualified_name
      FROM pg_views
     WHERE schemaname = 'public'
    UNION ALL
    SELECT 'table' AS kind, format('%I.%I', schemaname, tablename) AS qualified_name
      FROM pg_tables
     WHERE schemaname = 'public'
     ORDER BY kind, qualified_name
  `);
  return result.rows.map((row) => `${row.kind} ${row.qualified_name}`);
}

async function dropLogDbObjects(pool: Pool, dryRun: boolean): Promise<void> {
  const objects = await listResetObjects(pool);
  if (objects.length === 0) {
    console.log("No public Log DB tables or views to drop.");
    return;
  }

  console.log(`Found ${objects.length} public object(s) to drop:`);
  for (const objectName of objects) console.log(`  - ${objectName}`);
  if (dryRun) return;

  await pool.query(`
    DO $$
    DECLARE
      item record;
    BEGIN
      FOR item IN
        SELECT 'MATERIALIZED VIEW' AS object_type, schemaname AS schema_name, matviewname AS object_name
          FROM pg_matviews
         WHERE schemaname = 'public'
        UNION ALL
        SELECT 'VIEW', schemaname, viewname
          FROM pg_views
         WHERE schemaname = 'public'
        UNION ALL
        SELECT 'TABLE', schemaname, tablename
          FROM pg_tables
         WHERE schemaname = 'public'
      LOOP
        EXECUTE format('DROP %s IF EXISTS %I.%I CASCADE', item.object_type, item.schema_name, item.object_name);
      END LOOP;
    END $$;
  `);
}

async function recordMigration(pool: Pool, filename: string, durationMs: number): Promise<void> {
  await pool.query(
    `INSERT INTO logdb_migrations (filename, applied_at, duration_ms)
     VALUES ($1, NOW(), $2)`,
    [filename, durationMs],
  );
}

async function ensureMigrationsTable(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS logdb_migrations (
      id SERIAL PRIMARY KEY,
      filename TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      duration_ms INTEGER
    )
  `);
}

async function applyMigrations(pool: Pool, migrations: MigrationFile[], dryRun: boolean): Promise<void> {
  if (dryRun) {
    console.log(`Would apply ${migrations.length} Log DB migration(s):`);
    for (const migration of migrations) console.log(`  - ${migration.filename}`);
    return;
  }

  await ensureMigrationsTable(pool);
  for (const migration of migrations) {
    const startedAt = Date.now();
    const sql = await fs.readFile(migration.filepath, "utf8");
    const hasExplicitTx = sql.trimStart().toUpperCase().startsWith("BEGIN");

    try {
      if (!hasExplicitTx) await pool.query("BEGIN");
      await pool.query(sql);
      if (!hasExplicitTx) await pool.query("COMMIT");
      const durationMs = Date.now() - startedAt;
      await recordMigration(pool, migration.filename, durationMs);
      console.log(`  + ${migration.filename} (${durationMs}ms)`);
    } catch (error) {
      if (!hasExplicitTx) {
        try {
          await pool.query("ROLLBACK");
        } catch {
          // Preserve the original migration failure.
        }
      }
      throw new Error(
        `${migration.filename} failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

async function main(): Promise<void> {
  const options = parseOptions();
  if (!env.LOG_DB_PRIMARY) {
    throw new Error("LOG_DB_PRIMARY is not configured. Refusing to reset Log DB.");
  }
  if (!options.dryRun && !options.createOnly && !options.yes) {
    throw new Error("Refusing to drop Log DB objects without --yes. Use --dry-run to preview.");
  }

  const migrations = await findMigrationFiles(LOGDB_MIGRATIONS_DIR);
  const pool = createLogDbPool();
  try {
    console.log("=".repeat(60));
    console.log("Log DB Reset/Recreate");
    console.log("=".repeat(60));
    console.log(`Database: ${redactConnectionString(env.LOG_DB_PRIMARY)}`);
    console.log(`Directory: ${LOGDB_MIGRATIONS_DIR}`);
    console.log(`Mode: ${options.dryRun ? "DRY-RUN" : "LIVE"}`);
    console.log(`Migrations: ${migrations.length}`);
    console.log();

    if (!options.createOnly) {
      await dropLogDbObjects(pool, options.dryRun);
    }
    if (!options.dropOnly) {
      await applyMigrations(pool, migrations, options.dryRun);
    }

    console.log();
    console.log(options.dryRun ? "Dry-run complete." : "Log DB reset complete.");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error("Log DB reset failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
