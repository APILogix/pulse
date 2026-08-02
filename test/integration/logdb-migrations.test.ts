import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { Client } from "pg";

const LOGDB_ROOT = fileURLToPath(new URL("../../database/migrations/logdb/", import.meta.url));
const MIGRATIONS = [
  "00_shared/001_foundation.up.sql",
  "01_usage/001_usage_rollups.up.sql",
  "02_ingestion/001_ingestion_runtime.up.sql",
  "03_observability/001_canonical_events.up.sql",
  "03_observability/002_typed_event_runtime.up.sql",
  "03_observability/003_add_events_metrics_request_id.up.sql",
  "03_observability/004_align_event_fields_and_ai.up.sql",
  "03_observability/005_create_sdk_event_tables_if_missing.up.sql",
  "04_analytics/001_analytics_runtime.up.sql",
  "04_analytics/002_typed_analytics_runtime.up.sql",
  "05_connectors_runtime/001_connector_runtime.up.sql",
  "06_alert_runtime/001_alert_runtime.up.sql",
  "07_ai_runtime/001_ai_runtime.up.sql",
  "08_automation_runtime/001_automation_runtime.up.sql",
  "09_search/001_search_indexes.up.sql",
  "10_lookup/001_lookup_dimensions.up.sql",
  "10_lookup/002_environment_sdk_config_lookup.up.sql",
  "10_lookup/003_environment_string_contract.up.sql",
  "11_geo/001_geo_reference.up.sql",
  "12_retention/001_retention.up.sql",
  "13_legacy/001_legacy_compat.up.sql",
] as const;

const EVENT_TABLES = [
  "events_requests",
  "events_errors",
  "events_logs",
  "events_metrics",
  "events_spans",
  "events_traces",
  "events_messages",
  "events_profiles",
  "events_replays",
  "events_cron_checkins",
] as const;

const SEARCH_TABLES = [
  "log_search_index",
  "trace_search_index",
  "error_search_index",
] as const;


const DERIVED_ENVIRONMENT_TABLES = [
  "alert_rule_executions",
  "alert_events",
  "alert_event_batches",
  "alert_event_history",
  "alert_acknowledgments",
  "alert_dead_letter_events",
  "alert_delivery_attempts",
  "alert_metrics",
  "alert_throttle_windows",
  "ai_requests",
  "ai_responses",
  "ai_jobs",
  "ai_cache",
  "ai_event_insights",
  "ai_evaluations",
  "ai_reports",
  "ai_usage_receipts",
  "ai_tool_calls",
  "ai_feedback",
] as const;

describe("canonical Log DB migrations", () => {
  let container: PostgreSqlContainer | null = null;
  let client: Client | null = null;
  let runtimeUnavailableReason: string | null = null;

  beforeAll(async () => {
    try {
      container = await new PostgreSqlContainer("postgres:16-alpine").start();
      client = new Client({ connectionString: container.getConnectionUri() });
      await client.connect();
    } catch (error) {
      runtimeUnavailableReason = error instanceof Error ? error.message : String(error);
    }
  });

  afterAll(async () => {
    await client?.end();
    client = null;
    await container?.stop();
    container = null;
  });

  it("installs one environment-string telemetry schema with exact metadata", async () => {
    if (!client) {
      console.warn(
        `Skipping Log DB migration integration test: ${runtimeUnavailableReason ?? "container runtime unavailable"}`,
      );
      return;
    }

    for (const migration of MIGRATIONS) {
      const sql = await readFile(`${LOGDB_ROOT}/${migration}`, "utf8");
      await client.query(sql);
    }

    const forbiddenEnvironmentIds = await client.query<{
      table_name: string;
      column_name: string;
    }>(
      `SELECT table_name,column_name
         FROM information_schema.columns
        WHERE table_schema='public'
          AND column_name='environment_id'
          AND table_name <> ALL($1::text[])
        ORDER BY table_name`,
      [["environment_lookup", "api_key_lookup", "environment_sdk_config_lookup"]],
    );
    expect(forbiddenEnvironmentIds.rows).toEqual([]);

    const environmentColumns = await client.query<{
      table_name: string;
      is_nullable: string;
      data_type: string;
    }>(
      `SELECT table_name,is_nullable,data_type
         FROM information_schema.columns
        WHERE table_schema='public'
          AND table_name=ANY($1::text[])
          AND column_name='environment'
        ORDER BY table_name`,
      [[...EVENT_TABLES, ...SEARCH_TABLES]],
    );
    expect(environmentColumns.rows).toHaveLength(EVENT_TABLES.length + SEARCH_TABLES.length);
    expect(environmentColumns.rows.every((row) => row.is_nullable === "NO")).toBe(true);
    expect(environmentColumns.rows.every((row) => row.data_type === "text")).toBe(true);

    const derivedEnvironmentColumns = await client.query<{
      table_name: string;
      is_nullable: string;
      data_type: string;
    }>(
      `SELECT table_name,is_nullable,data_type
         FROM information_schema.columns
        WHERE table_schema='public'
          AND table_name=ANY($1::text[])
          AND column_name='environment'
        ORDER BY table_name`,
      [[...DERIVED_ENVIRONMENT_TABLES]],
    );
    expect(derivedEnvironmentColumns.rows).toHaveLength(DERIVED_ENVIRONMENT_TABLES.length);
    expect(derivedEnvironmentColumns.rows.every((row) => row.is_nullable === "YES")).toBe(true);
    expect(derivedEnvironmentColumns.rows.every((row) => row.data_type === "text")).toBe(true);

    const occurredAt = "2026-07-30T10:00:00.000Z";
    const inserted = await client.query<{
      environment: string;
      metadata: Record<string, unknown>;
      timestamp: Date;
      occurred_at: Date;
      payload: Record<string, unknown>;
    }>(
      `INSERT INTO events_errors(
         organization_id,project_id,environment,event_id,message,occurred_at,metadata
       ) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)
       RETURNING environment,metadata,timestamp,occurred_at,payload`,
      [
        "11111111-1111-4111-8111-111111111111",
        "22222222-2222-4222-8222-222222222222",
        "Customer.Prod_1",
        "error-event-1",
        "boom",
        occurredAt,
        JSON.stringify({ environment: "wrong", extra: true }),
      ],
    );
    expect(inserted.rows[0]).toMatchObject({
      environment: "Customer.Prod_1",
      metadata: { environment: "Customer.Prod_1" },
    });
    expect(inserted.rows[0]!.metadata).toEqual({ environment: "Customer.Prod_1" });
    expect(inserted.rows[0]!.timestamp.toISOString()).toBe(occurredAt);
    expect(inserted.rows[0]!.occurred_at.toISOString()).toBe(occurredAt);
    expect(inserted.rows[0]!.payload).toMatchObject({
      environment: "Customer.Prod_1",
      event_id: "error-event-1",
      message: "boom",
    });

    await expect(client.query(
      `INSERT INTO events_logs(
         organization_id,project_id,environment,event_id,message,occurred_at
       ) VALUES($1,$2,'bad environment',$3,'invalid',NOW())`,
      [
        "11111111-1111-4111-8111-111111111111",
        "22222222-2222-4222-8222-222222222222",
        "invalid-log-1",
      ],
    )).rejects.toThrow();

    await client.query(
      `INSERT INTO log_search_index(
         organization_id,project_id,environment,source_table,search_text,occurred_at
       ) VALUES($1,$2,$3,'events_logs','checkout failed',$4)`,
      [
        "11111111-1111-4111-8111-111111111111",
        "22222222-2222-4222-8222-222222222222",
        "Customer.Prod_1",
        occurredAt,
      ],
    );
    await expect(client.query(
      `INSERT INTO log_search_index(
         organization_id,project_id,environment,source_table,search_text,occurred_at
       ) VALUES($1,$2,'bad environment','events_logs','invalid',NOW())`,
      [
        "11111111-1111-4111-8111-111111111111",
        "22222222-2222-4222-8222-222222222222",
      ],
    )).rejects.toThrow();

    const forbiddenControlPlaneTables = await client.query<{ table_name: string }>(
      `SELECT table_name
         FROM information_schema.tables
        WHERE table_schema='public'
          AND table_name=ANY($1::text[])
        ORDER BY table_name`,
      [[
        "ingestion_jobs",
        "ingestion_dead_letter_jobs",
        "usage_counter_staging",
        "organization_usage_minute",
        "organization_usage_hourly",
        "organization_usage_daily",
        "project_usage_minute",
        "project_usage_hourly",
        "project_usage_daily",
        "environment_usage_minute",
        "environment_usage_hourly",
        "environment_usage_daily",
        "api_key_usage_minute",
        "api_key_usage_hourly",
        "api_key_usage_daily",
      ]],
    );
    expect(forbiddenControlPlaneTables.rows).toEqual([]);

    const legacyTables = await client.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema='public'
          AND table_name=ANY($1::text[])`,
      [["spans", "traces", "metrics", "logs", "profiles", "cron_checkins", "replays", "messages", "sdk_sessions", "errors", "requests"]],
    );
    expect(legacyTables.rows).toEqual([]);
  });
});
