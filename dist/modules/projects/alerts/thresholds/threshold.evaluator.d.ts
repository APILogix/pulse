import type { ProjectAlertThreshold, ThresholdComparisonOperator } from "./threshold.types.js";
/** Minimal read contract for evaluators; ThresholdRepository satisfies it. */
export interface EnabledThresholdLookup {
    findEnabled(organizationId: string, projectId: string, environmentId?: string | null): Promise<ProjectAlertThreshold[]>;
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
export declare function compareThreshold(observedValue: number, operator: ThresholdComparisonOperator, thresholdValue: number): boolean;
/** Cooldown is active until, but not including, its exact expiry instant. */
export declare function isThresholdInCooldown(lastTriggeredAt: Date | null, cooldownMinutes: number, evaluatedAt: Date): boolean;
/**
 * Pure state transition for one metric observation. Persistence and delivery
 * are deliberately left to the caller.
 */
export declare function evaluateProjectThreshold(threshold: ProjectAlertThreshold, observedValue: number, previous: ThresholdEvaluationState, evaluatedAt: Date): ThresholdEvaluationResult;
//# sourceMappingURL=threshold.evaluator.d.ts.map