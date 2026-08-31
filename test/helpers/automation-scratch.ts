/**
 * Disposable PRIMARY-database harness for automation integration tests.
 *
 * WHY THIS EXISTS
 *   The automation P0 defect was a schema/code mismatch: the runtime tables lived in
 *   the wrong database with the wrong columns, and every existing automation test
 *   passed anyway because they only exercised pure functions. Nothing ran the real
 *   claim/lock/retry SQL against a real schema.
 *
 *   So this harness deliberately applies the REAL, UNMODIFIED migration files from
 *   src/db/postgres/primary_db_draft/14_automation/ and then runs the REAL
 *   AutomationRepository against them. If the migrations and the repository ever
 *   drift apart again, these tests fail instead of silently passing.
 *
 * WHY A FIXTURE CORE INSTEAD OF THE WHOLE DRAFT TREE
 *   Applying every draft migration into an empty database fails at
 *   03_org_identity/001_fixed_tables.sql because billing_provider_type is created
 *   later in the ordering. That is a pre-existing defect in the draft tree and
 *   unrelated to automation. This harness therefore creates only the prerequisite
 *   objects the automation migrations actually reference (organizations, users,
 *   projects, the shared set_updated_at trigger function and the automation enums),
 *   then applies the automation migrations verbatim.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';

const AUTOMATION_MIGRATIONS_DIR = path.resolve(
  process.cwd(),
  'src/db/postgres/primary_db_draft/14_automation',
);

export interface AutomationScratchDb {
  readonly pool: Pool;
  readonly dbName: string;
  destroy(): Promise<void>;
}

function swapDatabase(connectionString: string, database: string): string {
  const url = new URL(connectionString);
  url.pathname = `/${database}`;
  return url.toString();
}

/** True when a server we can create databases on is configured. */
export function scratchDbAvailable(): boolean {
  return typeof process.env.DATABASE_URL === 'string' && process.env.DATABASE_URL.length > 0;
}

export async function createAutomationScratchDb(prefix = 'automation_it'): Promise<AutomationScratchDb> {
  const sourceUrl = process.env.DATABASE_URL;
  if (!sourceUrl) throw new Error('DATABASE_URL is required for automation integration tests');

  const dbName = `${prefix}_${Date.now()}`;
  const adminPool = new Pool({
    connectionString: swapDatabase(sourceUrl, 'postgres'),
    ssl: { rejectUnauthorized: false },
    max: 1,
  });
  await adminPool.query(`CREATE DATABASE ${dbName}`);

  const pool = new Pool({
    connectionString: swapDatabase(sourceUrl, dbName),
    ssl: { rejectUnauthorized: false },
    max: 6,
  });

  return {
    pool,
    dbName,
    async destroy() {
      await pool.end().catch(() => undefined);
      await adminPool.query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
          WHERE datname = $1 AND pid <> pg_backend_pid()`,
        [dbName],
      );
      await adminPool.query(`DROP DATABASE IF EXISTS ${dbName}`);
      await adminPool.end().catch(() => undefined);
    },
  };
}

/**
 * Prerequisites referenced by the automation migrations.
 *
 * Enum label orders mirror the live database (verified with a catalog query), because
 * automation_incidents-style comparisons and `GREATEST(severity)` semantics depend on
 * enum ordering.
 */
export async function applyAutomationFixtureCore(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE EXTENSION IF NOT EXISTS pgcrypto;

    -- Shared updated_at trigger function used by 999_triggers.sql
    CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $fn$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $fn$ LANGUAGE plpgsql;

    -- Immutability guard attached by 999_triggers.sql to automation_workflow_versions
    CREATE OR REPLACE FUNCTION trg_fn_immutable_published_version() RETURNS trigger AS $fn$
    BEGIN
      IF OLD.status = 'published' THEN
        RAISE EXCEPTION 'Cannot update an already-published workflow version';
      END IF;
      RETURN NEW;
    END;
    $fn$ LANGUAGE plpgsql;

    CREATE TABLE organizations (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name       VARCHAR(255) NOT NULL,
      slug       VARCHAR(255) NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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

    -- Referenced by automation_templates.minimum_plan_tier. Label order matters
    -- because plan gating compares tiers ordinally.
    CREATE TYPE billing_plan_tier AS ENUM ('free','starter','growth','business','enterprise');

    -- Automation enums, label order matching live PRIMARY.
    CREATE TYPE automation_action_risk       AS ENUM ('low','medium','high','critical');
    CREATE TYPE automation_approval_status   AS ENUM ('pending','approved','rejected','expired','cancelled');
    CREATE TYPE automation_condition_operator AS ENUM
      ('eq','neq','gt','gte','lt','lte','in','not_in','contains','not_contains','matches','exists','not_exists','between');
    CREATE TYPE automation_run_status        AS ENUM
      ('queued','running','waiting_approval','succeeded','failed','cancelled','skipped','timed_out');
    CREATE TYPE automation_step_status       AS ENUM
      ('queued','running','waiting_approval','succeeded','failed','skipped','cancelled','timed_out');
    CREATE TYPE automation_template_scope    AS ENUM ('platform','organization');
    CREATE TYPE automation_trigger_kind      AS ENUM ('event','schedule','manual','webhook');
    CREATE TYPE automation_workflow_scope    AS ENUM ('organization','project','platform');
    CREATE TYPE automation_workflow_status   AS ENUM ('draft','active','paused','archived','disabled');
  `);
}

/**
 * Apply the real automation migration files, in the same alphabetical order the
 * project's own runner (scripts/run-primary-draft-folder.ts) uses.
 *
 * Control-plane files are applied before 002_* because 002 has FKs onto them. The
 * 001_* files are alphabetically ordered such that `actions` precedes `workflows`,
 * which would break its FK on a truly empty database, so they are ordered explicitly
 * here by dependency. That ordering weakness in the draft tree is noted rather than
 * hidden: it only matters for a from-scratch build, which is exactly what this does.
 */
export const AUTOMATION_MIGRATION_ORDER = [
  '001_create_automation_templates.sql',
  '001_create_automation_workflows.sql',
  '001_create_automation_workflow_versions.sql',
  '001_create_automation_template_versions.sql',
  '001_create_automation_triggers.sql',
  '001_create_automation_conditions.sql',
  '001_create_automation_actions.sql',
  '001_create_automation_approvals.sql',
  '002_create_automation_runtime.sql',
  '003_remove_unbacked_automation_templates.sql',
  '999_triggers.sql',
] as const;

export async function applyAutomationMigrations(pool: Pool): Promise<string[]> {
  const applied: string[] = [];
  for (const file of AUTOMATION_MIGRATION_ORDER) {
    const sql = await fs.readFile(path.join(AUTOMATION_MIGRATIONS_DIR, file), 'utf8');
    await pool.query(sql);
    applied.push(file);
  }
  return applied;
}

export interface AutomationFixtures {
  orgId: string;
  otherOrgId: string;
  userId: string;
  projectId: string;
}

/** Two organizations so tenant isolation can be tested for real. */
export async function seedAutomationFixtures(pool: Pool): Promise<AutomationFixtures> {
  const user = await pool.query(`INSERT INTO users (email) VALUES ('owner@test.local') RETURNING id`);
  const org = await pool.query(
    `INSERT INTO organizations (name, slug) VALUES ('Primary Org','primary-org') RETURNING id`,
  );
  const other = await pool.query(
    `INSERT INTO organizations (name, slug) VALUES ('Other Org','other-org') RETURNING id`,
  );
  const project = await pool.query(
    `INSERT INTO projects (org_id, name) VALUES ($1,'Proj') RETURNING id`,
    [org.rows[0].id],
  );
  return {
    orgId: org.rows[0].id,
    otherOrgId: other.rows[0].id,
    userId: user.rows[0].id,
    projectId: project.rows[0].id,
  };
}

/** Create an enabled workflow with one published version, a trigger and N actions. */
export async function createEnabledWorkflow(
  pool: Pool,
  f: AutomationFixtures,
  opts: {
    slug?: string;
    sourceModule?: string;
    sourceEvent?: string;
    cooldownSeconds?: number;
    actionTypes?: string[];
    enabled?: boolean;
    triggerKind?: 'event' | 'schedule';
    scheduleCron?: string | null;
  } = {},
): Promise<{ workflowId: string; versionId: string; triggerId: string; actionIds: string[] }> {
  const slug = opts.slug ?? `wf-${Math.random().toString(36).slice(2, 8)}`;
  const enabled = opts.enabled ?? true;

  const wf = await pool.query(
    `INSERT INTO automation_workflows
       (organization_id, created_by, name, slug, workflow_type, scope, status, is_enabled, current_version)
     VALUES ($1,$2,$3,$4,'custom','organization',$5,$6,1) RETURNING id`,
    [f.orgId, f.userId, `WF ${slug}`, slug, enabled ? 'active' : 'draft', enabled],
  );
  const workflowId = wf.rows[0].id;

  const ver = await pool.query(
    `INSERT INTO automation_workflow_versions
       (workflow_id, version, status, definition, checksum, published_at, published_by)
     VALUES ($1,1,'published','{}'::jsonb,$2,NOW(),$3) RETURNING id`,
    [workflowId, `sha-${slug}`, f.userId],
  );
  const versionId = ver.rows[0].id;

  const trg = await pool.query(
    `INSERT INTO automation_triggers
       (workflow_id, workflow_version_id, trigger_kind, trigger_type, source_module, source_event,
        schedule_cron, is_enabled, cooldown_seconds)
     VALUES ($1,$2,$3,$4,$5,$6,$7,TRUE,$8) RETURNING id`,
    [
      workflowId, versionId,
      opts.triggerKind ?? 'event',
      opts.triggerKind === 'schedule' ? 'schedule.cron' : 'alert.event.created',
      opts.sourceModule ?? 'alerting',
      opts.sourceEvent ?? 'alert.created',
      opts.scheduleCron ?? null,
      opts.cooldownSeconds ?? 0,
    ],
  );

  const actionIds: string[] = [];
  const types = opts.actionTypes ?? ['noop'];
  for (let i = 0; i < types.length; i += 1) {
    const a = await pool.query(
      `INSERT INTO automation_actions
         (workflow_id, workflow_version_id, action_key, action_type, sort_order, timeout_seconds,
          max_attempts, retry_backoff_seconds)
       VALUES ($1,$2,$3,$4,$5,30,3,1) RETURNING id`,
      [workflowId, versionId, `step-${i}`, types[i], i],
    );
    actionIds.push(a.rows[0].id);
  }

  return { workflowId, versionId, triggerId: trg.rows[0].id, actionIds };
}
