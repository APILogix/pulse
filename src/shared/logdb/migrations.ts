import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { Pool, PoolClient } from 'pg';
import type { Logger } from 'pino';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const LOGDB_MIGRATIONS_DIR = path.resolve(
  __dirname,
  '../../../database/migrations/logdb',
);

const LOGDB_MIGRATION_LOCK_KEY = 74_373_201;

export interface LogDbMigrationFile {
  filename: string;
  filepath: string;
  basename: string;
}

export interface ApplyLogDbMigrationsOptions {
  dryRun?: boolean;
  only?: string[];
  logger?: Logger;
}

export interface ApplyLogDbMigrationsResult {
  directory: string;
  found: number;
  applied: number;
  skipped: number;
  failed: number;
}

function isLogDbMigrationFile(filename: string): boolean {
  if (!filename.endsWith('.sql')) return false;
  if (filename.endsWith('.down.sql')) return false;
  return filename.endsWith('.up.sql') || !filename.endsWith('.down.sql');
}

export async function findLogDbMigrationFiles(
  dir = LOGDB_MIGRATIONS_DIR,
  root = dir,
): Promise<LogDbMigrationFile[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: LogDbMigrationFile[] = [];

  for (const entry of entries) {
    const filepath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await findLogDbMigrationFiles(filepath, root));
      continue;
    }
    if (!entry.isFile() || !isLogDbMigrationFile(entry.name)) continue;

    files.push({
      filename: path.relative(root, filepath).replace(/\\/g, '/'),
      filepath,
      basename: path.basename(entry.name, '.sql').replace(/\.up$/, ''),
    });
  }

  return files.sort((a, b) => a.filename.localeCompare(b.filename));
}

async function ensureMigrationsTable(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS logdb_migrations (
      id SERIAL PRIMARY KEY,
      filename TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      duration_ms INTEGER
    )
  `);
}

async function hasMigrationBeenApplied(client: PoolClient, filename: string): Promise<boolean> {
  const applied = await client.query<{ id: number }>(
    'SELECT id FROM logdb_migrations WHERE filename = $1',
    [filename],
  );
  return applied.rows.length > 0;
}

async function recordMigration(
  client: PoolClient,
  filename: string,
  durationMs: number,
): Promise<void> {
  await client.query(
    `INSERT INTO logdb_migrations (filename, applied_at, duration_ms)
     VALUES ($1, NOW(), $2)
     ON CONFLICT (filename) DO NOTHING`,
    [filename, durationMs],
  );
}

function hasExplicitTransaction(sql: string): boolean {
  const normalized = sql.trim().toUpperCase();
  return normalized.startsWith('BEGIN;') && normalized.includes('COMMIT;');
}

async function applyOneMigration(
  client: PoolClient,
  migration: LogDbMigrationFile,
  dryRun: boolean,
): Promise<{ applied: boolean; durationMs: number }> {
  if (await hasMigrationBeenApplied(client, migration.filename)) {
    return { applied: false, durationMs: 0 };
  }

  if (dryRun) {
    return { applied: false, durationMs: 0 };
  }

  const sql = await fs.readFile(migration.filepath, 'utf8');
  if (sql.trim().length === 0) {
    await recordMigration(client, migration.filename, 0);
    return { applied: true, durationMs: 0 };
  }

  const startedAt = Date.now();
  const explicitTx = hasExplicitTransaction(sql);

  if (explicitTx) {
    await client.query(sql);
  } else {
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    }
  }

  const durationMs = Date.now() - startedAt;
  await recordMigration(client, migration.filename, durationMs);
  return { applied: true, durationMs };
}

export async function applyLogDbMigrations(
  pool: Pool,
  options: ApplyLogDbMigrationsOptions = {},
): Promise<ApplyLogDbMigrationsResult> {
  const dryRun = options.dryRun === true;
  const allMigrations = await findLogDbMigrationFiles();
  const filters = options.only?.map((value) => value.trim()).filter(Boolean) ?? [];
  const migrations = filters.length === 0
    ? allMigrations
    : allMigrations.filter((migration) =>
        filters.some((filter) =>
          migration.filename.startsWith(filter) || migration.basename.startsWith(filter),
        ),
      );

  const result: ApplyLogDbMigrationsResult = {
    directory: LOGDB_MIGRATIONS_DIR,
    found: migrations.length,
    applied: 0,
    skipped: 0,
    failed: 0,
  };

  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOGDB_MIGRATION_LOCK_KEY]);
    await ensureMigrationsTable(client);

    for (const migration of migrations) {
      try {
        const applied = await applyOneMigration(client, migration, dryRun);
        if (applied.applied) {
          result.applied += 1;
          options.logger?.info(
            { migration: migration.filename, durationMs: applied.durationMs },
            'Log DB migration applied',
          );
        } else {
          result.skipped += 1;
          options.logger?.debug(
            { migration: migration.filename, dryRun },
            dryRun ? 'Log DB migration dry-run skipped' : 'Log DB migration already applied',
          );
        }
      } catch (err) {
        result.failed += 1;
        options.logger?.error({ err, migration: migration.filename }, 'Log DB migration failed');
        throw err;
      }
    }

    options.logger?.info(
      {
        found: result.found,
        applied: result.applied,
        skipped: result.skipped,
        failed: result.failed,
      },
      'Log DB migrations complete',
    );
    return result;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOGDB_MIGRATION_LOCK_KEY]).catch(() => undefined);
    client.release();
  }
}
