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
export function readPath(obj: unknown, path: string): unknown {
  if (!path || obj === null || obj === undefined) return undefined;
  let cur: unknown = obj;
  for (const rawSeg of path.split('.')) {
    const seg = rawSeg.trim();
    if (typeof cur === 'number') {
      // If we already reached a scalar number and next segment is a standard statistical/unit suffix, keep the number
      if (/^(p95|p99|p50|p90|ms|value|avg|max|min|count|rate|pct)$/i.test(seg)) {
        continue;
      }
      return undefined;
    }
    if (cur === null || cur === undefined || typeof cur !== 'object') return undefined;
    const rec = cur as Record<string, unknown>;
    if (seg in rec) {
      cur = rec[seg];
    } else {
      // Try camelCase <-> snake_case fallback
      const camel = seg.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
      const snake = seg.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
      if (camel in rec) {
        cur = rec[camel];
      } else if (snake in rec) {
        cur = rec[snake];
      } else {
        // Case-insensitive fallback
        const lower = seg.toLowerCase();
        const foundKey = Object.keys(rec).find((k) => k.toLowerCase() === lower);
        if (foundKey !== undefined) {
          cur = rec[foundKey];
        } else {
          return undefined;
        }
      }
    }
  }

  // If the resolved leaf is an object containing standard metric scalar representations, unwrap it:
  if (cur !== null && typeof cur === 'object' && !Array.isArray(cur)) {
    const objRec = cur as Record<string, unknown>;
    if (typeof objRec.p95 === 'number') return objRec.p95;
    if (typeof objRec.value === 'number') return objRec.value;
    if (typeof objRec.ms === 'number') return objRec.ms;
    if (typeof objRec.avg === 'number') return objRec.avg;
    if (typeof objRec.p99 === 'number') return objRec.p99;
    if (typeof objRec.count === 'number') return objRec.count;
    if (typeof objRec.rate === 'number') return objRec.rate;
    if (typeof objRec.pct === 'number') return objRec.pct;
  }

  return cur;
}

function toNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) return Number(v);
  return null;
}

/** Evaluate a single condition against an actual value. */
export function evaluateCondition(operator: ConditionOperator, actual: unknown, expected: unknown): boolean {
  switch (operator) {
    case 'exists':
      return actual !== undefined && actual !== null;
    case 'eq':
      return actual === expected || String(actual) === String(expected);
    case 'neq':
      return !(actual === expected || String(actual) === String(expected));
    case 'gt':
    case 'lt':
    case 'gte':
    case 'lte': {
      const a = toNumber(actual);
      const e = toNumber(expected);
      if (a === null || e === null) return false;
      if (operator === 'gt') return a > e;
      if (operator === 'lt') return a < e;
      if (operator === 'gte') return a >= e;
      return a <= e;
    }
    case 'contains':
      if (Array.isArray(actual)) return actual.map(String).includes(String(expected));
      return typeof actual === 'string' && actual.includes(String(expected));
    case 'in':
      return Array.isArray(expected) && expected.map(String).includes(String(actual));
    case 'regex':
      try {
        return typeof actual === 'string' && new RegExp(String(expected)).test(actual);
      } catch {
        return false;
      }
    default:
      return false;
  }
}

/**
 * Evaluate all conditions against a payload and combine using the grouping
 * semantics described above.
 */
export function evaluateRule(payload: Record<string, unknown>, conditions: EvaluableCondition[]): EvaluationResult {
  const conditionResults: EvaluationResult['conditionResults'] = conditions.map((c) => {
    const actual = readPath(payload, c.fieldPath);
    const passed = evaluateCondition(c.operator, actual, c.thresholdValue);
    return { fieldPath: c.fieldPath, operator: c.operator, actual, expected: c.thresholdValue, passed };
  });

  if (conditions.length === 0) {
    return { matched: false, conditionResults };
  }

  // Partition into groups. Ungrouped conditions form their own AND terms, split
  // by whether they are required (gate the match) or optional (informational).
  const groups = new Map<string, boolean[]>();
  const ungrouped: { required: boolean[]; optional: boolean[] } = { required: [], optional: [] };

  conditions.forEach((c, i) => {
    const passed = conditionResults[i]!.passed;
    if (c.conditionGroupId) {
      const arr = groups.get(c.conditionGroupId) ?? [];
      arr.push(passed);
      groups.set(c.conditionGroupId, arr);
    } else if (c.isRequired === false) {
      ungrouped.optional.push(passed);
    } else {
      // Default (undefined/true) is required - matches the DB column default.
      ungrouped.required.push(passed);
    }
  });

  // Each group: OR across its members. Ungrouped required conditions: AND.
  const groupTruths = [...groups.values()].map((arr) => arr.some(Boolean));

  // `isRequired: false` (optional) ungrouped conditions do not gate the match.
  // They are evaluated and reported for observability, but a failing optional
  // condition cannot by itself prevent a match. If a rule consists ONLY of
  // optional conditions, at least one must pass - otherwise an all-optional
  // rule would match unconditionally (including on an empty payload), which
  // would be a false-positive generator.
  const requiredTerms = [...groupTruths, ...ungrouped.required];
  const matched = requiredTerms.length > 0
    ? requiredTerms.every(Boolean)
    : ungrouped.optional.length > 0 && ungrouped.optional.some(Boolean);

  return { matched, conditionResults };
}
