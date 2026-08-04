#!/usr/bin/env tsx
/**
 * Apply Log DB migrations to LOG_DB_PRIMARY.
 *
 * Usage:
 *   npm run db:migrate:logdb
 *   npm run db:migrate:logdb -- --dry-run
 *   npm run db:migrate:logdb -- --only 03_observability,07_ai_runtime
 *
 * The shared runner discovers every .sql migration under database/migrations/logdb
 * except .down.sql files, connects only to LOG_DB_PRIMARY, and applies each
 * migration once. Applied files are tracked in logdb_migrations inside Log DB.
 */
import { Pool } from 'pg';
import { env } from '../src/config/env.js';
import { logger } from '../src/config/logger.js';
import {
  LOGDB_MIGRATIONS_DIR,
  applyLogDbMigrations,
} from '../src/shared/logdb/migrations.js';

function createLogDbPool(): Pool {
  const connectionString = env.LOG_DB_PRIMARY;
  if (!connectionString) {
    throw new Error('LOG_DB_PRIMARY is required for Log DB migrations');
  }

  let ssl: boolean | { rejectUnauthorized: boolean } = false;
  if (env.LOG_DB_SSL_ENABLED !== undefined) {
    ssl = env.LOG_DB_SSL_ENABLED
      ? { rejectUnauthorized: env.LOG_DB_SSL_REJECT_UNAUTHORIZED }
      : false;
  } else {
    try {
      const url = new URL(connectionString);
      const sslMode = url.searchParams.get('sslmode')?.toLowerCase();
      if (['require', 'verify-ca', 'verify-full', 'allow'].includes(sslMode ?? '')) {
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
  return connectionString.replace(/:[^:@]+@/, ':****@');
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const onlyIndex = args.indexOf('--only');
  const only =
    onlyIndex >= 0 && args[onlyIndex + 1]
      ? args[onlyIndex + 1].split(',').map((value) => value.trim()).filter(Boolean)
      : undefined;

  if (!env.LOG_DB_PRIMARY) {
    console.error('ERROR: LOG_DB_PRIMARY is not configured. Refusing to run Log DB migrations.');
    process.exit(1);
  }

  console.log('='.repeat(60));
  console.log('Log Database Migration Runner');
  console.log('='.repeat(60));
  console.log(`Database: ${redactConnectionString(env.LOG_DB_PRIMARY)}`);
  console.log(`Directory: ${LOGDB_MIGRATIONS_DIR}`);
  console.log(`Mode: ${dryRun ? 'DRY-RUN' : 'LIVE'}`);
  if (only) console.log(`Filter: ${only.join(', ')}`);
  console.log();

  const pool = createLogDbPool();
  try {
    const result = await applyLogDbMigrations(pool, {
      dryRun,
      only,
      logger: logger.child({ component: 'logdb-migrations' }),
    });

    console.log();
    console.log('-'.repeat(60));
    console.log(`Summary: ${result.applied} applied, ${result.skipped} skipped, ${result.failed} failed`);
    console.log(`Found ${result.found} migration(s)`);
    if (result.failed > 0) process.exit(1);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error('Migration failed:', error);
  process.exit(1);
});
