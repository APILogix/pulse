import { readFile } from "node:fs/promises";
import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import { EventAnalyticsRepository } from "../../src/modules/event-analytics/repository.js";
import {
  TelemetryIdentityQuerySchema,
  TelemetryScopeQuerySchema,
} from "../../src/modules/event-analytics/types.js";

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID = "22222222-2222-4222-8222-222222222222";
const ENVIRONMENT = "Customer.Prod_1";

function createRepository() {
  const query = vi.fn(async (_sql: string, _params?: unknown[]) => ({ rows: [], rowCount: 0 }));
  const repository = new EventAnalyticsRepository({ query } as unknown as Pool);
  return { repository, query };
}

function compact(sql: unknown): string {
  return String(sql).replace(/\s+/g, " ").trim();
}

describe("event analytics environment identity", () => {
  it("normalizes strict detail scope and rejects incomplete identities", () => {
    expect(TelemetryIdentityQuerySchema.parse({
      projectId: PROJECT_ID,
      environment: "  Customer.Prod_1  ",
    })).toEqual({ projectId: PROJECT_ID, environment: ENVIRONMENT });

    expect(() => TelemetryIdentityQuerySchema.parse({ projectId: PROJECT_ID })).toThrow();
    expect(() => TelemetryIdentityQuerySchema.parse({
      projectId: PROJECT_ID,
      environment: "bad environment",
    })).toThrow();
    expect(TelemetryScopeQuerySchema.parse({})).toEqual({});
  });

  it("binds project and environment for trace and session detail reads", async () => {
    const { repository, query } = createRepository();

    await repository.getTraceById(ORG_ID, "trace-1", PROJECT_ID, ENVIRONMENT);
    await repository.getSpansByTrace(ORG_ID, "trace-1", PROJECT_ID, ENVIRONMENT);
    await repository.getSession(ORG_ID, "session-1", PROJECT_ID, ENVIRONMENT);

    expect(query).toHaveBeenCalledTimes(3);
    for (const [sql, params] of query.mock.calls) {
      const text = compact(sql);
      expect(text).toContain("organization_id=$1");
      expect(text).toContain("project_id=$3");
      expect(text).toContain("environment=$4");
      expect(params).toEqual([ORG_ID, expect.any(String), PROJECT_ID, ENVIRONMENT]);
    }
  });

  it("disambiguates error-group reads and mutations by project and environment membership", async () => {
    const { repository, query } = createRepository();

    await repository.getErrorGroup(ORG_ID, PROJECT_ID, "fingerprint-1", ENVIRONMENT);
    await repository.updateErrorGroupStatus(
      ORG_ID,
      PROJECT_ID,
      "fingerprint-1",
      ENVIRONMENT,
      "resolved",
      null,
    );

    expect(compact(query.mock.calls[0]![0])).toContain(
      "organization_id=$1 AND project_id=$2 AND fingerprint=$3 AND $4=ANY(environments)",
    );
    expect(query.mock.calls[0]![1]).toEqual([
      ORG_ID,
      PROJECT_ID,
      "fingerprint-1",
      ENVIRONMENT,
    ]);
    expect(compact(query.mock.calls[1]![0])).toContain(
      "WHERE organization_id=$1 AND project_id=$2 AND fingerprint=$3 AND $4=ANY(environments)",
    );
    expect(query.mock.calls[1]![1]).toEqual([
      ORG_ID,
      PROJECT_ID,
      "fingerprint-1",
      ENVIRONMENT,
      "resolved",
      null,
    ]);
  });

  it("preserves project and environment in cron history and user journeys", async () => {
    const { repository, query } = createRepository();

    await repository.getCronHistory(ORG_ID, "nightly", PROJECT_ID, ENVIRONMENT, 25, 0);
    await repository.getUserJourney(
      ORG_ID,
      "user-1",
      { from: new Date("2026-01-01T00:00:00Z"), to: new Date("2026-01-02T00:00:00Z") },
      PROJECT_ID,
      ENVIRONMENT,
      100,
    );

    expect(compact(query.mock.calls[0]![0])).toContain(
      "($3::uuid IS NULL OR project_id=$3) AND ($4::text IS NULL OR environment=$4)",
    );
    expect(query.mock.calls[0]![1]).toEqual([
      ORG_ID,
      "nightly",
      PROJECT_ID,
      ENVIRONMENT,
      25,
      0,
    ]);

    for (const call of query.mock.calls.slice(1)) {
      const text = compact(call[0]);
      expect(text).toContain("($5::uuid IS NULL OR project_id=$5)");
      expect(text).toContain("($6::text IS NULL OR environment=$6)");
      expect(call[1]?.[4]).toBe(PROJECT_ID);
      expect(call[1]?.[5]).toBe(ENVIRONMENT);
    }
  });

  it("keeps trace error correlation and error-group reconciliation inside a project", async () => {
    const { repository, query } = createRepository();

    await repository.listTraces(
      ORG_ID,
      { from: new Date("2026-01-01T00:00:00Z"), to: new Date("2026-01-02T00:00:00Z") },
      { projectId: PROJECT_ID, environment: ENVIRONMENT, errorOnly: true, limit: 25, offset: 0 },
    );
    await repository.refreshErrorGroups(ORG_ID, 24);

    const traceSql = query.mock.calls
      .slice(0, 2)
      .map((call) => compact(call[0]))
      .join(" ");
    expect(traceSql).toContain("s.project_id=t.project_id");
    expect(traceSql).toContain("s.environment=t.environment");

    const refreshSql = compact(query.mock.calls.at(-1)![0]);
    expect(refreshSql).toContain("e2.project_id=ee.project_id");
    expect(refreshSql).toContain("e3.project_id=ee.project_id");
    expect(refreshSql).toContain("e4.project_id=ee.project_id");
  });

  it("keeps project analytics trace expansion in the selected event environment", async () => {
    const source = await readFile(
      new URL("../../src/modules/analytics/repository.ts", import.meta.url),
      "utf8",
    );
    expect(source).toContain("t.project_id=$1 AND t.trace_id=$2 AND t.environment=$3");
    expect(source).toContain("s.project_id=$1 AND s.trace_id=$2 AND s.environment=$3");
    expect(source).toContain("r.project_id=$1 AND r.trace_id=$2 AND r.environment=$3");
    expect(source).toContain("e.project_id=$1 AND e.trace_id=$2 AND e.environment=$3");
  });
});
