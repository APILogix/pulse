/**
 * Alert rule condition evaluation engine (pure, side-effect-free).
 *
 * Evaluates a payload against a set of conditions. Conditions are combined as:
 *   - Conditions sharing a `conditionGroupId` are OR'd together within the group.
 *   - Groups and ungrouped REQUIRED conditions are AND'd together.
 *   - An ungrouped condition with `isRequired: false` is OPTIONAL: it is
 *     evaluated and reported in `conditionResults` for observability, but it
 *     does not gate the match. `isRequired` defaults to true (matching the
 *     `alert_rule_conditions.is_required` column default), so omitting it
 *     preserves strict AND behaviour.
 *   - Degenerate case: if a rule has NO required terms (every ungrouped
 *     condition is optional and there are no groups), at least one optional
 *     condition must pass. Without this guard an all-optional rule would match
 *     unconditionally - including against an empty payload - and continuously
 *     emit false positives.
 *
 * Note: `isRequired` is only meaningful for UNGROUPED conditions. Inside a
 * group the combinator is already OR, so a failing member never fails the group.
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
/** Read a dotted path from an object with support for case normalization and metric unwrapping. */
export declare function readPath(obj: unknown, path: string): unknown;
/** Evaluate a single condition against an actual value. */
export declare function evaluateCondition(operator: ConditionOperator, actual: unknown, expected: unknown): boolean;
/**
 * Evaluate all conditions against a payload and combine using the grouping
 * semantics described above.
 */
export declare function evaluateRule(payload: Record<string, unknown>, conditions: EvaluableCondition[]): EvaluationResult;
//# sourceMappingURL=evaluator.d.ts.map