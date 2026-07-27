import type {
  ProjectAlertThreshold,
  ThresholdComparisonOperator,
} from "./threshold.types.js";

/** Minimal read contract for evaluators; ThresholdRepository satisfies it. */
export interface EnabledThresholdLookup {
  findEnabled(
    organizationId: string,
    projectId: string,
    environmentId?: string | null,
  ): Promise<ProjectAlertThreshold[]>;
}

export interface ThresholdEvaluationState {
  readonly consecutiveBreaches: number;
  readonly active: boolean;
  readonly lastTriggeredAt: Date | null;
  readonly lastRecoveredAt: Date | null;
}

export type ThresholdEvaluationAction = "none" | "trigger" | "recover";

export interface ThresholdEvaluationResult {
  readonly action: ThresholdEvaluationAction;
  readonly breached: boolean;
  readonly shouldNotify: boolean;
  readonly state: ThresholdEvaluationState;
}

export function compareThreshold(
  observedValue: number,
  operator: ThresholdComparisonOperator,
  thresholdValue: number,
): boolean {
  if (!Number.isFinite(observedValue) || !Number.isFinite(thresholdValue)) return false;
  switch (operator) {
    case ">": return observedValue > thresholdValue;
    case ">=": return observedValue >= thresholdValue;
    case "<": return observedValue < thresholdValue;
    case "<=": return observedValue <= thresholdValue;
    case "=": return observedValue === thresholdValue;
    case "!=": return observedValue !== thresholdValue;
  }
}

/** Cooldown is active until, but not including, its exact expiry instant. */
export function isThresholdInCooldown(
  lastTriggeredAt: Date | null,
  cooldownMinutes: number,
  evaluatedAt: Date,
): boolean {
  if (lastTriggeredAt === null || cooldownMinutes <= 0) return false;
  const expiry = lastTriggeredAt.getTime() + cooldownMinutes * 60_000;
  return Number.isFinite(expiry) && evaluatedAt.getTime() < expiry;
}

/**
 * Pure state transition for one metric observation. Persistence and delivery
 * are deliberately left to the caller.
 */
export function evaluateProjectThreshold(
  threshold: ProjectAlertThreshold,
  observedValue: number,
  previous: ThresholdEvaluationState,
  evaluatedAt: Date,
): ThresholdEvaluationResult {
  if (!threshold.enabled) {
    return { action: "none", breached: false, shouldNotify: false, state: previous };
  }

  const breached = compareThreshold(
    observedValue,
    threshold.comparisonOperator,
    threshold.thresholdValue,
  );

  if (!breached) {
    if (!previous.active) {
      return {
        action: "none",
        breached: false,
        shouldNotify: false,
        state: { ...previous, consecutiveBreaches: 0 },
      };
    }
    return {
      action: "recover",
      breached: false,
      shouldNotify: threshold.notifyOnRecovery,
      state: {
        consecutiveBreaches: 0,
        active: false,
        lastTriggeredAt: previous.lastTriggeredAt,
        lastRecoveredAt: evaluatedAt,
      },
    };
  }

  const requiredBreaches = Math.max(1, threshold.consecutiveBreaches);
  const consecutiveBreaches = Math.min(
    requiredBreaches,
    Math.max(0, previous.consecutiveBreaches) + 1,
  );
  const breachedState: ThresholdEvaluationState = {
    ...previous,
    consecutiveBreaches,
  };

  if (previous.active || consecutiveBreaches < requiredBreaches) {
    return { action: "none", breached: true, shouldNotify: false, state: breachedState };
  }

  if (isThresholdInCooldown(previous.lastTriggeredAt, threshold.cooldownMinutes, evaluatedAt)) {
    return { action: "none", breached: true, shouldNotify: false, state: breachedState };
  }

  return {
    action: "trigger",
    breached: true,
    shouldNotify: true,
    state: {
      consecutiveBreaches,
      active: true,
      lastTriggeredAt: evaluatedAt,
      lastRecoveredAt: previous.lastRecoveredAt,
    },
  };
}