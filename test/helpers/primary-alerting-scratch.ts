/**
 * Disposable primary-database harness for Increment 2 (rule bindings).
 *
 * Architecture: docs/alerting-redesign/08-implementation-plan.md (Increment 2)
 *               docs/alerting-redesign/adr/0006-database-ownership.md
 *
 * Why a fixture core instead of the whole canonical tree: applying every draft migration
 * into an empty database fails at `03_org_identity/001_fixed_tables.sql` because
 * `billing_provider_type` is created later in the ordering. That is a pre-existing defect
 * in the draft tree, unrelated to this increment, and it is not this harness's job to
 * paper over it. So the harness creates the minimum prerequisite objects that P1–P3/P12
 * reference, then applies the REAL, unmodified migration files under test. If those files
 * and the repository ever drift apart, these tests fail.
 *
 * The fixture mirrors the live `apitool` shape for every column the migrations and
 * repository actually touch (verified against the live catalog), including the enum label
 * order of `alert_severity`.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';
import {
  DRAFT_MIGRATIONS_DIR,
  applyMigrationSql,
  readMigrationSql,
} from '../../scripts/lib/migrations.js';

/** The migrations under test, in application order. */
export const P1_SCOPE_TYPES = '08_alerting/019_create_alert_scope_types.up.sql';
export const P2_RULE_BINDINGS = '08_alerting/020_create_alert_rule_bindings.up.sql';
export const P3_RULE_REVISIONS = '08_alerting/021_create_alert_rule_revisions.up.sql';
export const P12_BACKFILL = '08_alerting/025_backfill_rule_bindings.up.sql';

export const INCREMENT_2_SCHEMA_MIGRATIONS = [
  P1_SCOPE_TYPES,
  P2_RULE_BINDINGS,
  P3_RULE_REVISIONS,
] as const;

export interface ScratchPrimary {
  readonly pool: Pool;
  readonly dbName: string;
  destroy(): Promise<void>;
}

function swapDatabase(connectionString: string, database: string): string {
  const url = new URL(connectionString);
  url.pathname = `/${database}`;
  return url.toString();
}

/**
 * Create a disposable database on the configured server and return a pool onto it.
 *
 * A `TEMPLATE` clone of the live database was rejected deliberately: PostgreSQL refuses
 * to use a template that has other sessions attached, and this environment normally has
 * live connections to `apitool`. A clone would also copy production-shaped data into a
 * test database.
 */
export async function createScratchPrimary(
  sourceUrl: string,
  prefix: string,
): Promise<ScratchPrimary> {
  const dbName = `${prefix}_${Date.now()}`;
  const adminPool = new Pool({ connectionString: swapDatabase(sourceUrl, 'postgres'), max: 1 });
  await adminPool.query(`CREATE DATABASE ${dbName}`);

  const pool = new Pool({ connectionString: swapDatabase(sourceUrl, dbName), max: 6 });

  return {
    pool,
    dbName,
    async destroy() {
      await pool.end();
      await adminPool.query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
          WHERE datname = $1 AND pid <> pg_backend_pid()`,
        [dbName],
      );
      await adminPool.query(`DROP DATABASE IF EXISTS ${dbName}`);
      await adminPool.end();
    },
  };
}

/**
 * Prerequisite objects referenced by P1–P3 and P12.
 *
 * Column types, nullability and defaults match the live `alert_rules`,
 * `alert_rule_conditions` and `alert_rule_actions` for every column the migrations or the
 * repository read or write, so `to_jsonb(r)` snapshots have a realistic shape.
 */
export async function applyFixtureCore(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE EXTENSION IF NOT EXISTS pgcrypto;

    CREATE TABLE schema_migrations (
      filename   TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TYPE alert_severity       AS ENUM ('info','warning','error','critical');
    CREATE TYPE alert_condition_type AS ENUM ('threshold','change','absence','composite');
    CREATE TYPE alert_action_type    AS ENUM ('notify','escalate','webhook','suppress');
    CREATE TYPE alert_condition_operator AS ENUM ('gt','gte','lt','lte','eq','neq');

    -- Shared trigger function; P2 attaches its updated_at trigger to it.
    CREATE OR REPLACE FUNCTION connector_set_updated_at() RETURNS trigger AS $fn$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $fn$ LANGUAGE plpgsql;

    CREATE TABLE organizations (
      id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR(255) NOT NULL
    );

    CREATE TABLE users (
      id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email VARCHAR(255) NOT NULL UNIQUE
    );

    CREATE TABLE projects (
      id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name   VARCHAR(255) NOT NULL
    );

    CREATE TABLE alert_escalation_policies (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name            VARCHAR(255) NOT NULL
    );

    CREATE TABLE alert_rules (
      id                           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id              UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name                         VARCHAR(255) NOT NULL,
      description                  TEXT,
      severity                     alert_severity NOT NULL DEFAULT 'warning',
      enabled                      BOOLEAN NOT NULL DEFAULT TRUE,
      evaluation_interval_seconds  INTEGER NOT NULL DEFAULT 60,
      cooldown_seconds             INTEGER NOT NULL DEFAULT 300,
      auto_resolve_after_minutes   INTEGER,
      deduplication_window_seconds INTEGER NOT NULL DEFAULT 3600,
      labels                       JSONB NOT NULL DEFAULT '{}'::jsonb,
      annotations                  JSONB NOT NULL DEFAULT '{}'::jsonb,
      metadata                     JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_by                   UUID NOT NULL REFERENCES users(id),
      updated_by                   UUID REFERENCES users(id),
      created_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at                   TIMESTAMPTZ,
      project_id                   UUID REFERENCES projects(id) ON DELETE CASCADE,
      preset_key                   VARCHAR(120),
      is_default                   BOOLEAN NOT NULL DEFAULT FALSE
    );

    CREATE TABLE alert_rule_conditions (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      rule_id         UUID NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
      condition_type  alert_condition_type NOT NULL DEFAULT 'threshold',
      field_path      VARCHAR(500) NOT NULL,
      operator        alert_condition_operator NOT NULL,
      threshold_value JSONB,
      lookback_minutes INTEGER,
      order_index     INTEGER NOT NULL DEFAULT 0,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE alert_rule_actions (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      rule_id       UUID NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
      action_type   alert_action_type NOT NULL DEFAULT 'notify',
      priority      INTEGER NOT NULL DEFAULT 100,
      order_index   INTEGER NOT NULL DEFAULT 0,
      connector_id  UUID,
      is_active     BOOLEAN NOT NULL DEFAULT TRUE,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

/** Apply one real draft `.up.sql` and record it in the ledger, exactly like the runner. */
export async function applyDraftUp(pool: Pool, file: string): Promise<void> {
  const sql = await readMigrationSql(file, DRAFT_MIGRATIONS_DIR);
  const client = await pool.connect();
  try {
    await applyMigrationSql(client, file, sql);
    await client.query(
      'INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING',
      [file],
    );
  } finally {
    client.release();
  }
}

/** Execute the matching `.down.sql`. */
export async function applyDraftDown(pool: Pool, upFile: string): Promise<void> {
  const downFile = upFile.replace(/\.up\.sql$/, '.down.sql');
  const sql = await fs.readFile(path.join(DRAFT_MIGRATIONS_DIR, downFile), 'utf8');
  const client = await pool.connect();
  try {
    await applyMigrationSql(client, downFile, sql);
  } finally {
    client.release();
  }
}

export interface SeededOrg {
  organizationId: string;
  userId: string;
  projectA: string;
  projectB: string;
  escalationPolicyId: string;
}

/** Seed one organization with two projects, a user and an escalation policy. */
export async function seedOrganization(pool: Pool, label: string): Promise<SeededOrg> {
  const org = await pool.query<{ id: string }>(
    'INSERT INTO organizations (name) VALUES ($1) RETURNING id',
    [`org-${label}`],
  );
  const organizationId = org.rows[0]!.id;

  const user = await pool.query<{ id: string }>(
    'INSERT INTO users (email) VALUES ($1) RETURNING id',
    [`${label}-${Date.now()}@example.test`],
  );
  const projects = await pool.query<{ id: string }>(
    `INSERT INTO projects (org_id, name)
     VALUES ($1, $2), ($1, $3)
     RETURNING id`,
    [organizationId, `${label}-a`, `${label}-b`],
  );
  const policy = await pool.query<{ id: string }>(
    'INSERT INTO alert_escalation_policies (organization_id, name) VALUES ($1, $2) RETURNING id',
    [organizationId, `${label}-policy`],
  );

  return {
    organizationId,
    userId: user.rows[0]!.id,
    projectA: projects.rows[0]!.id,
    projectB: projects.rows[1]!.id,
    escalationPolicyId: policy.rows[0]!.id,
  };
}

export interface SeedRuleOptions {
  name?: string;
  projectId?: string | null;
  enabled?: boolean;
  severity?: 'info' | 'warning' | 'error' | 'critical';
  deletedAt?: Date | null;
  withCondition?: boolean;
  withAction?: boolean;
}

/** Seed one alert rule (plus an optional condition and action) and return its id. */
export async function seedRule(
  pool: Pool,
  org: SeededOrg,
  options: SeedRuleOptions = {},
): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO alert_rules
       (organization_id, name, severity, enabled, created_by, project_id, deleted_at)
     VALUES ($1, $2, $3::alert_severity, $4, $5, $6, $7)
     RETURNING id`,
    [
      org.organizationId,
      options.name ?? `rule-${Math.random().toString(36).slice(2, 10)}`,
      options.severity ?? 'warning',
      options.enabled ?? true,
      org.userId,
      options.projectId ?? null,
      options.deletedAt ?? null,
    ],
  );
  const ruleId = result.rows[0]!.id;

  if (options.withCondition !== false) {
    await pool.query(
      `INSERT INTO alert_rule_conditions
         (rule_id, field_path, operator, threshold_value, lookback_minutes, order_index)
       VALUES ($1, 'errors.rate', 'gt', '5'::jsonb, 15, 0)`,
      [ruleId],
    );
  }
  if (options.withAction !== false) {
    await pool.query(
      `INSERT INTO alert_rule_actions (rule_id, action_type, order_index)
       VALUES ($1, 'notify', 0)`,
      [ruleId],
    );
  }
  return ruleId;
}
