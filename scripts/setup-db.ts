/**
 * Postgres migration runner.
 *
 * Reads every *.sql file in src/db/postgres/migrations (in lexicographic
 * order, ignoring sub-folders and helper files), tracks applied filenames
 * in a `schema_migrations` ledger table, and applies each pending migration
 * inside its own transaction.
 *
 * Idempotent: running the script repeatedly only applies new files.
 *
 * Usage:
 *   npm run db:migrate
 */
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { pool } from '../src/config/database.js';
import { logger } from '../src/config/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(
  __dirname,
  '../src/db/postgres/migrations',
);

// Files in the migrations directory that are NOT migration files. The legacy
// authtable.sql and schema.sql are kept for reference but should not run.
const SKIP_FILES = new Set(['authtable.sql', 'schema.sql']);

async function ensureLedger(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function getApplied(): Promise<Set<string>> {
  const result = await pool.query<{ filename: string }>(
    `SELECT filename FROM schema_migrations`,
  );
  return new Set(result.rows.map((r) => r.filename));
}

async function listMigrationFiles(): Promise<string[]> {
  const entries = await fs.readdir(MIGRATIONS_DIR, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && e.name.endsWith('.sql'))
    .map((e) => e.name)
    .filter((name) => !SKIP_FILES.has(name))
    .sort((a, b) => a.localeCompare(b));
}

async function applyMigration(filename: string): Promise<void> {
  const full = path.join(MIGRATIONS_DIR, filename);
  const sql = await fs.readFile(full, 'utf8');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query(
      `INSERT INTO schema_migrations (filename) VALUES ($1)`,
      [filename],
    );
    await client.query('COMMIT');
    logger.info({ filename }, 'Migration applied');
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error({ err, filename }, 'Migration failed');
    throw err;
  } finally {
    client.release();
  }
}

async function main(): Promise<void> {
  await ensureLedger();
  const [applied, files] = await Promise.all([getApplied(), listMigrationFiles()]);

  const pending = files.filter((f) => !applied.has(f));
  if (pending.length === 0) {
    logger.info('No pending migrations');
    return;
  }
  logger.info({ pending }, `Applying ${pending.length} migration(s)`);
  for (const file of pending) {
    await applyMigration(file);
  }
  logger.info('All migrations applied');
}

main()
  .then(() => pool.end())
  .catch(async (err) => {
    logger.fatal({ err }, 'Migration runner failed');
    await pool.end();
    process.exit(1);
  });
