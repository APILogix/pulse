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
  'src/db/postgres/canonical_migrations_draft/11_billing/seeder',
);

const BILLING_PLAN_SEEDS = [
  '026_seed_plans.sql',
  '027_seed_plan_prices.sql',
  '028a_seed_billing_features_core.sql',
  '028a2_seed_billing_features_projects.sql',
  '028a3_seed_billing_features_sdk.sql',
  '028b1_seed_billing_features_error_tracking.sql',
  '028b2_seed_billing_features_tracing.sql',
  '028b3_seed_billing_features_logging.sql',
  '028b4_seed_billing_features_metrics.sql',
  '028b5_seed_billing_features_profiling.sql',
  '028b6_seed_billing_features_session_replay.sql',
  '028b7_seed_billing_features_uptime_cron.sql',
  '028c1_seed_billing_features_alerting.sql',
  '028c2_seed_billing_features_dashboards.sql',
  '028c3_seed_billing_features_integrations.sql',
  '028c4_seed_billing_features_ai.sql',
  '028d1_seed_billing_features_enterprise_security.sql',
  '029b_seed_feature_dependencies_canonical.sql',
  '030a_seed_plan_entitlements_core.sql',
  '030b_seed_plan_entitlements_observability.sql',
  '030c_seed_plan_entitlements_platform.sql',
  '030d_seed_plan_quota_values.sql',
  '031b_seed_addon_catalog_canonical.sql',
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
