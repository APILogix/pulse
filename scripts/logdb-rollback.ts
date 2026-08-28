#!/usr/bin/env tsx
/**
 * Apply a Log DB rollback (`*.down.sql`) file.
 *
 * Architecture: docs/alerting-redesign/07-migration-plan.md §8 (rollback matrix)
 *
 * The forward runner (`scripts/migrate-logdb.ts`) deliberately ignores `.down.sql`
 * files, so until now there was no way to execute a documented rollback. The plan's
 * rollback matrix is only real if the down files can actually be run and are tested.
 *
 * Each down file is responsible for removing its own `logdb_migrations` ledger row, so
 * after a rollback the forward runner will re-apply the migration on its next run.
 *
 * Usage:
 *   npx tsx scripts/logdb-rollback.ts 06_alert_runtime/002_alert_runtime_v2.down.sql
 *   npx tsx scripts/logdb-rollback.ts <file> --dry-run
 *
 * DESTRUCTIVE. Prints the target database and requires --yes for a live run unless
 * the target database name contains "test".
 */
import { promises as fs } from 'fs';
import path from 'path';
import { Pool } from 'pg';
import { env } from '../src/config/env.js';
import {
  LOGDB_MIGRATIONS_DIR,
  acquireLogDbMigrationLock,
  releaseLogDbMigrationLock,
} from '../src/shared/logdb/migrations.js';

function redact(connectionString: string): string {
  try {
    const url = new URL(connectionString);
    return `${url.host}/${url.pathname.replace(/^\//, '')}`;
  } catch {
    return '(unparseable)';
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const confirmed = args.includes('--yes');
  const target = args.find((arg) => !arg.startsWith('--'));

  if (!target) {
    console.error('ERROR: pass a .down.sql path relative to database/migrations/logdb');
    process.exit(1);
  }
  if (!target.endsWith('.down.sql')) {
    console.error('ERROR: only .down.sql files may be applied by this tool');
    process.exit(1);
  }

  const filepath = path.resolve(LOGDB_MIGRATIONS_DIR, target);
  if (!filepath.startsWith(LOGDB_MIGRATIONS_DIR)) {
    console.error('ERROR: path escapes the Log DB migrations directory');
    process.exit(1);
  }

  const sql = await fs.readFile(filepath, 'utf8').catch(() => null);
  if (sql === null) {
    console.error(`ERROR: file not found: ${filepath}`);
    process.exit(1);
  }

  const connectionString = env.LOG_DB_PRIMARY ?? env.DATABASE_URL;
  const pool = new Pool({ connectionString, max: 2 });
  const client = await pool.connect();
  let lockAcquired = false;

  try {
    await acquireLogDbMigrationLock(client);
    lockAcquired = true;
    const dbResult = await client.query<{ db: string }>('SELECT current_database() AS db');
    const database = dbResult.rows[0]!.db;

    console.log('='.repeat(64));
    console.log('Log DB rollback');
    console.log('='.repeat(64));
    console.log(`Target   : ${redact(connectionString)} (database=${database})`);
    console.log(`File     : ${target}`);
    console.log(`Mode     : ${dryRun ? 'DRY-RUN' : 'LIVE (DESTRUCTIVE)'}`);

    if (dryRun) {
      console.log(`SQL bytes: ${sql.length}`);
      return;
    }

    const looksDisposable = /test|scratch|tmp/i.test(database);
    if (!looksDisposable && !confirmed) {
      throw new Error(
        `REFUSING: "${database}" does not look like a disposable database. `
        + 'Re-run with --yes to confirm a destructive rollback against it.',
      );
    }

    const startedAt = Date.now();
    await client.query(sql);
    console.log(`Rolled back in ${Date.now() - startedAt}ms`);
  } finally {
    if (lockAcquired) {
      await releaseLogDbMigrationLock(client).catch(() => undefined);
    }
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error('Rollback failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
