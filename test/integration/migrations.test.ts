import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';

import {
  applyMigrationSql,
  listMigrationFiles,
  readMigrationSql,
  resolveMigrationsDir,
} from '../../scripts/lib/migrations.js';

describe('canonical migrations bootstrap', () => {
  let container: PostgreSqlContainer | null = null;
  let client: Client | null = null;
  let runtimeUnavailableReason: string | null = null;

  beforeAll(async () => {
    try {
      container = await new PostgreSqlContainer('postgres:16-alpine').start();
      client = new Client({
        connectionString: container.getConnectionUri(),
      });
      await client.connect();
    } catch (err) {
      runtimeUnavailableReason =
        err instanceof Error ? err.message : String(err);
    }
  });

  afterAll(async () => {
    if (client) {
      await client.end();
      client = null;
    }
    if (container) {
      await container.stop();
      container = null;
    }
  });

  it('applies every up migration to a fresh database in lexicographic order', async () => {
    if (!client) {
      console.warn(
        `Skipping migrations bootstrap integration test: ${runtimeUnavailableReason ?? 'container runtime unavailable'}`,
      );
      return;
    }
    const db = client!;
    const migrationsDir = await resolveMigrationsDir();
    const files = await listMigrationFiles(migrationsDir);

    for (const filename of files) {
      const sql = await readMigrationSql(filename, migrationsDir);
      await applyMigrationSql(db, filename, sql);
    }

    const existence = await db.query<{
      users_exists: boolean;
      organizations_exists: boolean;
      auth_email_outbox_exists: boolean;
      organization_sso_providers_exists: boolean;
    }>(
      `SELECT
         to_regclass('public.users') IS NOT NULL AS users_exists,
         to_regclass('public.organizations') IS NOT NULL AS organizations_exists,
         to_regclass('public.auth_email_outbox') IS NOT NULL AS auth_email_outbox_exists,
         to_regclass('public.organization_sso_providers') IS NOT NULL AS organization_sso_providers_exists`,
    );

    expect(existence.rows[0]).toMatchObject({
      users_exists: true,
      organizations_exists: true,
      auth_email_outbox_exists: true,
      organization_sso_providers_exists: true,
    });

    const oidcColumns = await db.query<{ column_name: string }>(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_name = 'organization_sso_providers'
         AND column_name IN (
           'oidc_issuer',
           'oidc_client_id',
           'oidc_client_secret_encrypted',
           'oidc_scopes',
           'oidc_jit_provision',
           'oidc_jit_default_role'
         )
       ORDER BY column_name ASC`,
    );

    expect(oidcColumns.rows.map((r) => r.column_name)).toEqual([
      'oidc_client_id',
      'oidc_client_secret_encrypted',
      'oidc_issuer',
      'oidc_jit_default_role',
      'oidc_jit_provision',
      'oidc_scopes',
    ]);

    const outboxColumns = await db.query<{ column_name: string }>(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_name = 'auth_email_outbox'
         AND column_name = 'processing_started_at'`,
    );

    expect(outboxColumns.rows).toHaveLength(1);

    const orgSettingsColumns = await db.query<{ column_name: string }>(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_name = 'organization_settings'
         AND column_name IN (
           'mfa_allowed_methods',
           'mfa_primary_method_preference',
           'mfa_backup_codes_required',
           'mfa_grace_period_days',
           'mfa_max_devices_per_user',
           'mfa_allow_sms_fallback',
           'mfa_allow_email_fallback',
           'mfa_remember_device_days'
         )
       ORDER BY column_name ASC`,
    );

    expect(orgSettingsColumns.rows.map((r) => r.column_name)).toEqual([
      'mfa_allow_email_fallback',
      'mfa_allow_sms_fallback',
      'mfa_allowed_methods',
      'mfa_backup_codes_required',
      'mfa_grace_period_days',
      'mfa_max_devices_per_user',
      'mfa_primary_method_preference',
      'mfa_remember_device_days',
    ]);
  });
});
