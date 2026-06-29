/**
 * Unit tests for alerting pure logic: fingerprinting/dedup, the condition
 * evaluation engine (incl. AND/OR grouping), template rendering + sanitization,
 * and routing resolution with fallback. No DB/env/network dependencies.
 */
import { describe, it, expect } from 'vitest';
import { computeFingerprint, normalizePayload, renderDedupKey } from '../../../src/modules/alerting/fingerprint.js';
import { evaluateCondition, evaluateRule, readPath, type EvaluableCondition } from '../../../src/modules/alerting/evaluator.js';
import { renderTemplate, sanitizeValue, extractVariables } from '../../../src/modules/alerting/template.js';
import { resolveRouting, matchesConditions, type RoutableAlert } from '../../../src/modules/alerting/routing.js';
import type { AlertRoutingRuleRow } from '../../../src/modules/alerting/types.js';

describe('fingerprint', () => {
  it('is stable regardless of payload key order', () => {
    const a = computeFingerprint({ ruleId: 'r1', source: 'monitoring', payload: { a: 1, b: 2 } });
    const b = computeFingerprint({ ruleId: 'r1', source: 'monitoring', payload: { b: 2, a: 1 } });
    expect(a).toBe(b);
  });

  it('changes when source or rule changes', () => {
    const base = computeFingerprint({ ruleId: 'r1', source: 'monitoring', payload: { x: 1 } });
    expect(computeFingerprint({ ruleId: 'r2', source: 'monitoring', payload: { x: 1 } })).not.toBe(base);
    expect(computeFingerprint({ ruleId: 'r1', source: 'security', payload: { x: 1 } })).not.toBe(base);
  });

  it('can restrict the fingerprint to selected key fields', () => {
    const a = computeFingerprint({ ruleId: 'r1', source: 's', payload: { host: 'h1', ts: 100 }, keyFields: ['host'] });
    const b = computeFingerprint({ ruleId: 'r1', source: 's', payload: { host: 'h1', ts: 999 }, keyFields: ['host'] });
    expect(a).toBe(b); // ts ignored
  });

  it('normalizes nested payloads to dotted leaves', () => {
    const n = normalizePayload({ cpu: { usage: 91 }, tags: ['a', 'b'] });
    expect(n['cpu.usage']).toBe('91');
    expect(n['tags.0']).toBe('a');
  });

  it('renders dedup key templates', () => {
    const key = renderDedupKey('{{rule_id}}:{{source}}:{{fingerprint}}', { ruleId: 'r1', source: 'mon', fingerprint: 'abc' });
    expect(key).toBe('r1:mon:abc');
  });
});

describe('evaluator: operators', () => {
  it('handles numeric comparisons with string coercion', () => {
    expect(evaluateCondition('gt', '91', 90)).toBe(true);
    expect(evaluateCondition('lte', 90, 90)).toBe(true);
    expect(evaluateCondition('lt', 5, 3)).toBe(false);
  });
  it('handles contains / in / regex / exists', () => {
    expect(evaluateCondition('contains', ['x', 'y'], 'y')).toBe(true);
    expect(evaluateCondition('contains', 'hello world', 'world')).toBe(true);
    expect(evaluateCondition('in', 'b', ['a', 'b'])).toBe(true);
    expect(evaluateCondition('regex', 'error-500', '\\d{3}')).toBe(true);
    expect(evaluateCondition('exists', null, undefined)).toBe(false);
    expect(evaluateCondition('exists', 0, undefined)).toBe(true);
  });
  it('reads dotted paths', () => {
    expect(readPath({ a: { b: { c: 7 } } }, 'a.b.c')).toBe(7);
    expect(readPath({ a: 1 }, 'a.b')).toBeUndefined();
  });
});

describe('evaluator: rule combination', () => {
  const cond = (over: Partial<EvaluableCondition>): EvaluableCondition => ({
    conditionGroupId: null, fieldPath: 'v', operator: 'gt', thresholdValue: 10, isRequired: true, ...over,
  });

  it('ANDs ungrouped conditions', () => {
    const conditions = [cond({ fieldPath: 'a', thresholdValue: 1 }), cond({ fieldPath: 'b', thresholdValue: 1 })];
    expect(evaluateRule({ a: 5, b: 5 }, conditions).matched).toBe(true);
    expect(evaluateRule({ a: 5, b: 0 }, conditions).matched).toBe(false);
  });

  it('ORs conditions within the same group', () => {
    const conditions = [
      cond({ conditionGroupId: 'g1', fieldPath: 'a', thresholdValue: 100 }),
      cond({ conditionGroupId: 'g1', fieldPath: 'b', thresholdValue: 100 }),
    ];
    // group passes if either a>100 OR b>100
    expect(evaluateRule({ a: 200, b: 0 }, conditions).matched).toBe(true);
    expect(evaluateRule({ a: 0, b: 0 }, conditions).matched).toBe(false);
  });

  it('ANDs groups together', () => {
    const conditions = [
      cond({ conditionGroupId: 'g1', fieldPath: 'a', thresholdValue: 10 }),
      cond({ conditionGroupId: 'g2', fieldPath: 'b', thresholdValue: 10 }),
    ];
    expect(evaluateRule({ a: 20, b: 20 }, conditions).matched).toBe(true);
    expect(evaluateRule({ a: 20, b: 0 }, conditions).matched).toBe(false);
  });

  it('returns false for an empty condition set', () => {
    expect(evaluateRule({ a: 1 }, []).matched).toBe(false);
  });
});

describe('template rendering', () => {
  it('substitutes dotted variables and sanitizes values', () => {
    const r = renderTemplate('Alert {{event.title}} on {{event.host}}', { event: { title: '<b>CPU</b>', host: 'web1' } });
    expect(r.output).toContain('&lt;b&gt;CPU&lt;/b&gt;');
    expect(r.output).toContain('web1');
    expect(r.referenced).toEqual(['event.title', 'event.host']);
  });

  it('reports missing variables and renders them empty', () => {
    const r = renderTemplate('Hi {{name}} {{missing}}', { name: 'Ada' });
    expect(r.output).toBe('Hi Ada ');
    expect(r.missing).toEqual(['missing']);
  });

  it('sanitizes script/markup injection attempts', () => {
    expect(sanitizeValue('<script>alert(1)</script>')).not.toContain('<script>');
    expect(sanitizeValue('a"b\'c')).toBe('a&quot;b&#39;c');
  });

  it('extracts declared variables', () => {
    expect(extractVariables('{{a}} {{b.c}} {{a}}')).toEqual(['a', 'b.c']);
  });
});

describe('routing resolution', () => {
  const rule = (over: Partial<AlertRoutingRuleRow>): AlertRoutingRuleRow => ({
    id: 'rr1', organization_id: 'o1', name: 'r', description: null, priority: 100,
    conditions: {}, target_connector_ids: [], target_route_ids: [], fallback_connector_ids: [],
    template_id: null, is_active: true, created_at: new Date(), updated_at: new Date(), deleted_at: null,
    ...over,
  });

  const alert: RoutableAlert = { severity: 'critical', source: 'monitoring', labels: { env: 'prod' } };

  it('matches by severity/source/labels', () => {
    expect(matchesConditions(alert, { severity: ['critical'] })).toBe(true);
    expect(matchesConditions(alert, { severity: ['warning'] })).toBe(false);
    expect(matchesConditions(alert, { labels: { env: 'prod' } })).toBe(true);
    expect(matchesConditions(alert, { labels: { env: 'dev' } })).toBe(false);
  });

  it('selects the highest-priority matching rule', () => {
    const rules = [
      rule({ id: 'low', priority: 10, conditions: { severity: ['critical'] }, target_connector_ids: ['c-low'] }),
      rule({ id: 'high', priority: 99, conditions: { severity: ['critical'] }, target_connector_ids: ['c-high'] }),
    ];
    const decision = resolveRouting(alert, rules);
    expect(decision.matchedRuleId).toBe('high');
    expect(decision.connectorIds).toEqual(['c-high']);
    expect(decision.usedFallback).toBe(false);
  });

  it('falls back when the matched rule has no primary connectors', () => {
    const rules = [rule({ conditions: { source: ['monitoring'] }, target_connector_ids: [], fallback_connector_ids: ['fb'] })];
    const decision = resolveRouting(alert, rules);
    expect(decision.connectorIds).toEqual(['fb']);
    expect(decision.usedFallback).toBe(true);
  });

  it('returns no connectors when nothing matches', () => {
    const rules = [rule({ conditions: { severity: ['info'] }, target_connector_ids: ['x'] })];
    expect(resolveRouting(alert, rules).connectorIds).toEqual([]);
  });

  it('ignores inactive rules', () => {
    const rules = [rule({ is_active: false, conditions: {}, target_connector_ids: ['x'] })];
    expect(resolveRouting(alert, rules).matchedRuleId).toBeNull();
  });
});
