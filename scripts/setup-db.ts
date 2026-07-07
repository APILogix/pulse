/**
 * Postgres migration runner.
 *
 * Reads every `*.up.sql` file in the canonical migrations directory tree (in
 * lexicographic order, ignoring helper files), tracks applied filenames
 * in a `schema_migrations` ledger table, and applies each pending migration
 * inside its own transaction.
 *
 * Idempotent: running the script repeatedly only applies new files.
 *
 * Usage:
 *   npm run db:migrate
 *   MIGRATIONS_PROFILE=draft npm run db:migrate
 *   MIGRATIONS_DIR=path/to/custom/tree npm run db:migrate
 */
import { pool } from '../src/config/database.js';
import { logger } from '../src/config/logger.js';
import {
  applyMigrationSql,
  LEGACY_MIGRATION_ALIASES,
  listMigrationFiles,
  readMigrationSql,
  resolveMigrationsDir,
} from './lib/migrations.js';

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

async function applyMigration(filename: string): Promise<void> {
  const migrationsDir = await resolveMigrationsDir();
  const sql = await readMigrationSql(filename, migrationsDir);
  const client = await pool.connect();
  try {
    await applyMigrationSql(client, filename, sql);
    await client.query(
      `INSERT INTO schema_migrations (filename) VALUES ($1)`,
      [filename],
    );
    logger.info({ filename }, 'Migration applied');
  } catch (err) {
    logger.error({ err, filename }, 'Migration failed');
    throw err;
  } finally {
    client.release();
  }
}

async function main(): Promise<void> {
  const migrationsDir = await resolveMigrationsDir();
  await ensureLedger();
  const [applied, files] = await Promise.all([getApplied(), listMigrationFiles()]);

  const pending = files.filter((f) => {
    const legacy = LEGACY_MIGRATION_ALIASES[f];
    return !applied.has(f) && !(legacy && applied.has(legacy));
  });
  if (pending.length === 0) {
    logger.info({ migrationsDir }, 'No pending migrations');
    return;
  }
  logger.info({ migrationsDir, pending }, `Applying ${pending.length} migration(s)`);
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

