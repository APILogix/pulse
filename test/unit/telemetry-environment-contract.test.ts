import { readFile } from "node:fs/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/modules/ingestion/pipeline/request-enrichment.js", () => ({
  RequestEnricher: {
    get: () => ({
      init: vi.fn(async () => {}),
      enrich: vi.fn(() => ({
        geoCountryCode: null,
        geoRegion: null,
        geoAsn: null,
        clientIpHash: null,
        browserFamily: null,
        browserVersionMajor: null,
        osName: null,
        osVersionMajor: null,
        deviceType: null,
        isBot: false,
      })),
    }),
  },
}));

import type { Pool } from "pg";
import type { NormalizedEvent } from "../../src/modules/ingestion/pipeline/event-normalizer.js";
import {
  TelemetryWriter,
  type ScopedEvent,
} from "../../src/modules/ingestion/pipeline/telemetry-writer.js";

const ENVIRONMENT = "Customer.Prod_1";
const OCCURRED_AT = 1_767_225_600_000;

const events: NormalizedEvent[] = [
  { type: "error", eventId: "error-id", message: "boom", timestamp: OCCURRED_AT },
  { type: "message", eventId: "message-id", message: "hello", timestamp: OCCURRED_AT },
  {
    type: "request",
    eventId: "request-id",
    requestId: "request-1",
    url: "/checkout",
    method: "GET",
    statusCode: 200,
    latency: 12,
    timestamp: OCCURRED_AT,
  },
  {
    type: "span",
    eventId: "span-event-id",
    spanId: "span-1",
    traceId: "trace-1",
    name: "db.query",
    startTime: OCCURRED_AT,
    timestamp: OCCURRED_AT,
  },
  {
    type: "trace",
    eventId: "trace-event-id",
    traceId: "trace-1",
    rootSpan: {},
    spanCount: 1,
    timestamp: OCCURRED_AT,
  },
  {
    type: "metric",
    eventId: "metric-id",
    metricName: "requests.total",
    metricType: "counter",
    value: 1,
    timestamp: OCCURRED_AT,
  },
  { type: "log", eventId: "log-id", level: "info", message: "ok", timestamp: OCCURRED_AT },
  {
    type: "profile",
    eventId: "profile-id",
    profileType: "cpu",
    profile: {},
    timestamp: OCCURRED_AT,
  },
  {
    type: "cron_checkin",
    eventId: "cron-id",
    monitorSlug: "nightly",
    status: "ok",
    timestamp: OCCURRED_AT,
  },
  {
    type: "replay",
    eventId: "replay-id",
    sessionId: "session-1",
    segmentId: 0,
    events: [],
    timestamp: OCCURRED_AT,
  },
] as NormalizedEvent[];

function scoped(event: NormalizedEvent): ScopedEvent {
  return {
    orgId: "11111111-1111-1111-1111-111111111111",
    projectId: "22222222-2222-2222-2222-222222222222",
    environment: ENVIRONMENT,
    event,
  } as ScopedEvent;
}

function insertColumns(sql: string): string[] {
  const match = sql.match(/INSERT INTO\s+\S+\s*\(([^)]+)\)/i);
  if (!match?.[1]) throw new Error(`Could not parse insert columns: ${sql}`);
  return match[1].split(",").map((column) => column.trim());
}

describe("TelemetryWriter environment contract", () => {
  let queries: Array<{ text: string; values: unknown[] }>;
  let pool: Pool;

  beforeEach(() => {
    queries = [];
    pool = {
      query: vi.fn(async (text: string, values: unknown[]) => {
        queries.push({ text, values });
        const eventId = values[2];
        return { rows: [{ event_id: eventId }], rowCount: 1 };
      }),
    } as unknown as Pool;
  });

  it("persists the server environment and lossless event document for all ten event families", async () => {
    const result = await new TelemetryWriter(pool).writeBatchDetailed(events.map(scoped));
    expect(result.totalInserted).toBe(10);
    expect(queries).toHaveLength(10);

    for (const query of queries) {
      expect(query.text).not.toContain("environment_id");
      const columns = insertColumns(query.text);
      expect(columns).toContain("environment");
      expect(columns).toContain("metadata");
      expect(columns).toContain("payload");
      expect(columns).toContain("ai_response");
      expect(columns).toContain("occurred_at");

      const environment = query.values[columns.indexOf("environment")];
      const metadata = query.values[columns.indexOf("metadata")];
      const payload = query.values[columns.indexOf("payload")];
      const occurredAt = query.values[columns.indexOf("occurred_at")];
      expect(environment).toBe(ENVIRONMENT);
      expect(JSON.parse(String(metadata))).toMatchObject({ environment: ENVIRONMENT });
      expect(JSON.parse(String(payload)).type).toBeDefined();
      expect(occurredAt).toBe(new Date(OCCURRED_AT).toISOString());
    }
  });
});

describe("Log DB environment migration contract", () => {
  it("fails closed, keeps search environment-aware, and does not recreate legacy telemetry", async () => {
    const [
      environmentMigration,
      searchMigration,
      legacyMigration,
      ingestionMigration,
      usageMigration,
      alertMigration,
      aiMigration,
    ] = await Promise.all([
      readFile(new URL("../../database/migrations/logdb/10_lookup/003_environment_string_contract.up.sql", import.meta.url), "utf8"),
      readFile(new URL("../../database/migrations/logdb/09_search/001_search_indexes.up.sql", import.meta.url), "utf8"),
      readFile(new URL("../../database/migrations/logdb/13_legacy/001_legacy_compat.up.sql", import.meta.url), "utf8"),
      readFile(new URL("../../database/migrations/logdb/02_ingestion/001_ingestion_runtime.up.sql", import.meta.url), "utf8"),
      readFile(new URL("../../database/migrations/logdb/01_usage/001_usage_rollups.up.sql", import.meta.url), "utf8"),
      readFile(new URL("../../database/migrations/logdb/06_alert_runtime/001_alert_runtime.up.sql", import.meta.url), "utf8"),
      readFile(new URL("../../database/migrations/logdb/07_ai_runtime/001_ai_runtime.up.sql", import.meta.url), "utf8"),
    ]);

    expect(environmentMigration.trimStart().startsWith("BEGIN;")).toBe(true);
    expect(environmentMigration).toContain("lack a trustworthy SDK environment string");
    expect(environmentMigration).not.toMatch(/['\"]unknown['\"]/i);
    expect(environmentMigration).not.toMatch(/FROM\s+environment_lookup/i);
    expect(environmentMigration).toContain("metadata=jsonb_build_object(''environment'',environment)");
    expect(environmentMigration).toContain("metadata @> jsonb_build_object(''environment'',environment)");
    expect(environmentMigration).toContain("DROP COLUMN IF EXISTS environment_id");

    expect(searchMigration).toContain("environment TEXT NOT NULL");
    expect(searchMigration).toContain("organization_id,project_id,environment,occurred_at DESC");
    expect(searchMigration).not.toContain("environment_id");

    expect(legacyMigration).toContain("Intentionally inert");
    expect(legacyMigration).not.toMatch(/CREATE\s+TABLE/i);
    expect(legacyMigration).not.toContain("environment_id");

    expect(ingestionMigration).not.toMatch(/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+ingestion_jobs\b/i);
    expect(ingestionMigration).not.toMatch(/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+ingestion_dead_letter_jobs\b/i);
    expect(ingestionMigration).not.toMatch(/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+usage_counter_staging\b/i);

    expect(usageMigration).toContain("Intentionally inert");
    expect(usageMigration).not.toMatch(/CREATE\s+TABLE/i);
    expect(usageMigration).not.toContain("environment_id");

    for (const migration of [alertMigration, aiMigration]) {
      expect(migration).toContain("environment TEXT");
      expect(migration).not.toContain("environment_id");
      expect(migration).toContain("project_id, environment, occurred_at DESC");
    }
  });
});
