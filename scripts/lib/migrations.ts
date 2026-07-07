import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import type { PoolClient } from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const CANDIDATE_MIGRATION_DIRS = [
  path.resolve(__dirname, '../../src/db/postgres/canonical_migrations'),
  path.resolve(__dirname, '../../src/db/postgres/migrations2'),
];

export const DRAFT_MIGRATIONS_DIR = path.resolve(
  __dirname,
  '../../src/db/postgres/canonical_migrations_draft',
);

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
    if (!entry.isFile() || !entry.name.endsWith('.up.sql')) {
      return [];
    }
    return [path.relative(rootDir, fullPath).split(path.sep).join('/')];
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
  return fs.readFile(path.join(dir, filename), 'utf8');
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
