import { describe, expect, it } from "vitest";
import {
  compareThreshold,
  evaluateProjectThreshold,
  isThresholdInCooldown,
  type ThresholdEvaluationState,
} from "../../../src/modules/projects/alerts/thresholds/threshold.evaluator.js";
import {
  CreateThresholdBodySchema,
  ListThresholdsQuerySchema,
  ThresholdDetailParamsSchema,
  type ProjectAlertThreshold,
} from "../../../src/modules/projects/alerts/thresholds/threshold.types.js";

const NOW = new Date("2026-01-01T00:30:00.000Z");

function threshold(overrides: Partial<ProjectAlertThreshold> = {}): ProjectAlertThreshold {
  return {
    id: "10000000-0000-4000-8000-000000000001",
    organizationId: "10000000-0000-4000-8000-000000000002",
    projectId: "10000000-0000-4000-8000-000000000003",
    environmentId: null,
    thresholdKey: "high-error-rate",
    metricName: "error_rate",
    metricSource: "requests",
    category: "error",
    severity: "critical",
    comparisonOperator: ">=",
    thresholdValue: 5,
    thresholdUnit: "percent",
    evaluationWindowMinutes: 5,
    cooldownMinutes: 15,
    consecutiveBreaches: 2,
    enabled: true,
    notifyOnRecovery: true,
    lastTriggeredAt: null,
    lastRecoveredAt: null,
    createdBy: null,
    updatedBy: null,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    version: 1,
    ...overrides,
  };
}

const INITIAL_STATE: ThresholdEvaluationState = {
  consecutiveBreaches: 0,
  active: false,
  lastTriggeredAt: null,
  lastRecoveredAt: null,
};

describe("threshold schemas", () => {
  it("normalizes threshold-specific snake_case body keys", () => {
    const parsed = CreateThresholdBodySchema.parse({
      threshold_key: "latency",
      metric_name: "p95_latency",
      metric_source: "http",
      category: "performance",
      severity: "warning",
      comparison_operator: ">",
      threshold_value: "250",
      threshold_unit: "ms",
      evaluation_window_minutes: 10,
      cooldown_minutes: 20,
      consecutive_breaches: 3,
      notify_on_recovery: false,
    });
    expect(parsed).toMatchObject({
      thresholdKey: "latency",
      comparisonOperator: ">",
      thresholdValue: 250,
      notifyOnRecovery: false,
    });
  });

  it("accepts camelCase and snake_case params and list query keys", () => {
    const snakeParams = ThresholdDetailParamsSchema.parse({
      org_id: threshold().organizationId,
      project_id: threshold().projectId,
      threshold_id: threshold().id,
    });
    const camelQuery = ListThresholdsQuerySchema.parse({ environmentId: null, sortBy: "metric_name" });
    const snakeQuery = ListThresholdsQuerySchema.parse({ environment_id: null, sort_by: "metric_name" });
    expect(snakeParams.thresholdId).toBe(threshold().id);
    expect(snakeQuery).toEqual(camelQuery);
  });
});

describe("threshold comparison and cooldown", () => {
  it.each([
    [6, ">", 5, true],
    [5, ">=", 5, true],
    [4, "<", 5, true],
    [5, "<=", 5, true],
    [5, "=", 5, true],
    [4, "!=", 5, true],
  ] as const)("compares %s %s %s", (observed, operator, expected, result) => {
    expect(compareThreshold(observed, operator, expected)).toBe(result);
  });

  it("uses an exclusive cooldown expiry boundary", () => {
    const triggeredAt = new Date("2026-01-01T00:15:00.000Z");
    expect(isThresholdInCooldown(triggeredAt, 15, new Date(NOW.getTime() - 1))).toBe(true);
    expect(isThresholdInCooldown(triggeredAt, 15, NOW)).toBe(false);
    expect(isThresholdInCooldown(triggeredAt, 0, triggeredAt)).toBe(false);
  });
});

describe("threshold evaluation", () => {
  it("triggers only after the configured consecutive breaches", () => {
    const first = evaluateProjectThreshold(threshold(), 6, INITIAL_STATE, new Date(NOW.getTime() - 60_000));
    const second = evaluateProjectThreshold(threshold(), 7, first.state, NOW);
    expect(first.action).toBe("none");
    expect(first.state.consecutiveBreaches).toBe(1);
    expect(second.action).toBe("trigger");
    expect(second.state.active).toBe(true);
  });

  it("holds a qualified breach until cooldown expires", () => {
    const priorTrigger = new Date(NOW.getTime() - 5 * 60_000);
    const state: ThresholdEvaluationState = {
      consecutiveBreaches: 1,
      active: false,
      lastTriggeredAt: priorTrigger,
      lastRecoveredAt: priorTrigger,
    };
    const result = evaluateProjectThreshold(threshold(), 6, state, NOW);
    expect(result.action).toBe("none");
    expect(result.state.consecutiveBreaches).toBe(2);
  });

  it("recovers deterministically and honors notification configuration", () => {
    const active: ThresholdEvaluationState = {
      consecutiveBreaches: 2,
      active: true,
      lastTriggeredAt: new Date(NOW.getTime() - 20 * 60_000),
      lastRecoveredAt: null,
    };
    const result = evaluateProjectThreshold(
      threshold({ notifyOnRecovery: false }),
      2,
      active,
      NOW,
    );
    expect(result).toMatchObject({ action: "recover", breached: false, shouldNotify: false });
    expect(result.state).toMatchObject({ active: false, consecutiveBreaches: 0, lastRecoveredAt: NOW });
  });
});