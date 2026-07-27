/**
 * Unit tests for the automation condition evaluator.
 *
 * Tests: safe dot-path/$.path evaluation, all operators, missing-path semantics,
 * bounded safe regex, condition-group behavior, no prototype traversal.
 */
import { describe, it, expect } from 'vitest';
import { readPath, evaluateOperator, evaluateConditions } from '../../src/modules/automation/evaluator.js';
import type { AutomationCondition, ConditionOperator } from '../../src/modules/automation/types.js';

// ═══════════════════════════════════════════════════════════════════════════════
// readPath
// ═══════════════════════════════════════════════════════════════════════════════

describe('readPath', () => {
  it('reads top-level keys', () => {
    expect(readPath({ severity: 'critical' }, 'severity')).toBe('critical');
  });

  it('reads nested keys with dot notation', () => {
    expect(readPath({ a: { b: { c: 42 } } }, 'a.b.c')).toBe(42);
  });

  it('returns undefined for missing paths', () => {
    expect(readPath({ a: 1 }, 'b')).toBeUndefined();
    expect(readPath({ a: { b: 1 } }, 'a.c')).toBeUndefined();
    expect(readPath({ a: { b: 1 } }, 'a.b.c')).toBeUndefined();
  });

  it('normalizes $. prefix (JsonPath root)', () => {
    expect(readPath({ severity: 'high' }, '$.severity')).toBe('high');
    expect(readPath({ a: { b: 99 } }, '$.a.b')).toBe(99);
  });

  it('handles array index access', () => {
    expect(readPath({ items: ['a', 'b', 'c'] }, 'items.1')).toBe('b');
    expect(readPath({ items: [{ name: 'first' }] }, 'items.0.name')).toBe('first');
  });

  it('returns undefined for negative array indices', () => {
    expect(readPath({ items: ['a', 'b'] }, 'items.-1')).toBeUndefined();
  });

  it('returns undefined for out-of-bounds array access', () => {
    expect(readPath({ items: ['a'] }, 'items.5')).toBeUndefined();
  });

  it('blocks __proto__ traversal', () => {
    const malicious = JSON.parse('{"__proto__": {"polluted": true}}');
    expect(readPath(malicious, '__proto__')).toBeUndefined();
    expect(readPath(malicious, '__proto__.polluted')).toBeUndefined();
  });

  it('blocks constructor traversal', () => {
    expect(readPath({}, 'constructor')).toBeUndefined();
    expect(readPath({}, 'constructor.prototype')).toBeUndefined();
  });

  it('blocks prototype traversal', () => {
    expect(readPath({}, 'prototype')).toBeUndefined();
  });

  it('returns undefined for empty path', () => {
    expect(readPath({ a: 1 }, '')).toBeUndefined();
  });

  it('returns undefined for null/undefined input', () => {
    expect(readPath(null, 'a')).toBeUndefined();
    expect(readPath(undefined, 'a')).toBeUndefined();
  });

  it('handles whitespace in path by trimming', () => {
    expect(readPath({ a: 1 }, '  a  ')).toBe(1);
  });

  it('reads boolean and numeric values correctly', () => {
    expect(readPath({ active: true, count: 0 }, 'active')).toBe(true);
    expect(readPath({ active: true, count: 0 }, 'count')).toBe(0);
  });

  it('reads null values (distinct from missing)', () => {
    expect(readPath({ value: null }, 'value')).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// evaluateOperator - equality
// ═══════════════════════════════════════════════════════════════════════════════

describe('evaluateOperator: equality', () => {
  it('eq: matches same string', () => {
    expect(evaluateOperator('eq', 'critical', 'critical')).toBe(true);
  });

  it('eq: matches with type coercion (number/string)', () => {
    expect(evaluateOperator('eq', 42, '42')).toBe(true);
  });

  it('eq: fails for different values', () => {
    expect(evaluateOperator('eq', 'high', 'critical')).toBe(false);
  });

  it('eq: undefined actual matches null/undefined expected', () => {
    expect(evaluateOperator('eq', undefined, null)).toBe(true);
    expect(evaluateOperator('eq', null, null)).toBe(true);
  });

  it('neq: different values', () => {
    expect(evaluateOperator('neq', 'high', 'critical')).toBe(true);
  });

  it('neq: same values', () => {
    expect(evaluateOperator('neq', 'same', 'same')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// evaluateOperator - numeric comparisons
// ═══════════════════════════════════════════════════════════════════════════════

describe('evaluateOperator: numeric comparisons', () => {
  it('gt: greater than', () => {
    expect(evaluateOperator('gt', 91, 90)).toBe(true);
    expect(evaluateOperator('gt', 90, 90)).toBe(false);
    expect(evaluateOperator('gt', 89, 90)).toBe(false);
  });

  it('gte: greater than or equal', () => {
    expect(evaluateOperator('gte', 91, 90)).toBe(true);
    expect(evaluateOperator('gte', 90, 90)).toBe(true);
    expect(evaluateOperator('gte', 89, 90)).toBe(false);
  });

  it('lt: less than', () => {
    expect(evaluateOperator('lt', 5, 10)).toBe(true);
    expect(evaluateOperator('lt', 10, 10)).toBe(false);
  });

  it('lte: less than or equal', () => {
    expect(evaluateOperator('lte', 10, 10)).toBe(true);
    expect(evaluateOperator('lte', 11, 10)).toBe(false);
  });

  it('handles string-encoded numbers', () => {
    expect(evaluateOperator('gt', '91', 90)).toBe(true);
    expect(evaluateOperator('lt', '5', '10')).toBe(true);
  });

  it('returns false for non-numeric values', () => {
    expect(evaluateOperator('gt', 'abc', 90)).toBe(false);
    expect(evaluateOperator('lt', null, 10)).toBe(false);
    expect(evaluateOperator('gte', undefined, 5)).toBe(false);
  });

  it('returns false for NaN/Infinity', () => {
    expect(evaluateOperator('gt', NaN, 5)).toBe(false);
    expect(evaluateOperator('lt', Infinity, 5)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// evaluateOperator - set membership
// ═══════════════════════════════════════════════════════════════════════════════

describe('evaluateOperator: set membership', () => {
  it('in: value in array', () => {
    expect(evaluateOperator('in', 'critical', ['warning', 'critical', 'fatal'])).toBe(true);
  });

  it('in: value not in array', () => {
    expect(evaluateOperator('in', 'info', ['warning', 'critical'])).toBe(false);
  });

  it('in: handles numeric coercion', () => {
    expect(evaluateOperator('in', 2, ['1', '2', '3'])).toBe(true);
  });

  it('in: undefined actual returns false', () => {
    expect(evaluateOperator('in', undefined, ['a', 'b'])).toBe(false);
  });

  it('in: non-array expected returns false', () => {
    expect(evaluateOperator('in', 'a', 'a' as unknown)).toBe(false);
  });

  it('not_in: value not in array', () => {
    expect(evaluateOperator('not_in', 'info', ['warning', 'critical'])).toBe(true);
  });

  it('not_in: value in array', () => {
    expect(evaluateOperator('not_in', 'critical', ['warning', 'critical'])).toBe(false);
  });

  it('not_in: undefined actual returns true', () => {
    expect(evaluateOperator('not_in', undefined, ['a'])).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// evaluateOperator - containment
// ═══════════════════════════════════════════════════════════════════════════════

describe('evaluateOperator: containment', () => {
  it('contains: string contains substring', () => {
    expect(evaluateOperator('contains', 'hello world', 'world')).toBe(true);
    expect(evaluateOperator('contains', 'hello world', 'foo')).toBe(false);
  });

  it('contains: array contains element', () => {
    expect(evaluateOperator('contains', ['a', 'b', 'c'], 'b')).toBe(true);
    expect(evaluateOperator('contains', ['a', 'b'], 'x')).toBe(false);
  });

  it('contains: undefined/null actual returns false', () => {
    expect(evaluateOperator('contains', undefined, 'x')).toBe(false);
    expect(evaluateOperator('contains', null, 'x')).toBe(false);
  });

  it('not_contains: string does not contain substring', () => {
    expect(evaluateOperator('not_contains', 'hello', 'world')).toBe(true);
    expect(evaluateOperator('not_contains', 'hello world', 'world')).toBe(false);
  });

  it('not_contains: array does not contain element', () => {
    expect(evaluateOperator('not_contains', ['a', 'b'], 'c')).toBe(true);
    expect(evaluateOperator('not_contains', ['a', 'b'], 'a')).toBe(false);
  });

  it('not_contains: undefined/null returns true', () => {
    expect(evaluateOperator('not_contains', undefined, 'x')).toBe(true);
    expect(evaluateOperator('not_contains', null, 'x')).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// evaluateOperator - existence
// ═══════════════════════════════════════════════════════════════════════════════

describe('evaluateOperator: existence', () => {
  it('exists: truthy for present non-null values', () => {
    expect(evaluateOperator('exists', 'value', undefined)).toBe(true);
    expect(evaluateOperator('exists', 0, undefined)).toBe(true);
    expect(evaluateOperator('exists', false, undefined)).toBe(true);
    expect(evaluateOperator('exists', '', undefined)).toBe(true);
  });

  it('exists: false for undefined/null', () => {
    expect(evaluateOperator('exists', undefined, undefined)).toBe(false);
    expect(evaluateOperator('exists', null, undefined)).toBe(false);
  });

  it('not_exists: true for undefined/null', () => {
    expect(evaluateOperator('not_exists', undefined, undefined)).toBe(true);
    expect(evaluateOperator('not_exists', null, undefined)).toBe(true);
  });

  it('not_exists: false for present values', () => {
    expect(evaluateOperator('not_exists', 'value', undefined)).toBe(false);
    expect(evaluateOperator('not_exists', 0, undefined)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// evaluateOperator - regex (matches)
// ═══════════════════════════════════════════════════════════════════════════════

describe('evaluateOperator: regex matches', () => {
  it('matches: valid regex passes', () => {
    expect(evaluateOperator('matches', 'error-500', '\\d{3}')).toBe(true);
    expect(evaluateOperator('matches', 'hello123', '^hello\\d+')).toBe(true);
  });

  it('matches: regex fails for non-matching', () => {
    expect(evaluateOperator('matches', 'no-numbers', '^\\d+$')).toBe(false);
  });

  it('matches: invalid regex returns false', () => {
    expect(evaluateOperator('matches', 'test', '[')).toBe(false);
  });

  it('matches: rejects overly long regex (> 256 chars)', () => {
    const longPattern = 'a'.repeat(257);
    expect(evaluateOperator('matches', 'aaa', longPattern)).toBe(false);
  });

  it('matches: exactly 256 chars regex is allowed', () => {
    const pattern = 'a'.repeat(256);
    expect(evaluateOperator('matches', 'a'.repeat(300), pattern)).toBe(true);
  });

  it('matches: undefined/null actual returns false', () => {
    expect(evaluateOperator('matches', undefined, '.*')).toBe(false);
    expect(evaluateOperator('matches', null, '.*')).toBe(false);
  });

  it('matches: non-string expected returns false', () => {
    expect(evaluateOperator('matches', 'test', 123 as unknown)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// evaluateOperator - between
// ═══════════════════════════════════════════════════════════════════════════════

describe('evaluateOperator: between', () => {
  it('value within range (inclusive)', () => {
    expect(evaluateOperator('between', 50, [0, 100])).toBe(true);
    expect(evaluateOperator('between', 0, [0, 100])).toBe(true);
    expect(evaluateOperator('between', 100, [0, 100])).toBe(true);
  });

  it('value outside range', () => {
    expect(evaluateOperator('between', -1, [0, 100])).toBe(false);
    expect(evaluateOperator('between', 101, [0, 100])).toBe(false);
  });

  it('returns false for non-array expected', () => {
    expect(evaluateOperator('between', 50, 100)).toBe(false);
  });

  it('returns false for wrong-size array', () => {
    expect(evaluateOperator('between', 50, [0])).toBe(false);
    expect(evaluateOperator('between', 50, [0, 50, 100])).toBe(false);
  });

  it('returns false for non-numeric values', () => {
    expect(evaluateOperator('between', 'abc', [0, 100])).toBe(false);
    expect(evaluateOperator('between', 50, ['a', 'b'])).toBe(false);
  });

  it('handles string-encoded numbers', () => {
    expect(evaluateOperator('between', '50', ['0', '100'])).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// evaluateConditions - group behavior
// ═══════════════════════════════════════════════════════════════════════════════

describe('evaluateConditions', () => {
  const payload = {
    severity: 'critical',
    service: 'api-gateway',
    environment: 'production',
    errorRate: 95,
    labels: { team: 'platform', tier: 'p0' },
    tags: ['urgent', 'auto-remediate'],
  };

  it('empty conditions → matched = true', () => {
    const result = evaluateConditions(payload, []);
    expect(result.matched).toBe(true);
    expect(result.conditionResults).toHaveLength(0);
  });

  it('single condition that passes', () => {
    const conditions: AutomationCondition[] = [
      { conditionGroup: 'default', sortOrder: 0, leftPath: 'severity', operator: 'eq', rightValue: 'critical', isRequired: true },
    ];
    const result = evaluateConditions(payload, conditions);
    expect(result.matched).toBe(true);
  });

  it('single condition that fails', () => {
    const conditions: AutomationCondition[] = [
      { conditionGroup: 'default', sortOrder: 0, leftPath: 'severity', operator: 'eq', rightValue: 'info', isRequired: true },
    ];
    const result = evaluateConditions(payload, conditions);
    expect(result.matched).toBe(false);
  });

  it('multiple conditions in same group → OR (any pass = group passes)', () => {
    const conditions: AutomationCondition[] = [
      { conditionGroup: 'severity_check', sortOrder: 0, leftPath: 'severity', operator: 'eq', rightValue: 'fatal', isRequired: true },
      { conditionGroup: 'severity_check', sortOrder: 1, leftPath: 'severity', operator: 'eq', rightValue: 'critical', isRequired: true },
    ];
    const result = evaluateConditions(payload, conditions);
    expect(result.matched).toBe(true); // second passes → group passes
  });

  it('multiple conditions in different groups → AND (all groups must pass)', () => {
    const conditions: AutomationCondition[] = [
      { conditionGroup: 'sev', sortOrder: 0, leftPath: 'severity', operator: 'in', rightValue: ['critical', 'fatal'], isRequired: true },
      { conditionGroup: 'env', sortOrder: 1, leftPath: 'environment', operator: 'eq', rightValue: 'production', isRequired: true },
    ];
    const result = evaluateConditions(payload, conditions);
    expect(result.matched).toBe(true);
  });

  it('fails when one group fails (AND)', () => {
    const conditions: AutomationCondition[] = [
      { conditionGroup: 'sev', sortOrder: 0, leftPath: 'severity', operator: 'eq', rightValue: 'critical', isRequired: true },
      { conditionGroup: 'env', sortOrder: 1, leftPath: 'environment', operator: 'eq', rightValue: 'staging', isRequired: true },
    ];
    const result = evaluateConditions(payload, conditions);
    expect(result.matched).toBe(false);
  });

  it('isRequired=false conditions do not block group', () => {
    const conditions: AutomationCondition[] = [
      { conditionGroup: 'checks', sortOrder: 0, leftPath: 'severity', operator: 'eq', rightValue: 'critical', isRequired: true },
      { conditionGroup: 'checks', sortOrder: 1, leftPath: 'nonexistent', operator: 'eq', rightValue: 'x', isRequired: false },
    ];
    const result = evaluateConditions(payload, conditions);
    expect(result.matched).toBe(true); // required condition passes → group passes
  });

  it('group with only optional conditions always passes', () => {
    const conditions: AutomationCondition[] = [
      { conditionGroup: 'optional_group', sortOrder: 0, leftPath: 'nonexistent', operator: 'eq', rightValue: 'x', isRequired: false },
    ];
    const result = evaluateConditions(payload, conditions);
    expect(result.matched).toBe(true); // all optional → passes
  });

  it('supports nested path evaluation', () => {
    const conditions: AutomationCondition[] = [
      { conditionGroup: 'default', sortOrder: 0, leftPath: 'labels.team', operator: 'eq', rightValue: 'platform', isRequired: true },
    ];
    const result = evaluateConditions(payload, conditions);
    expect(result.matched).toBe(true);
  });

  it('supports $. prefix in paths', () => {
    const conditions: AutomationCondition[] = [
      { conditionGroup: 'default', sortOrder: 0, leftPath: '$.severity', operator: 'eq', rightValue: 'critical', isRequired: true },
    ];
    const result = evaluateConditions(payload, conditions);
    expect(result.matched).toBe(true);
  });

  it('handles missing path with exists operator', () => {
    const conditions: AutomationCondition[] = [
      { conditionGroup: 'default', sortOrder: 0, leftPath: 'service', operator: 'exists', rightValue: undefined, isRequired: true },
    ];
    const result = evaluateConditions(payload, conditions);
    expect(result.matched).toBe(true);
  });

  it('handles missing path with not_exists operator', () => {
    const conditions: AutomationCondition[] = [
      { conditionGroup: 'default', sortOrder: 0, leftPath: 'nonexistent_field', operator: 'not_exists', rightValue: undefined, isRequired: true },
    ];
    const result = evaluateConditions(payload, conditions);
    expect(result.matched).toBe(true);
  });

  it('missing path returns false for comparison operators', () => {
    const conditions: AutomationCondition[] = [
      { conditionGroup: 'default', sortOrder: 0, leftPath: 'missing.field', operator: 'gt', rightValue: 10, isRequired: true },
    ];
    const result = evaluateConditions(payload, conditions);
    expect(result.matched).toBe(false);
  });

  it('returns detailed condition results', () => {
    const conditions: AutomationCondition[] = [
      { conditionGroup: 'default', sortOrder: 0, leftPath: 'errorRate', operator: 'gt', rightValue: 90, isRequired: true },
      { conditionGroup: 'default', sortOrder: 1, leftPath: 'severity', operator: 'eq', rightValue: 'info', isRequired: true },
    ];
    const result = evaluateConditions(payload, conditions);
    expect(result.conditionResults).toHaveLength(2);
    expect(result.conditionResults[0]!.passed).toBe(true);
    expect(result.conditionResults[0]!.actual).toBe(95);
    expect(result.conditionResults[1]!.passed).toBe(false);
    expect(result.conditionResults[1]!.actual).toBe('critical');
  });

  it('handles array containment via contains', () => {
    const conditions: AutomationCondition[] = [
      { conditionGroup: 'default', sortOrder: 0, leftPath: 'tags', operator: 'contains', rightValue: 'urgent', isRequired: true },
    ];
    const result = evaluateConditions(payload, conditions);
    expect(result.matched).toBe(true);
  });

  it('handles between operator for numeric ranges', () => {
    const conditions: AutomationCondition[] = [
      { conditionGroup: 'default', sortOrder: 0, leftPath: 'errorRate', operator: 'between', rightValue: [80, 100], isRequired: true },
    ];
    const result = evaluateConditions(payload, conditions);
    expect(result.matched).toBe(true);
  });

  it('complex multi-group scenario', () => {
    // Group A (OR): severity is critical OR fatal
    // Group B (AND with A): service contains 'api'
    const conditions: AutomationCondition[] = [
      { conditionGroup: 'severity', sortOrder: 0, leftPath: 'severity', operator: 'eq', rightValue: 'fatal', isRequired: true },
      { conditionGroup: 'severity', sortOrder: 1, leftPath: 'severity', operator: 'eq', rightValue: 'critical', isRequired: true },
      { conditionGroup: 'service', sortOrder: 2, leftPath: 'service', operator: 'contains', rightValue: 'api', isRequired: true },
    ];
    const result = evaluateConditions(payload, conditions);
    expect(result.matched).toBe(true);
  });
});
