/**
 * Alert rule condition evaluation engine (pure, side-effect-free).
 *
 * Evaluates a payload against a set of conditions. Conditions are combined as:
 *   - Conditions sharing a `conditionGroupId` are OR'd together within the group.
 *   - Groups (and ungrouped conditions) are AND'd together.
 *   - A condition marked `isRequired=false` that fails does not fail the group
 *     unless it is the only condition contributing to its group's truth.
 *
 * The engine reads scalar values from the payload by dotted `fieldPath`
 * (e.g. "cpu.usage", "error.rate"). Aggregations over time windows are the
 * responsibility of the caller (the evaluator only sees the already-resolved
 * scalar/array value at the path).
 */
import type { ConditionOperator } from './types.js';
export interface EvaluableCondition {
    id?: string;
    conditionGroupId: string | null;
    fieldPath: string;
    operator: ConditionOperator;
    thresholdValue: unknown;
    isRequired: boolean;
}
export interface EvaluationResult {
    matched: boolean;
    /** Per-condition outcomes for observability / rule testing. */
    conditionResults: Array<{
        fieldPath: string;
        operator: ConditionOperator;
        actual: unknown;
        expected: unknown;
        passed: boolean;
    }>;
}
/** Read a dotted path from an object. Returns undefined if any segment is missing. */
export declare function readPath(obj: unknown, path: string): unknown;
/** Evaluate a single condition against an actual value. */
export declare function evaluateCondition(operator: ConditionOperator, actual: unknown, expected: unknown): boolean;
/**
 * Evaluate all conditions against a payload and combine using the grouping
 * semantics described above.
 */
export declare function evaluateRule(payload: Record<string, unknown>, conditions: EvaluableCondition[]): EvaluationResult;
//# sourceMappingURL=evaluator.d.ts.map