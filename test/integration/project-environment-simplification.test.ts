import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { Client } from "pg";
import { DRAFT_MIGRATIONS_DIR, readMigrationSql } from "../../scripts/lib/migrations.js";

describe("project environment forward simplification", () => {
  let container: PostgreSqlContainer | null = null;
  let client: Client | null = null;
  let unavailable: string | null = null;

  beforeAll(async () => {
    try {
      container = await new PostgreSqlContainer("postgres:16-alpine").start();
      client = new Client({ connectionString: container.getConnectionUri() });
      await client.connect();
      await client.query(`
        CREATE EXTENSION IF NOT EXISTS pgcrypto;
        CREATE TYPE project_environment_type AS ENUM (
          'production', 'staging', 'development', 'custom'
        );
        CREATE TABLE project_environments (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          project_id UUID NOT NULL,
          organization_id UUID NOT NULL,
          name VARCHAR(100) NOT NULL,
          slug VARCHAR(100) NOT NULL,
          description TEXT,
          is_default BOOLEAN NOT NULL DEFAULT FALSE,
          is_active BOOLEAN NOT NULL DEFAULT TRUE,
          color VARCHAR(20),
          icon VARCHAR(255),
          created_by_user_id UUID,
          created_by_api_key_id UUID,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          deleted_at TIMESTAMPTZ,
          version INTEGER NOT NULL DEFAULT 1,
          rate_limit_per_second INTEGER,
          rate_limit_per_minute INTEGER,
          rate_limit_per_hour INTEGER,
          burst_limit INTEGER,
          allowed_event_types TEXT[] NOT NULL DEFAULT '{}',
          max_event_size_bytes INTEGER,
          max_batch_size INTEGER,
          require_https BOOLEAN NOT NULL DEFAULT TRUE,
          ip_allowlist INET[],
          ip_blocklist INET[],
          alert_email VARCHAR(255),
          alert_webhook_url VARCHAR(500),
          CONSTRAINT project_environments_slug_check CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
        );
        CREATE UNIQUE INDEX uq_project_environments_active_slug ON project_environments(project_id, slug) WHERE deleted_at IS NULL;
        CREATE UNIQUE INDEX uq_project_environments_default ON project_environments(project_id) WHERE is_default AND deleted_at IS NULL;
        CREATE UNIQUE INDEX uq_project_environments_tenant_id ON project_environments(id, project_id, organization_id);
        CREATE INDEX idx_project_environments_tenant ON project_environments(organization_id, project_id, is_active) WHERE deleted_at IS NULL;
      `);
    } catch (error) {
      unavailable = error instanceof Error ? error.message : String(error);
    }
  }, 60_000);

  afterAll(async () => {
    await client?.end();
    await container?.stop();
  });

  it("backfills types, removes obsolete columns, and preserves SDK config provisioning", async () => {
    if (!client) {
      console.warn(`Skipping environment migration integration test: ${unavailable ?? "container unavailable"}`);
      return;
    }
    await client.query(`
      CREATE TABLE project_environment_sdk_configs (
        id UUID PRIMARY KEY, organization_id UUID NOT NULL, project_id UUID NOT NULL,
        environment_id UUID NOT NULL, published_revision_id UUID NOT NULL,
        current_revision INTEGER NOT NULL, current_hash CHAR(64) NOT NULL
      );
      CREATE TABLE project_environment_sdk_config_revisions (
        id UUID PRIMARY KEY, config_id UUID NOT NULL, organization_id UUID NOT NULL,
        project_id UUID NOT NULL, environment_id UUID NOT NULL, revision_number INTEGER NOT NULL,
        config_value JSONB NOT NULL, config_hash CHAR(64) NOT NULL,
        change_type VARCHAR(20) NOT NULL, change_summary TEXT
      );
      CREATE OR REPLACE FUNCTION provision_environment_sdk_config() RETURNS trigger AS $$
      BEGIN
        PERFORM NEW.created_by_user_id;
        RETURN NEW;
      END; $$ LANGUAGE plpgsql;
      CREATE TRIGGER trg_project_environments_sdk_config AFTER INSERT ON project_environments
        FOR EACH ROW EXECUTE FUNCTION provision_environment_sdk_config();
    `);
    const projectId = "11111111-1111-4111-8111-111111111111";
    const organizationId = "22222222-2222-4222-8222-222222222222";
    await client.query(`DROP TRIGGER trg_project_environments_sdk_config ON project_environments`);
    await client.query(
      `INSERT INTO project_environments(project_id,organization_id,name,slug,color,is_default) VALUES
       ($1,$2,'Production','production','#16A34A',TRUE),
       ($1,$2,'Pre-production','preproduction','#EA580C',FALSE),
       ($1,$2,'QA','qa','#7C3AED',FALSE),
       ($1,$2,'Customer A','customer-a',NULL,FALSE)`,
      [projectId, organizationId],
    );
    await client.query(`CREATE TRIGGER trg_project_environments_sdk_config AFTER INSERT ON project_environments
      FOR EACH ROW EXECUTE FUNCTION provision_environment_sdk_config()`);

    const sql = await readMigrationSql(
      "04_projects/017_simplify_project_environments.up.sql",
      DRAFT_MIGRATIONS_DIR,
    );
    await client.query(sql);

    const columns = await client.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema='public' AND table_name='project_environments' ORDER BY ordinal_position`,
    );
    expect(columns.rows.map((entry) => entry.column_name)).toEqual([
      "id", "project_id", "organization_id", "name", "slug", "description",
      "is_default", "is_active", "color", "created_at", "updated_at", "deleted_at", "type",
    ]);

    const types = await client.query<{ slug: string; type: string; color: string }>(
      `SELECT slug,type::text,color FROM project_environments ORDER BY slug`,
    );
    expect(types.rows).toEqual([
      { slug: "customer-a", type: "custom", color: "#64748B" },
      { slug: "preproduction", type: "pre_production", color: "#EA580C" },
      { slug: "production", type: "production", color: "#16A34A" },
      { slug: "qa", type: "testing", color: "#7C3AED" },
    ]);

    const inserted = await client.query<{ id: string }>(
      `INSERT INTO project_environments(
         project_id,organization_id,name,slug,type,color,is_default,is_active
       ) VALUES($1,$2,'Preview','preview','preview','#DB2777',FALSE,TRUE) RETURNING id`,
      [projectId, organizationId],
    );
    const provisioned = await client.query<{ heads: number; revisions: number }>(
      `SELECT
        (SELECT count(*)::int FROM project_environment_sdk_configs WHERE environment_id=$1) heads,
        (SELECT count(*)::int FROM project_environment_sdk_config_revisions WHERE environment_id=$1) revisions`,
      [inserted.rows[0]!.id],
    );
    expect(provisioned.rows[0]).toEqual({ heads: 1, revisions: 1 });

    await expect(client.query(
      `INSERT INTO project_environments(project_id,organization_id,name,slug,type,color)
       VALUES($1,$2,'Duplicate','production','custom','#64748B')`,
      [projectId, organizationId],
    )).rejects.toMatchObject({ code: "23505" });
    await expect(client.query(
      `INSERT INTO project_environments(project_id,organization_id,name,slug,type,color,is_default,is_active)
       VALUES($1,$2,'Inactive default','inactive-default','custom','#64748B',TRUE,FALSE)`,
      [projectId, organizationId],
    )).rejects.toMatchObject({ code: "23514" });
    await expect(client.query(
      `INSERT INTO project_environments(project_id,organization_id,name,slug,type,color)
       VALUES($1,$2,'Bad color','bad-color','custom','blue')`,
      [projectId, organizationId],
    )).rejects.toMatchObject({ code: "23514" });
  }, 60_000);
});