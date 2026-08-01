#!/usr/bin/env tsx
/**
 * Apply ONE primary-database migration by filename.
 *
 * Why this exists: `setup-db.ts` applies every pending migration. In an environment
 * whose primary schema was built from the compiled `002_create_all*.sql` bundle rather
 * than the canonical tree, hundreds of files show as "pending" even though their objects
 * already exist. Running them all is unsafe. This applies exactly one file and records it
 * in the same `schema_migrations` ledger, so the normal runner stays consistent.
 *
 * Uses the same helpers as setup-db.ts (readMigrationSql / applyMigrationSql) so a file
 * applied here is indistinguishable from one applied by the standard runner.
 *
 * Usage:
 *   npx tsx scripts/apply-migration.ts 06_connectors/015_create_connector_runtime_guards.up.sql
 *   npx tsx scripts/apply-migration.ts <file> --dry-run
 *
 * Refuses to run a file that is already recorded in the ledger.
 */
import { pool } from '../src/config/database.js';
import { logger } from '../src/config/logger.js';
import {
  applyMigrationSql,
  listMigrationFiles,
  readMigrationSql,
  resolveMigrationsDir,
} from './lib/migrations.js';

const log = logger.child({ component: 'apply-migration' });

async function ensureLedger(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const target = args.find((arg) => !arg.startsWith('--'));

  if (!target) {
    console.error('ERROR: pass the migration filename relative to the migrations directory.');
    process.exit(1);
  }

  const migrationsDir = await resolveMigrationsDir();
  const files = await listMigrationFiles();
  if (!files.includes(target)) {
    console.error(`ERROR: "${target}" is not a migration file under ${migrationsDir}`);
    const suggestions = files.filter((file) => file.includes(target.split('/').pop() ?? target));
    if (suggestions.length > 0) {
      console.error('Did you mean:');
      for (const suggestion of suggestions) console.error(`  ${suggestion}`);
    }
    process.exit(1);
  }

  await ensureLedger();
  const already = await pool.query<{ filename: string }>(
    'SELECT filename FROM schema_migrations WHERE filename = $1',
    [target],
  );
  if (already.rows.length > 0) {
    console.log(`Already applied: ${target}`);
    return;
  }

  const sql = await readMigrationSql(target, migrationsDir);
  console.log(`Directory : ${migrationsDir}`);
  console.log(`Migration : ${target}`);
  console.log(`Mode      : ${dryRun ? 'DRY-RUN (nothing will be applied)' : 'LIVE'}`);

  if (dryRun) {
    console.log(`SQL length: ${sql.length} bytes`);
    return;
  }

  const client = await pool.connect();
  try {
    const startedAt = Date.now();
    await applyMigrationSql(client, target, sql);
    await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [target]);
    log.info({ filename: target, durationMs: Date.now() - startedAt }, 'Migration applied');
    console.log(`Applied in ${Date.now() - startedAt}ms`);
  } catch (err) {
    log.error({ err, filename: target }, 'Migration failed');
    throw err;
  } finally {
    client.release();
  }
}

main()
  .then(() => pool.end())
  .catch(async (err) => {
    console.error('Failed:', err instanceof Error ? err.message : err);
    await pool.end();
    process.exit(1);
  });
