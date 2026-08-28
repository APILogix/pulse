import { describe, expect, it } from 'vitest';
import {
  evaluateCondition,
  evaluateRule,
  readPath,
  type EvaluableCondition,
} from '../../src/modules/alerting/evaluator.js';
import type { ConditionOperator } from '../../src/modules/alerting/types.js';

function cond(overrides: Partial<EvaluableCondition> = {}): EvaluableCondition {
  return {
    conditionGroupId: null,
    fieldPath: 'value',
    operator: 'gte',
    thresholdValue: 10,
    isRequired: true,
    ...overrides,
  };
}

/**
 * Operator truth table.
 *
 * These assert the *documented* boundary semantics so a future refactor cannot
 * silently flip a comparison. Each row states input, operator, and the expected
 * result including the exact inclusive/exclusive boundary behaviour.
 */
describe('evaluateCondition truth table', () => {
  const rows: Array<{
    label: string;
    operator: ConditionOperator;
    actual: unknown;
    expected: unknown;
    result: boolean;
  }> = [
    // ── Numeric boundaries: the classic off-by-one alerting bug class ────────
    { label: 'gte: equal to threshold matches (inclusive)', operator: 'gte', actual: 10, expected: 10, result: true },
    { label: 'gte: just below does not match', operator: 'gte', actual: 9.999, expected: 10, result: false },
    { label: 'gte: just above matches', operator: 'gte', actual: 10.001, expected: 10, result: true },
    { label: 'gt: equal does NOT match (exclusive)', operator: 'gt', actual: 10, expected: 10, result: false },
    { label: 'gt: just above matches', operator: 'gt', actual: 10.001, expected: 10, result: true },
    { label: 'lte: equal matches (inclusive)', operator: 'lte', actual: 10, expected: 10, result: true },
    { label: 'lt: equal does NOT match (exclusive)', operator: 'lt', actual: 10, expected: 10, result: false },
    { label: 'lt: below matches', operator: 'lt', actual: 9, expected: 10, result: true },

    // ── Zero and negatives ──────────────────────────────────────────────────
    { label: 'gte: zero vs zero matches', operator: 'gte', actual: 0, expected: 0, result: true },
    { label: 'lt: zero below positive threshold matches', operator: 'lt', actual: 0, expected: 1, result: true },
    { label: 'lt: negative below zero matches', operator: 'lt', actual: -5, expected: 0, result: true },
    { label: 'gte: negative does not meet positive threshold', operator: 'gte', actual: -5, expected: 10, result: false },

    // ── Missing / null / non-numeric: must fail closed, never throw ─────────
    { label: 'gte: null actual fails closed', operator: 'gte', actual: null, expected: 10, result: false },
    { label: 'gte: undefined actual fails closed', operator: 'gte', actual: undefined, expected: 10, result: false },
    { label: 'gte: non-numeric string fails closed', operator: 'gte', actual: 'N/A', expected: 10, result: false },
    { label: 'lt: null actual fails closed (does NOT read as 0)', operator: 'lt', actual: null, expected: 1, result: false },
    { label: 'gte: null threshold fails closed', operator: 'gte', actual: 50, expected: null, result: false },

    // ── Numeric strings are coerced (telemetry often stringifies) ───────────
    { label: 'gte: numeric string coerces and matches', operator: 'gte', actual: '42', expected: 10, result: true },
    { label: 'gte: numeric string coerces and fails', operator: 'gte', actual: '4', expected: 10, result: false },

    // ── eq / neq incl. boolean-as-string telemetry ──────────────────────────
    { label: 'eq: true vs true', operator: 'eq', actual: true, expected: true, result: true },
    { label: 'eq: "true" string vs boolean true (loose)', operator: 'eq', actual: 'true', expected: true, result: true },
    { label: 'eq: false vs true', operator: 'eq', actual: false, expected: true, result: false },
    { label: 'eq: undefined vs true', operator: 'eq', actual: undefined, expected: true, result: false },
    { label: 'neq: false vs true', operator: 'neq', actual: false, expected: true, result: true },
    { label: 'neq: true vs true', operator: 'neq', actual: true, expected: true, result: false },

    // ── exists: 0 and "" are DEFINED values ─────────────────────────────────
    { label: 'exists: zero is present', operator: 'exists', actual: 0, expected: null, result: true },
    { label: 'exists: empty string is present', operator: 'exists', actual: '', expected: null, result: true },
    { label: 'exists: null is absent', operator: 'exists', actual: null, expected: null, result: false },
    { label: 'exists: undefined is absent', operator: 'exists', actual: undefined, expected: null, result: false },

    // ── contains / in / regex ───────────────────────────────────────────────
    { label: 'contains: substring present', operator: 'contains', actual: 'fatal: out of memory', expected: 'out of memory', result: true },
    { label: 'contains: substring absent', operator: 'contains', actual: 'all good', expected: 'out of memory', result: false },
    { label: 'contains: array membership', operator: 'contains', actual: ['a', 'b'], expected: 'b', result: true },
    { label: 'contains: null actual fails closed', operator: 'contains', actual: null, expected: 'x', result: false },
    { label: 'in: value in list', operator: 'in', actual: 500, expected: [500, 502], result: true },
    { label: 'in: value not in list', operator: 'in', actual: 404, expected: [500, 502], result: false },
    { label: 'in: non-array expected fails closed', operator: 'in', actual: 500, expected: 500, result: false },
    { label: 'regex: matches', operator: 'regex', actual: 'ERR-1234', expected: '^ERR-\\d+$', result: true },
    { label: 'regex: does not match', operator: 'regex', actual: 'OK', expected: '^ERR-\\d+$', result: false },
    { label: 'regex: invalid pattern fails closed instead of throwing', operator: 'regex', actual: 'x', expected: '([', result: false },
    { label: 'regex: non-string actual fails closed', operator: 'regex', actual: 123, expected: '\\d+', result: false },
  ];

  for (const row of rows) {
    it(row.label, () => {
      expect(evaluateCondition(row.operator, row.actual, row.expected)).toBe(row.result);
    });
  }

  it('unknown operator fails closed (never matches)', () => {
    expect(evaluateCondition('not_a_real_operator' as ConditionOperator, 999, 1)).toBe(false);
  });
});

describe('evaluateRule condition combination', () => {
  it('ANDs ungrouped required conditions', () => {
    const conditions = [
      cond({ fieldPath: 'a', thresholdValue: 10 }),
      cond({ fieldPath: 'b', thresholdValue: 10 }),
    ];
    expect(evaluateRule({ a: 50, b: 50 }, conditions).matched).toBe(true);
    expect(evaluateRule({ a: 50, b: 1 }, conditions).matched).toBe(false);
    expect(evaluateRule({ a: 1, b: 1 }, conditions).matched).toBe(false);
  });

  it('ORs conditions sharing a condition group', () => {
    const conditions = [
      cond({ fieldPath: 'a', thresholdValue: 10, conditionGroupId: 'g1' }),
      cond({ fieldPath: 'b', thresholdValue: 10, conditionGroupId: 'g1' }),
    ];
    expect(evaluateRule({ a: 50, b: 1 }, conditions).matched).toBe(true);
    expect(evaluateRule({ a: 1, b: 50 }, conditions).matched).toBe(true);
    expect(evaluateRule({ a: 1, b: 1 }, conditions).matched).toBe(false);
  });

  it('ANDs across distinct groups while ORing within each', () => {
    const conditions = [
      cond({ fieldPath: 'a', thresholdValue: 10, conditionGroupId: 'g1' }),
      cond({ fieldPath: 'b', thresholdValue: 10, conditionGroupId: 'g1' }),
      cond({ fieldPath: 'c', thresholdValue: 10, conditionGroupId: 'g2' }),
    ];
    // g1 satisfied by b, g2 satisfied by c -> match
    expect(evaluateRule({ a: 1, b: 50, c: 50 }, conditions).matched).toBe(true);
    // g1 satisfied, g2 not -> no match
    expect(evaluateRule({ a: 1, b: 50, c: 1 }, conditions).matched).toBe(false);
  });

  it('never matches when there are no conditions', () => {
    expect(evaluateRule({ a: 1 }, []).matched).toBe(false);
  });

  // ── isRequired semantics (previously documented but NOT implemented) ──────
  it('a failing OPTIONAL condition does not block a passing required condition', () => {
    const conditions = [
      cond({ fieldPath: 'required', thresholdValue: 10, isRequired: true }),
      cond({ fieldPath: 'optional', thresholdValue: 10, isRequired: false }),
    ];
    const result = evaluateRule({ required: 50, optional: 1 }, conditions);
    expect(result.matched).toBe(true);
    // The optional condition is still reported for observability.
    expect(result.conditionResults.find((r) => r.fieldPath === 'optional')?.passed).toBe(false);
  });

  it('a failing REQUIRED condition still blocks the match', () => {
    const conditions = [
      cond({ fieldPath: 'required', thresholdValue: 10, isRequired: true }),
      cond({ fieldPath: 'optional', thresholdValue: 10, isRequired: false }),
    ];
    expect(evaluateRule({ required: 1, optional: 50 }, conditions).matched).toBe(false);
  });

  it('isRequired defaults to required when omitted (strict AND preserved)', () => {
    const conditions: EvaluableCondition[] = [
      { conditionGroupId: null, fieldPath: 'a', operator: 'gte', thresholdValue: 10, isRequired: undefined as unknown as boolean },
      { conditionGroupId: null, fieldPath: 'b', operator: 'gte', thresholdValue: 10, isRequired: undefined as unknown as boolean },
    ];
    expect(evaluateRule({ a: 50, b: 1 }, conditions).matched).toBe(false);
  });

  it('an all-optional rule requires at least one optional condition to pass', () => {
    const conditions = [
      cond({ fieldPath: 'a', thresholdValue: 10, isRequired: false }),
      cond({ fieldPath: 'b', thresholdValue: 10, isRequired: false }),
    ];
    // At least one passes -> match.
    expect(evaluateRule({ a: 50, b: 1 }, conditions).matched).toBe(true);
    // None pass -> must NOT match. Guards against an all-optional rule matching
    // unconditionally and continuously emitting false positives.
    expect(evaluateRule({ a: 1, b: 1 }, conditions).matched).toBe(false);
    // Empty payload -> must NOT match.
    expect(evaluateRule({}, conditions).matched).toBe(false);
  });
});

describe('readPath field resolution', () => {
  it('resolves dotted paths', () => {
    expect(readPath({ requests: { latency: { p95: 1234 } } }, 'requests.latency.p95')).toBe(1234);
  });

  it('returns undefined for a missing path rather than throwing', () => {
    expect(readPath({ requests: {} }, 'requests.latency.p95')).toBeUndefined();
    expect(readPath(null, 'a.b')).toBeUndefined();
    expect(readPath({ a: 1 }, '')).toBeUndefined();
  });

  it('distinguishes an explicit null leaf from a missing leaf for `exists`', () => {
    expect(evaluateCondition('exists', readPath({ a: { b: null } }, 'a.b'), null)).toBe(false);
    expect(evaluateCondition('exists', readPath({ a: { b: 0 } }, 'a.b'), null)).toBe(true);
  });

  it('unwraps a metric object using a fixed priority order (p95 before avg)', () => {
    // Documents the ordering hazard: a path landing on an object containing both
    // p95 and avg resolves to p95. Encoded so a change is a deliberate decision.
    expect(readPath({ latency: { p95: 900, avg: 100 } }, 'latency')).toBe(900);
    expect(readPath({ latency: { avg: 100 } }, 'latency')).toBe(100);
    expect(readPath({ q: { count: 7 } }, 'q')).toBe(7);
  });

  it('tolerates camelCase/snake_case mismatch between rule config and payload', () => {
    expect(readPath({ status_code: 500 }, 'statusCode')).toBe(500);
    expect(readPath({ statusCode: 500 }, 'status_code')).toBe(500);
  });
});
