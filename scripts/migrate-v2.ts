#!/usr/bin/env tsx
/**
 * Production-grade migration runner for PrimaryDB v2 and LogDB v2.
 *
 * Discovers and applies all pending *.up.sql migrations from:
 *   - database/primarydbv2/migrations
 *   - database/logdbv2/migrations
 *
 * Usage:
 *   npm run db:migrate
 *   npm run db:migrate:v2
 *   npm run db:migrate:primary
 *   npm run db:migrate:logdb
 *   npm run db:migrate:v2 -- --dry-run
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Pool, type PoolClient } from 'pg';

import { pool as primaryPool } from '../src/config/database.js';
import { env } from '../src/config/env.js';
import { logger } from '../src/config/logger.js';
import {
  getSafePostgresConnectionMetadata,
  withPostgresAddressFamily,
} from '../src/config/postgres-network.js';
import {
  resolvePostgresSslConfig,
  sanitizePostgresConnectionString,
} from '../src/config/postgres-ssl.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PRIMARY_MIGRATIONS_DIR = path.resolve(__dirname, '../database/primarydbv2/migrations');
const LOGDB_MIGRATIONS_DIR = path.resolve(__dirname, '../database/logdbv2/migrations');

interface CliOptions {
  dryRun: boolean;
  target: 'both' | 'primary' | 'logdb';
}

function parseArgs(argv: string[]): CliOptions {
  let dryRun = false;
  let target: 'both' | 'primary' | 'logdb' = 'both';

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--only') {
      const val = (argv[i + 1] || '').toLowerCase();
      if (val === 'primary') target = 'primary';
      else if (val === 'log' || val === 'logdb') target = 'logdb';
      i += 1;
    } else if (arg === '--primary') {
      target = 'primary';
    } else if (arg === '--logdb' || arg === '--log') {
      target = 'logdb';
    }
  }

  return { dryRun, target };
}

function createLogDbPool(): Pool {
  const connectionString = env.LOG_DB_PRIMARY || env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('LOG_DB_PRIMARY or DATABASE_URL must be configured');
  }

  const ssl = resolvePostgresSslConfig(connectionString, {
    enabled: env.LOG_DB_SSL_ENABLED,
    rejectUnauthorized: env.LOG_DB_SSL_REJECT_UNAUTHORIZED,
  });

  return new Pool(
    withPostgresAddressFamily(
      {
        connectionString: sanitizePostgresConnectionString(connectionString),
        max: 3,
        idleTimeoutMillis: 10_000,
        connectionTimeoutMillis: 10_000,
        ssl,
      },
      env.DB_FAMILY,
    ),
  );
}

interface MigrationRunOptions {
  dbLabel: string;
  migrationsDir: string;
  ledgerTable: string;
  pool: Pool;
  dryRun: boolean;
}

async function runMigrationsForDb({
  dbLabel,
  migrationsDir,
  ledgerTable,
  pool,
  dryRun,
}: MigrationRunOptions): Promise<void> {
  console.log(`\n============================================================`);
  console.log(`  Target: ${dbLabel}`);
  console.log(`  Directory: ${migrationsDir}`);
  console.log(`  Mode: ${dryRun ? 'DRY RUN (Preview Only)' : 'LIVE EXECUTION'}`);
  console.log(`============================================================`);

  if (!fs.existsSync(migrationsDir)) {
    console.log(`Directory does not exist: ${migrationsDir}`);
    return;
  }

  const client: PoolClient = await pool.connect();
  try {
    // 1. Ensure ledger table
    await client.query(`
      CREATE TABLE IF NOT EXISTS ${ledgerTable} (
        filename TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // 2. Fetch already-applied migrations
    const appliedRes = await client.query<{ filename: string }>(
      `SELECT filename FROM ${ledgerTable} ORDER BY filename ASC`,
    );
    const appliedSet = new Set(appliedRes.rows.map((r) => r.filename));

    // 3. Scan directory for *.up.sql files in lexicographical order
    const allFiles = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.up.sql'))
      .sort();

    const pendingFiles = allFiles.filter((f) => !appliedSet.has(f));

    if (pendingFiles.length === 0) {
      console.log(`✔ All ${allFiles.length} migrations are already up-to-date. (0 pending)`);
      return;
    }

    console.log(`Found ${pendingFiles.length} pending migration(s):`);
    for (const f of pendingFiles) {
      console.log(`  - ${f}`);
    }

    if (dryRun) {
      console.log(`✔ [DRY RUN] Skipping execution.`);
      return;
    }

    // 4. Apply each pending migration in its own transaction
    for (const file of pendingFiles) {
      const filePath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(filePath, 'utf8');

      // Strip standalone top-level BEGIN/COMMIT to preserve runner transaction boundaries
      const executableSql = sql
        .replace(/^\s*BEGIN\s*;\s*$/gim, '')
        .replace(/^\s*COMMIT\s*;\s*$/gim, '');

      console.log(`\n▶ Applying: ${file}...`);
      const startTime = Date.now();

      const isNonTransactional = /CONCURRENTLY/i.test(executableSql);

      try {
        if (isNonTransactional) {
          const statements = executableSql
            .split(';')
            .map((s) => s.trim())
            .filter((s) => s.length > 0 && s.replace(/--.*$/gm, '').trim().length > 0);
          for (const stmt of statements) {
            await client.query(stmt);
          }
          await client.query(
            `INSERT INTO ${ledgerTable} (filename, applied_at) VALUES ($1, NOW())`,
            [file],
          );
        } else {
          await client.query('BEGIN');
          await client.query(executableSql);
          await client.query(
            `INSERT INTO ${ledgerTable} (filename, applied_at) VALUES ($1, NOW())`,
            [file],
          );
          await client.query('COMMIT');
        }
        const elapsed = Date.now() - startTime;
        console.log(`  ✔ Applied successfully in ${elapsed}ms`);
      } catch (err) {
        if (!isNonTransactional) {
          await client.query('ROLLBACK').catch(() => {});
        }
        console.error(`  ✖ FAILED to apply ${file}:`, err);
        throw err;
      }
    }

    console.log(`\n✔ Successfully applied all ${pendingFiles.length} migration(s) for ${dbLabel}.`);
  } finally {
    client.release();
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  let logPool: Pool | null = null;

  try {
    if (options.target === 'both' || options.target === 'primary') {
      await runMigrationsForDb({
        dbLabel: 'PrimaryDB v2',
        migrationsDir: PRIMARY_MIGRATIONS_DIR,
        ledgerTable: 'schema_migrations',
        pool: primaryPool,
        dryRun: options.dryRun,
      });
    }

    if (options.target === 'both' || options.target === 'logdb') {
      logPool = createLogDbPool();
      await runMigrationsForDb({
        dbLabel: 'LogDB v2',
        migrationsDir: LOGDB_MIGRATIONS_DIR,
        ledgerTable: 'logdb_migrations',
        pool: logPool,
        dryRun: options.dryRun,
      });
    }

    console.log('\n============================================================');
    console.log('✔ All targeted database migrations finished successfully!');
    console.log('============================================================\n');
  } finally {
    if (logPool) {
      await logPool.end().catch(() => {});
    }
  }
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error('\n✖ Migration runner failed:', err);
    process.exit(1);
  });
