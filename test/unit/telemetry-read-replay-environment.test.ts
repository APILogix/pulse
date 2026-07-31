import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.NODE_ENV = "development";
  process.env.DATABASE_URL = "postgresql://localhost:5432/test";
  process.env.REDIS_URL = "redis://localhost:6379";
  process.env.JWT_SECRET = "jwt-secret-jwt-secret-jwt-secret-jwt-secret";
  process.env.JWT_REFRESH_SECRET = "refresh-secret-refresh-secret-refresh-secret";
  process.env.COOKIE_SECRET = "cookie-secret-cookie-secret-cookie-secret";
  process.env.AUTH_TOKEN_SECRET = "auth-token-secret-auth-token-secret";
  process.env.ENCRYPTION_KEY = "encryption-key-encryption-key-32";
});

vi.mock("../../src/lib/pgboss.js", () => {
  const pgboss = {
    createQueue: vi.fn(async () => {}),
    insert: vi.fn(async () => ["job-id"]),
    send: vi.fn(async () => "job-id"),
    on: vi.fn(),
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
  };
  return {
    pgboss,
    startPgBoss: vi.fn(async () => {}),
    stopPgBoss: vi.fn(async () => {}),
  };
});

vi.mock("../../src/shared/logdb/lookup-sync.js", () => ({
  syncApiKeyLookupToLogDbBestEffort: vi.fn(),
  syncEnvironmentLookupToLogDbBestEffort: vi.fn(),
  syncEnvironmentSdkConfigLookupToLogDbBestEffort: vi.fn(),
  syncProjectLookupToLogDbBestEffort: vi.fn(),
}));

import type { Pool } from "pg";
import { pgboss } from "../../src/lib/pgboss.js";
import { IngestionService } from "../../src/modules/ingestion/service.js";
import { TelemetryReader } from "../../src/modules/ingestion/pipeline/telemetry-reader.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const ORG_ID = "22222222-2222-4222-8222-222222222222";
const ENVIRONMENT = "Customer.Prod_1";

function poolWithQuery(query: (text: string, values?: unknown[]) => Promise<unknown>): Pool {
  return { query: vi.fn(query) } as unknown as Pool;
}

function errorRow() {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    organization_id: ORG_ID,
    project_id: PROJECT_ID,
    environment: ENVIRONMENT,
    // Deliberately untrusted legacy metadata: the read DTO must reconstruct
    // exactly { environment } from the normalized storage column.
    metadata: { environment: "wrong", severity: "legacy" },
    event_id: "error-event-1",
    request_id: "request-1",
    message: "boom",
    error_name: "TypeError",
    fingerprint: "fp-1",
    stack_frames: [],
    contexts: { ignored: true },
    breadcrumbs: [],
    severity: "error",
    timestamp: "2026-01-01T00:00:00.000Z",
    created_at: "2026-01-01T00:00:01.000Z",
  };
}

function fakeWriter(overrides: Record<string, unknown> = {}) {
  return {
    pool: poolWithQuery(async () => ({ rows: [], rowCount: 0 })),
    resolveApiKey: vi.fn(async () => null),
    updateApiKeyLastUsed: vi.fn(async () => {}),
    healthCheck: vi.fn(async () => true),
    getEventsForReplay: vi.fn(async () => []),
    getProjectPlanContext: vi.fn(async () => ({ orgId: ORG_ID, planTier: "growth" })),
    ...overrides,
  };
}

function buildService(controlPool: Pool, writer: ReturnType<typeof fakeWriter>): IngestionService {
  return new IngestionService(
    controlPool,
    writer as never,
    {
      maxBatchSize: 1000,
      defaultRateLimitPerSecond: 1_000_000,
      defaultRateLimitPerMinute: 1_000_000,
      replayMaxEvents: 100,
      jobChunkSize: 100,
    },
  );
}

describe("TelemetryReader environment contract", () => {
  it("applies the environment predicate to error list and count SQL and returns exact metadata", async () => {
    const query = vi.fn(async (text: string, values?: unknown[]) => {
      if (text.includes("COUNT(*)")) return { rows: [{ total: "1" }], rowCount: 1 };
      return { rows: [errorRow()], rowCount: 1 };
    });
    const reader = new TelemetryReader({ query } as unknown as Pool);

    const result = await reader.listErrorEvents({
      projectId: PROJECT_ID,
      environment: ENVIRONMENT,
      limit: 50,
      offset: 0,
    });

    expect(query).toHaveBeenCalledTimes(2);
    const [listSql, listValues] = query.mock.calls[0] as unknown as [string, unknown[]];
    const [countSql, countValues] = query.mock.calls[1] as unknown as [string, unknown[]];
    expect(listSql).toContain("e.environment = $2");
    expect(countSql).toContain("e.environment = $2");
    expect(listValues).toEqual([PROJECT_ID, ENVIRONMENT, 50, 0]);
    expect(countValues).toEqual([PROJECT_ID, ENVIRONMENT]);
    expect(result.data[0]).toMatchObject({
      environment: ENVIRONMENT,
      metadata: { environment: ENVIRONMENT },
    });
    expect(result.data[0]?.metadata).toEqual({ environment: ENVIRONMENT });
  });

  it("filters replay SQL by environment and carries each stored environment", async () => {
    const query = vi.fn(async (text: string, values?: unknown[]) => {
      const type = text.includes("events_errors") ? "error" : "log";
      const environment = type === "error" ? "production" : "preview";
      return {
        rows: [{
          id: `${type}-row`,
          details: {
            id: `${type}-row`,
            organization_id: ORG_ID,
            project_id: PROJECT_ID,
            environment,
            timestamp: "2026-01-01T00:00:00.000Z",
            created_at: "2026-01-01T00:00:01.000Z",
            message: `${type}-message`,
            error_name: "Error",
            fingerprint: "fp",
            level: "info",
          },
        }],
        rowCount: 1,
      };
    });
    const reader = new TelemetryReader({ query } as unknown as Pool);

    const events = await reader.getEventsForReplay(
      PROJECT_ID,
      "2026-01-01T00:00:00.000Z",
      "2026-01-02T00:00:00.000Z",
      ["error", "log"],
      10,
      ENVIRONMENT,
    );

    expect(query).toHaveBeenCalledTimes(2);
    for (const [sql, values] of query.mock.calls as unknown as Array<[string, unknown[]]>) {
      expect(sql).toContain("($5::text IS NULL OR e.environment = $5)");
      expect(values[4]).toBe(ENVIRONMENT);
    }
    expect(events.map((event) => event.environment)).toEqual(["production", "preview"]);
    expect(events.every((event) => !("environmentId" in event))).toBe(true);
  });
});

describe("historical and DLQ replay environment contract", () => {
  let service: IngestionService | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(pgboss.insert).mockResolvedValue(["job-id"]);
  });

  afterEach(async () => {
    await service?.shutdown();
    service = null;
  });

  it("emits separate jobs for each stored environment without synthesizing replay/unknown", async () => {
    const getEventsForReplay = vi.fn(async () => [
      {
        id: "event-a",
        type: "error",
        projectId: PROJECT_ID,
        orgId: ORG_ID,
        environment: "production",
        receivedAt: 1,
        batchId: "old-a",
        payload: { type: "error", message: "a", timestamp: 1 },
      },
      {
        id: "event-b",
        type: "error",
        projectId: PROJECT_ID,
        orgId: ORG_ID,
        environment: "preview",
        receivedAt: 2,
        batchId: "old-b",
        payload: { type: "error", message: "b", timestamp: 2 },
      },
    ]);
    const writer = fakeWriter({ getEventsForReplay });
    service = buildService(poolWithQuery(async () => ({ rows: [], rowCount: 0 })), writer);

    const result = await service.replayEvents({
      projectId: PROJECT_ID,
      startTime: "2026-01-01T00:00:00.000Z",
      endTime: "2026-01-02T00:00:00.000Z",
    });

    expect(result.queued).toBe(2);
    expect(getEventsForReplay).toHaveBeenCalledWith(
      PROJECT_ID,
      "2026-01-01T00:00:00.000Z",
      "2026-01-02T00:00:00.000Z",
      undefined,
      100,
      undefined,
    );
    const ingest = vi.mocked(pgboss.insert).mock.calls.find(([queue]) => queue === "ingest.error");
    expect(ingest).toBeDefined();
    const items = ingest?.[1] as Array<{ data: { metadata: { environment: string; replay?: boolean } } }>;
    expect(items).toHaveLength(2);
    expect(items.map((item) => item.data.metadata.environment).sort()).toEqual(["preview", "production"]);
    expect(items.every((item) => item.data.metadata.replay === true)).toBe(true);
    expect(JSON.stringify(items)).not.toContain('"environment":"replay"');
    expect(JSON.stringify(items)).not.toContain('"environment":"unknown"');
  });

  it("preserves validation-DLQ environment and rejects old bare rows", async () => {
    const validPayload = {
      sourceQueue: "ingest.error",
      organizationId: ORG_ID,
      projectId: PROJECT_ID,
      environment: ENVIRONMENT,
      eventType: "error",
      payload: [{ event: { type: "error", message: "boom" }, detail: "invalid" }],
      failedAt: "2026-01-01T00:00:00.000Z",
      error: "validation_failed",
    };
    let selectedPayload: unknown = validPayload;
    const query = vi.fn(async (text: string) => {
      if (text.includes("SELECT id, queue")) {
        return {
          rows: [{
            id: "dlq-1",
            queue: "ingest.error",
            job_type: "error",
            org_id: ORG_ID,
            project_id: PROJECT_ID,
            payload: selectedPayload,
          }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 1 };
    });
    service = buildService({ query } as unknown as Pool, fakeWriter());

    await service.reprocessDLQJob("dlq-1", "operator-1");
    let ingest = vi.mocked(pgboss.insert).mock.calls.find(([queue]) => queue === "ingest.error");
    let item = (ingest?.[1] as Array<{ data: { metadata: { environment: string }; events: unknown[] } }>)[0];
    expect(item?.data.metadata.environment).toBe(ENVIRONMENT);
    expect(item?.data.events).toEqual([{ type: "error", message: "boom" }]);

    vi.mocked(pgboss.insert).mockClear();
    selectedPayload = { type: "error", message: "legacy bare event" };
    await expect(service.reprocessDLQJob("dlq-1", "operator-1")).rejects.toThrow("JOB_NOT_FOUND");
    ingest = vi.mocked(pgboss.insert).mock.calls.find(([queue]) => queue === "ingest.error");
    expect(ingest).toBeUndefined();
  });
});
