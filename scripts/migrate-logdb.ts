#!/usr/bin/env tsx
/**
 * Apply Log DB migrations to LOG_DB_PRIMARY.
 *
 * Usage:
 *   npm run db:migrate:logdb
 *   npm run db:migrate:logdb -- --dry-run
 *   npm run db:migrate:logdb -- --only 03_observability,07_ai_runtime
 *
 * The runner discovers every .up.sql file under database/migrations/logdb,
 * path, connects only to LOG_DB_PRIMARY, and applies each migration once. Applied
 * files are tracked in the logdb_migrations table inside the Log DB.
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
  basename: string;
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
    if (!entry.isFile() || !entry.name.endsWith(".up.sql")) continue;

    files.push({
      filename: path.relative(LOGDB_MIGRATIONS_DIR, filepath).replace(/\\/g, "/"),
      filepath,
      basename: path.basename(entry.name, ".up.sql"),
    });
  }

  return files.sort((a, b) => a.filename.localeCompare(b.filename));
}

async function ensureMigrationsTable(client: Pool): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS logdb_migrations (
      id SERIAL PRIMARY KEY,
      filename TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      duration_ms INTEGER
    )
  `);
}

async function hasMigrationBeenApplied(client: Pool, filename: string): Promise<boolean> {
  const applied = await client.query<{ id: number }>(
    "SELECT id FROM logdb_migrations WHERE filename = $1",
    [filename],
  );
  return applied.rows.length > 0;
}

async function recordMigration(client: Pool, filename: string, durationMs: number): Promise<void> {
  await client.query(
    `INSERT INTO logdb_migrations (filename, applied_at, duration_ms)
     VALUES ($1, NOW(), $2)
     ON CONFLICT (filename) DO NOTHING`,
    [filename, durationMs],
  );
}

async function applyMigration(
  client: Pool,
  migration: MigrationFile,
  dryRun: boolean,
): Promise<{ applied: boolean; durationMs: number; error?: string }> {
  if (await hasMigrationBeenApplied(client, migration.filename)) {
    return { applied: false, durationMs: 0 };
  }

  if (dryRun) {
    console.log(`  [DRY-RUN] ${migration.filename}`);
    return { applied: false, durationMs: 0 };
  }

  const startedAt = Date.now();
  const sql = await fs.readFile(migration.filepath, "utf8");
  const hasExplicitTx = sql.trimStart().toUpperCase().startsWith("BEGIN");

  try {
    if (!hasExplicitTx) await client.query("BEGIN");
    await client.query(sql);
    if (!hasExplicitTx) await client.query("COMMIT");

    const durationMs = Date.now() - startedAt;
    await recordMigration(client, migration.filename, durationMs);
    return { applied: true, durationMs };
  } catch (error) {
    if (!hasExplicitTx) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Ignore rollback errors; the original migration error is more useful.
      }
    }
    return {
      applied: false,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function createLogDbPool(): Pool {
  const connectionString = env.LOG_DB_PRIMARY;
  if (!connectionString) {
    throw new Error("LOG_DB_PRIMARY is required for Log DB migrations");
  }

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

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const onlyIndex = args.indexOf("--only");
  const onlyFilter =
    onlyIndex >= 0 && args[onlyIndex + 1]
      ? args[onlyIndex + 1].split(",").map((value) => value.trim()).filter(Boolean)
      : null;

  if (!env.LOG_DB_PRIMARY) {
    console.error("ERROR: LOG_DB_PRIMARY is not configured. Refusing to run Log DB migrations.");
    process.exit(1);
  }

  const allMigrations = await findMigrationFiles(LOGDB_MIGRATIONS_DIR);
  const migrations = onlyFilter
    ? allMigrations.filter((migration) =>
        onlyFilter.some((filter) =>
          migration.filename.startsWith(filter) || migration.basename.startsWith(filter),
        ),
      )
    : allMigrations;

  console.log("=".repeat(60));
  console.log("Log Database Migration Runner");
  console.log("=".repeat(60));
  console.log(`Database: ${redactConnectionString(env.LOG_DB_PRIMARY)}`);
  console.log(`Directory: ${LOGDB_MIGRATIONS_DIR}`);
  console.log(`Mode: ${dryRun ? "DRY-RUN" : "LIVE"}`);
  if (onlyFilter) console.log(`Filter: ${onlyFilter.join(", ")}`);
  console.log(`Found ${migrations.length} migration(s)`);
  console.log();

  if (migrations.length === 0) {
    console.log("No migrations to apply.");
    return;
  }

  const pool = createLogDbPool();
  try {
    await ensureMigrationsTable(pool);

    let applied = 0;
    let skipped = 0;
    let failed = 0;

    for (const migration of migrations) {
      const result = await applyMigration(pool, migration, dryRun);
      if (result.error) {
        failed += 1;
        console.error(`  x ${migration.filename} - ${result.error}`);
      } else if (result.applied) {
        applied += 1;
        console.log(`  + ${migration.filename} (${result.durationMs}ms)`);
      } else {
        skipped += 1;
        console.log(`  - ${migration.filename} (already applied or dry-run)`);
      }
    }

    console.log();
    console.log("-".repeat(60));
    console.log(`Summary: ${applied} applied, ${skipped} skipped, ${failed} failed`);
    if (failed > 0) process.exit(1);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error("Migration failed:", error);
  process.exit(1);
});
