/**
 * Automation module – condition evaluator (pure, side-effect-free).
 *
 * Evaluates automation workflow conditions against a trigger event payload.
 *
 * Features:
 *   - Safe dot-path/$.path evaluation with no prototype traversal.
 *   - All required operators: eq, neq, gt, gte, lt, lte, in, not_in,
 *     contains, not_contains, matches, exists, not_exists, between.
 *   - Missing-path semantics: missing paths yield undefined, operators
 *     handle gracefully (exists → false, not_exists → true, comparison → false).
 *   - Bounded safe regex (rejects patterns > 256 chars).
 *   - Condition-group behavior: conditions in same group are OR'd;
 *     groups are AND'd together. Ungrouped (unique group per condition) each
 *     form their own AND term.
 */
import type { AutomationCondition, ConditionEvaluationResult, ConditionOperator } from './types.js';
/**
 * Safely read a dot-delimited path from a JSON payload.
 *
 * - Rejects prototype traversal attempts.
 * - Returns undefined for missing paths.
 * - Supports array index access (numeric segments).
 */
export declare function readPath(obj: unknown, rawPath: string): unknown;
/**
 * Evaluate a single condition operator against actual and expected values.
 *
 * Missing-path semantics:
 *   - exists: true only if actual !== undefined && actual !== null
 *   - not_exists: true only if actual === undefined || actual === null
 *   - Other operators: if actual is undefined → false (except not_exists)
 */
export declare function evaluateOperator(operator: ConditionOperator, actual: unknown, expected: unknown): boolean;
/**
 * Evaluate a set of conditions against a payload.
 *
 * Group semantics:
 *   - Conditions sharing a `conditionGroup` are OR'd within the group
 *     (group passes if at least one condition in it passes).
 *   - All groups must pass (AND'd together).
 *   - Empty conditions → matched = true (no filtering).
 *   - `isRequired: false` conditions that fail do not fail their group
 *     unless they are the only condition in the group.
 */
export declare function evaluateConditions(payload: Record<string, unknown>, conditions: AutomationCondition[]): ConditionEvaluationResult;
//# sourceMappingURL=evaluator.d.ts.map