import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import type { PoolClient } from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const DRAFT_MIGRATIONS_DIR = path.resolve(
  __dirname,
  '../../src/db/postgres/canonical_migrations_draft',
);

export const CANDIDATE_MIGRATION_DIRS = [
  DRAFT_MIGRATIONS_DIR,
  path.resolve(__dirname, '../../src/db/postgres/canonical_migrations'),
  path.resolve(__dirname, '../../src/db/postgres/migrations2'),
];

export function resolveMigrationDirOverride(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const explicitDir = env.MIGRATIONS_DIR?.trim();
  if (explicitDir) {
    return path.resolve(explicitDir);
  }

  const profile = env.MIGRATIONS_PROFILE?.trim().toLowerCase();
  if (profile === 'draft') {
    return DRAFT_MIGRATIONS_DIR;
  }

  return null;
}

export function resolveMigrationDirOverrideFromArgs(
  args: string[],
): string | null {
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--migrations-profile') {
      const value = args[i + 1]?.trim().toLowerCase();
      if (value === 'draft') {
        return DRAFT_MIGRATIONS_DIR;
      }
    }
    if (arg === '--migrations-dir') {
      const value = args[i + 1]?.trim();
      if (value) {
        return path.resolve(value);
      }
    }
  }

  return null;
}

export const LEGACY_MIGRATION_ALIASES: Record<string, string> = {
  '001_auth_create_core_schema.up.sql': '001_auth_canonical_consolidated.up.sql',
  '002_connectors_create_notification_schema.up.sql': '002_add_notification_connectors.up.sql',
  '003_alerting_create_core_schema.up.sql': '003_add_alerting_module.up.sql',
  '004_analytics_create_core_schema.up.sql': '004_add_analytics_module.up.sql',
  '005_auth_extend_mfa_schema.up.sql': '005_add_mfa_system.up.sql',
  '006_organizations_create_core_schema.up.sql': '006_add_organization_module.up.sql',
  '007_organizations_create_sdk_config_schema.up.sql': '007_add_sdk_config_module.up.sql',
  '008_projects_create_core_schema.up.sql': '008_add_projects_module.up.sql',
  '009_ingestion_create_queue_schema.up.sql': '009_add_ingestion_queue_v2.up.sql',
  '010_ingestion_create_usage_counters_schema.up.sql': '010_add_ingestion_usage_counters.up.sql',
  '011_ingestion_create_legacy_compat_schema.up.sql': '011_add_legacy_ingestion_compat_tables.up.sql',
  '012_auth_harden_email_outbox_schema.up.sql': '012_auth_email_outbox_hardening.up.sql',
};

/**
 * These billing files describe application defaults or example data, not
 * database-owned state.  Keeping them beside the historical seed drafts makes
 * the decision visible, while excluding them prevents the generic recursive
 * loader from creating (or requiring) non-canonical tables for templates,
 * webhook names, tax presets, and demo overrides.
 */
const BILLING_APPLICATION_CONSTANT_SEEDS = new Set([
  '032_seed_default_sdk_configuration.sql',
  // These two drafts target retired table shapes. Their canonical replacements
  // must seed feature_dependencies and addons/addon_prices, never purchases.
  '029_seed_feature_dependencies.sql',
  '031_seed_plan_addons.sql',
  '033_seed_feature_overrides.sql',
  '034_seed_usage_billing_rules.sql',
  '035_seed_invoice_templates.sql',
  '036_seed_tax_configuration.sql',
  '037_seed_coupon_templates.sql',
  '038_seed_usage_alert_policies.sql',
  '039_seed_billing_webhook_events.sql',
  '040_seed_email_templates.sql',
  '041_seed_notification_templates.sql',
]);

export function isMigrationFile(filename: string): boolean {
  const normalized = filename.split(path.sep).join('/');
  if (!normalized.endsWith('.sql')) return false;
  if (normalized.endsWith('.down.sql')) return false;
  if (
    (normalized.startsWith('11_billing/seeder/') || normalized.includes('/11_billing/seeder/'))
    && BILLING_APPLICATION_CONSTANT_SEEDS.has(path.posix.basename(normalized))
  ) {
    return false;
  }
  // Include both .up.sql and plain .sql (used by billing, automation, etc.)
  return true;
}

async function collectMigrationFiles(
  rootDir: string,
  currentDir: string = rootDir,
): Promise<string[]> {
  const entries = await fs.readdir(currentDir, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const fullPath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      return collectMigrationFiles(rootDir, fullPath);
    }
    const relativePath = path.relative(rootDir, fullPath).split(path.sep).join('/');
    if (!entry.isFile() || !isMigrationFile(relativePath)) {
      return [];
    }
    return [relativePath];
  }));

  return files
    .flat()
    .sort((a, b) => a.localeCompare(b));
}

export async function resolveMigrationsDir(
  args: string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  const override =
    resolveMigrationDirOverrideFromArgs(args) ?? resolveMigrationDirOverride(env);
  if (override) {
    const stat = await fs.stat(override);
    if (!stat.isDirectory()) {
      throw new Error(`Migrations override is not a directory: ${override}`);
    }
    return override;
  }

  for (const dir of CANDIDATE_MIGRATION_DIRS) {
    try {
      const stat = await fs.stat(dir);
      if (stat.isDirectory()) {
        return dir;
      }
    } catch {
      // Try the next candidate.
    }
  }
  throw new Error(
    `No migrations directory found. Tried: ${CANDIDATE_MIGRATION_DIRS.join(', ')}`,
  );
}

export async function listMigrationFiles(migrationsDir?: string): Promise<string[]> {
  const dir = migrationsDir ?? await resolveMigrationsDir();
  return collectMigrationFiles(dir);
}

export async function readMigrationSql(
  filename: string,
  migrationsDir?: string,
): Promise<string> {
  const dir = migrationsDir ?? await resolveMigrationsDir();
  return (await fs.readFile(path.join(dir, filename), 'utf8')).replace(/^\uFEFF/, '');
}

export function migrationHasExplicitTransaction(sql: string): boolean {
  const normalized = sql.trim().toUpperCase();
  return normalized.startsWith('BEGIN;') && normalized.includes('COMMIT;');
}

export async function applyMigrationSql(
  client: PoolClient,
  filename: string,
  sql: string,
): Promise<void> {
  if (migrationHasExplicitTransaction(sql)) {
    await client.query(sql);
    return;
  }

  await client.query('BEGIN');
  try {
    await client.query(sql);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
}
