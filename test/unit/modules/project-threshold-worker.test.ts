import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
const ingestEvent = vi.fn();
const resolveEvent = vi.fn();
const insertHistory = vi.fn();

vi.mock("../../../src/config/database.js", () => ({ pool: { query } }));
vi.mock("../../../src/modules/alerting/events/events.service.js", () => ({
  EventsService: class { ingestEvent = ingestEvent; },
}));
vi.mock("../../../src/modules/alerting/repository.js", () => ({
  AlertingRepository: class { resolveEvent = resolveEvent; insertHistory = insertHistory; },
}));

const logger = {
  child: vi.fn().mockReturnThis(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
};

function threshold(overrides: Record<string, unknown> = {}) {
  return {
    id: "10000000-0000-4000-8000-000000000001",
    organization_id: "10000000-0000-4000-8000-000000000002",
    project_id: "10000000-0000-4000-8000-000000000003",
    environment_id: null,
    threshold_key: "error_rate",
    metric_name: "error_rate",
    metric_source: "project_usage_minute",
    category: "errors",
    severity: "critical",
    comparison_operator: ">=",
    threshold_value: "5",
    threshold_unit: "percent",
    evaluation_window_minutes: 5,
    cooldown_minutes: 15,
    consecutive_breaches: 1,
    enabled: true,
    notify_on_recovery: true,
    last_triggered_at: null,
    last_recovered_at: null,
    current_breaches: 0,
    is_breaching: false,
    last_evaluated_at: null,
    created_by: null, updated_by: null, created_at: new Date(), updated_at: new Date(), deleted_at: null, version: 1,
    ...overrides,
  };
}

describe("ProjectThresholdWorker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveEvent.mockResolvedValue(undefined);
    insertHistory.mockResolvedValue(undefined);
    ingestEvent.mockResolvedValue({});
  });

  it("loads only project thresholds and emits a project-scoped event after a qualified breach", async () => {
    query
      .mockResolvedValueOnce({ rows: [threshold()] })
      .mockResolvedValueOnce({ rows: [{ value: 10 }] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });
    const { ProjectThresholdWorker } = await import(
      "../../../src/modules/projects/alerts/thresholds/threshold.worker.js"
    );

    const result = await new ProjectThresholdWorker(logger as never).runTick();

    expect(result).toMatchObject({ due: 1, evaluated: 1, fired: 1, recovered: 0, failed: 0 });
    expect(String(query.mock.calls[0]?.[0])).toContain("FROM project_alert_thresholds");
    expect(String(query.mock.calls[0]?.[0])).not.toContain("organization_alert_thresholds");
    expect(ingestEvent).toHaveBeenCalledWith(
      threshold().organization_id,
      expect.objectContaining({
        projectId: threshold().project_id,
        fingerprint: `project-threshold:${threshold().id}`,
        payload: expect.objectContaining({ projectId: threshold().project_id, category: "errors" }),
      }),
    );
  });

  it("persists consecutive breaches without firing before the configured count", async () => {
    query
      .mockResolvedValueOnce({ rows: [threshold({ consecutive_breaches: 2 })] })
      .mockResolvedValueOnce({ rows: [{ value: 10 }] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });
    const { ProjectThresholdWorker } = await import(
      "../../../src/modules/projects/alerts/thresholds/threshold.worker.js"
    );

    const result = await new ProjectThresholdWorker(logger as never).runTick();

    expect(result.fired).toBe(0);
    expect(ingestEvent).not.toHaveBeenCalled();
    expect(query.mock.calls[2]?.[1]).toEqual(expect.arrayContaining([threshold().id, 1, false]));
  });

  it("resolves firing project-threshold events before emitting recovery", async () => {
    const row = threshold({ is_breaching: true, current_breaches: 1, last_triggered_at: new Date(0) });
    query
      .mockResolvedValueOnce({ rows: [row] })
      .mockResolvedValueOnce({ rows: [{ value: 0 }] })
      .mockResolvedValueOnce({ rows: [{ id: "20000000-0000-4000-8000-000000000001" }] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });
    const { ProjectThresholdWorker } = await import(
      "../../../src/modules/projects/alerts/thresholds/threshold.worker.js"
    );

    const result = await new ProjectThresholdWorker(logger as never).runTick();

    expect(result.recovered).toBe(1);
    expect(resolveEvent).toHaveBeenCalledWith(
      row.organization_id,
      "20000000-0000-4000-8000-000000000001",
      null,
      "auto",
      true,
    );
    expect(insertHistory).toHaveBeenCalledWith(expect.objectContaining({
      action: "auto_resolved",
      metadata: expect.objectContaining({ thresholdId: row.id }),
    }));
    expect(ingestEvent).toHaveBeenCalledWith(
      row.organization_id,
      expect.objectContaining({ payload: expect.objectContaining({ recovery: true }) }),
    );
  });

  it("contains a due-query failure so the organization-rule tick can continue", async () => {
    query.mockRejectedValueOnce(new Error("database unavailable"));
    const { ProjectThresholdWorker } = await import(
      "../../../src/modules/projects/alerts/thresholds/threshold.worker.js"
    );

    await expect(new ProjectThresholdWorker(logger as never).runTick()).resolves.toMatchObject({
      due: 0, evaluated: 0, failed: 1,
    });
  });
});
