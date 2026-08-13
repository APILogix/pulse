/**
 * Comprehensive Database Reset & Recreation Script
 *
 * ⚠️ WARNING: DESTROYS AND RECREATES ALL TABLES & SEEDS CANONICAL DATA.
 * Use only for development / testing environments.
 *
 * Steps:
 * 1. Runs 001_drop_all.sql to drop all tables, views, functions, and types.
 * 2. Runs 002_create_all_ordered.sql to recreate primary schemas.
 * 3. Runs 003_project_module_refactor.sql to apply project module refactors.
 * 4. Runs 004_enterprise_database_integrity.sql to apply enterprise constraints & indexes.
 * 5. Applies canonical billing catalog seeds (025_billing_seed.sql & 030d_seed_plan_quota_values.sql).
 *
 * Usage:
 *   npm run db:recreate
 */
import path from 'path';
import { readFile } from 'node:fs/promises';
import { pool } from '../src/config/database.js';
import { logger } from '../src/config/logger.js';
import { applyMigrationSql } from './lib/migrations.js';

const MIGRATIONS_DIR = path.resolve(process.cwd(), 'src/db/postgres/migrations');
const BILLING_DRAFT_DIR = path.resolve(process.cwd(), 'src/db/postgres/canonical_migrations_draft/11_billing');

const MIGRATION_FILES = [
  { dir: MIGRATIONS_DIR, filename: '001_drop_all.sql' },
  { dir: MIGRATIONS_DIR, filename: '002_create_all_ordered.sql' },
  { dir: MIGRATIONS_DIR, filename: '003_project_module_refactor.sql' },
  { dir: MIGRATIONS_DIR, filename: '004_enterprise_database_integrity.sql' },
  { dir: BILLING_DRAFT_DIR, filename: '025_billing_seed.sql' },
  { dir: path.join(BILLING_DRAFT_DIR, 'seeder'), filename: '030d_seed_plan_quota_values.sql' },
];

async function main(): Promise<void> {
  logger.warn('Starting complete database reset & recreation...');

  for (const { dir, filename } of MIGRATION_FILES) {
    const filePath = path.join(dir, filename);
    logger.info({ filename }, `Reading ${filename}...`);
    const sql = await readFile(filePath, 'utf8');

    const client = await pool.connect();
    try {
      await applyMigrationSql(client, filename, sql);
      logger.info({ filename }, `Successfully executed ${filename}`);
    } catch (err) {
      logger.error({ err, filename }, `Failed to execute ${filename}`);
      throw err;
    } finally {
      client.release();
    }
  }

  logger.info('Database recreation and canonical seeding completed successfully!');
}

main()
  .then(() => pool.end())
  .catch(async (err) => {
    logger.fatal({ err }, 'Database recreation failed');
    await pool.end();
    process.exit(1);
  });
