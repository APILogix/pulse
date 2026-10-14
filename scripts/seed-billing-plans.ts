/**
 * Seeds the canonical billing catalog without applying the full migration tree.
 *
 * Prerequisite: run `npm run db:migrate:draft` first so the canonical billing
 * tables and reconciliation migration exist. Every selected SQL file is
 * idempotent and is deliberately limited to persistent catalog data; it never
 * creates subscriptions, organization overrides, or demo tenant data.
 *
 * Usage:
 *   npm run db:seed:billing
 *   npm run db:seed:billing -- --dry-run
 */
import path from 'path';
import { readFile } from 'node:fs/promises';

import { pool } from '../src/config/database.js';
import { logger } from '../src/config/logger.js';
import { applyMigrationSql } from './lib/migrations.js';

const BILLING_SEED_DIR = path.resolve(
  process.cwd(),
  'database/primarydbv2/seeds',
);

const BILLING_PLAN_SEEDS = [
  '004_11_billing_catalog_plans_and_prices.sql',
  '005_11_billing_catalog_features.sql',
  '006_11_billing_catalog_plan_entitlements.sql',
  '007_11_billing_event_credit_weights.sql',
] as const;

let currentFilename: string | undefined;

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const files = await Promise.all(BILLING_PLAN_SEEDS.map(async (filename) => {
    const absolutePath = path.join(BILLING_SEED_DIR, filename);
    const sql = await readFile(absolutePath, 'utf8');
    return { filename, sql };
  }));

  if (dryRun) {
    logger.info({ files: BILLING_PLAN_SEEDS }, 'Billing catalog seed dry run');
    return;
  }

  for (const { filename, sql } of files) {
    currentFilename = filename;
    const client = await pool.connect();
    try {
      await applyMigrationSql(client, filename, sql);
      logger.info({ filename }, 'Billing catalog seed applied');
    } catch (error) {
      logger.error({ error, filename }, 'Billing catalog seed failed for file');
      throw error;
    } finally {
      client.release();
    }
  }
}

main()
  .then(() => pool.end())
  .catch(async (error) => {
    logger.fatal({ error, filename: currentFilename }, 'Billing catalog seed failed');
    await pool.end();
    process.exit(1);
  });
