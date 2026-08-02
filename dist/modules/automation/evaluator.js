import { LIMITS } from './types.js';
import { isSafeRegex } from './regex-safety.js';
// ═══════════════════════════════════════════════════════════════════════════════
// SAFE PATH READING
// ═══════════════════════════════════════════════════════════════════════════════
/** Prototype/dunder keys that must never be traversed */
const FORBIDDEN_KEYS = new Set([
    '__proto__',
    'constructor',
    'prototype',
    '__defineGetter__',
    '__defineSetter__',
    '__lookupGetter__',
    '__lookupSetter__',
]);
/**
 * Normalize a leftPath:
 *  - Strip leading "$." (JsonPath root notation)
 *  - Trim whitespace
 */
function normalizePath(path) {
    let normalized = path.trim();
    if (normalized.startsWith('$.')) {
        normalized = normalized.slice(2);
    }
    return normalized;
}
/**
 * Safely read a dot-delimited path from a JSON payload.
 *
 * - Rejects prototype traversal attempts.
 * - Returns undefined for missing paths.
 * - Supports array index access (numeric segments).
 */
export function readPath(obj, rawPath) {
    const path = normalizePath(rawPath);
    if (!path)
        return undefined;
    const segments = path.split('.');
    let current = obj;
    for (const segment of segments) {
        // Guard: null/undefined short-circuit
        if (current === null || current === undefined)
            return undefined;
        // Guard: must be object/array
        if (typeof current !== 'object')
            return undefined;
        // Guard: no prototype traversal
        if (FORBIDDEN_KEYS.has(segment))
            return undefined;
        // Array index access
        if (Array.isArray(current)) {
            const idx = Number(segment);
            if (Number.isNaN(idx) || !Number.isInteger(idx) || idx < 0)
                return undefined;
            current = current[idx];
        }
        else {
            // Only access own properties
            if (!Object.prototype.hasOwnProperty.call(current, segment))
                return undefined;
            current = current[segment];
        }
    }
    return current;
}
// ═══════════════════════════════════════════════════════════════════════════════
// TYPE COERCION
// ═══════════════════════════════════════════════════════════════════════════════
function toNumber(v) {
    if (typeof v === 'number')
        return Number.isFinite(v) ? v : null;
    if (typeof v === 'string') {
        const trimmed = v.trim();
        if (trimmed === '')
            return null;
        const n = Number(trimmed);
        return Number.isFinite(n) ? n : null;
    }
    return null;
}
// ═══════════════════════════════════════════════════════════════════════════════
// OPERATOR EVALUATION
// ═══════════════════════════════════════════════════════════════════════════════
/**
 * Evaluate a single condition operator against actual and expected values.
 *
 * Missing-path semantics:
 *   - exists: true only if actual !== undefined && actual !== null
 *   - not_exists: true only if actual === undefined || actual === null
 *   - Other operators: if actual is undefined → false (except not_exists)
 */
export function evaluateOperator(operator, actual, expected) {
    switch (operator) {
        // ─── Existence ───────────────────────────────────────────────────────
        case 'exists':
            return actual !== undefined && actual !== null;
        case 'not_exists':
            return actual === undefined || actual === null;
        // ─── Equality ────────────────────────────────────────────────────────
        case 'eq':
            if (actual === undefined || actual === null)
                return expected === null || expected === undefined;
            return actual === expected || String(actual) === String(expected);
        case 'neq':
            if (actual === undefined || actual === null)
                return expected !== null && expected !== undefined;
            return actual !== expected && String(actual) !== String(expected);
        // ─── Numeric comparisons ─────────────────────────────────────────────
        case 'gt':
        case 'gte':
        case 'lt':
        case 'lte': {
            const a = toNumber(actual);
            const e = toNumber(expected);
            if (a === null || e === null)
                return false;
            if (operator === 'gt')
                return a > e;
            if (operator === 'gte')
                return a >= e;
            if (operator === 'lt')
                return a < e;
            return a <= e; // lte
        }
        // ─── Set membership ──────────────────────────────────────────────────
        case 'in':
            if (!Array.isArray(expected))
                return false;
            if (actual === undefined || actual === null)
                return false;
            return expected.some((item) => String(item) === String(actual));
        case 'not_in':
            if (!Array.isArray(expected))
                return true;
            if (actual === undefined || actual === null)
                return true;
            return !expected.some((item) => String(item) === String(actual));
        // ─── Containment ─────────────────────────────────────────────────────
        case 'contains':
            if (actual === undefined || actual === null)
                return false;
            if (Array.isArray(actual)) {
                return actual.some((item) => String(item) === String(expected));
            }
            if (typeof actual === 'string') {
                return actual.includes(String(expected ?? ''));
            }
            return false;
        case 'not_contains':
            if (actual === undefined || actual === null)
                return true;
            if (Array.isArray(actual)) {
                return !actual.some((item) => String(item) === String(expected));
            }
            if (typeof actual === 'string') {
                return !actual.includes(String(expected ?? ''));
            }
            return true;
        // ─── Regex matching (bounded + safety-validated) ─────────────────────
        case 'matches': {
            if (actual === undefined || actual === null)
                return false;
            if (typeof expected !== 'string')
                return false;
            // Safety: reject overly long regex patterns
            if (expected.length > LIMITS.MAX_REGEX_LENGTH)
                return false;
            // HARDENED: Use regex-safety validator to reject catastrophic backtracking patterns
            if (!isSafeRegex(expected))
                return false;
            try {
                const re = new RegExp(expected);
                // Bound input length to prevent resource exhaustion
                const bounded = String(actual).slice(0, 10_000);
                return re.test(bounded);
            }
            catch {
                // Invalid regex → no match
                return false;
            }
        }
        // ─── Range ───────────────────────────────────────────────────────────
        case 'between': {
            const a = toNumber(actual);
            if (a === null)
                return false;
            // expected must be [min, max] array
            if (!Array.isArray(expected) || expected.length !== 2)
                return false;
            const min = toNumber(expected[0]);
            const max = toNumber(expected[1]);
            if (min === null || max === null)
                return false;
            return a >= min && a <= max;
        }
        default:
            return false;
    }
}
// ═══════════════════════════════════════════════════════════════════════════════
// CONDITION GROUP EVALUATION
// ═══════════════════════════════════════════════════════════════════════════════
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
export function evaluateConditions(payload, conditions) {
    const conditionResults = conditions.map((c) => {
        const actual = readPath(payload, c.leftPath);
        const passed = evaluateOperator(c.operator, actual, c.rightValue);
        return {
            leftPath: c.leftPath,
            operator: c.operator,
            actual,
            expected: c.rightValue,
            passed,
        };
    });
    // Empty conditions = always match (workflow has no conditional gate)
    if (conditions.length === 0) {
        return { matched: true, conditionResults };
    }
    // Build groups
    const groups = new Map();
    conditions.forEach((c, i) => {
        const groupKey = c.conditionGroup || `__ungrouped_${i}`;
        const arr = groups.get(groupKey) ?? [];
        arr.push({ passed: conditionResults[i].passed, isRequired: c.isRequired });
        groups.set(groupKey, arr);
    });
    // Evaluate each group: OR within group (at least one passes)
    // But respect isRequired: if all conditions are isRequired=false and
    // none pass, the group still fails. If at least one required condition
    // passes, group passes. If no required conditions exist, any pass suffices.
    const groupResults = [];
    for (const [, members] of groups) {
        const requiredMembers = members.filter((m) => m.isRequired);
        const optionalMembers = members.filter((m) => !m.isRequired);
        if (requiredMembers.length > 0) {
            // Group passes if at least one required condition passes
            groupResults.push(requiredMembers.some((m) => m.passed));
        }
        else {
            // All optional: group passes if at least one passes
            // (edge case: if group has only optional and none pass, it still passes
            //  because optional means "does not block")
            groupResults.push(true);
        }
    }
    // All groups must pass (AND)
    const matched = groupResults.every(Boolean);
    return { matched, conditionResults };
}
//# sourceMappingURL=evaluator.js.map