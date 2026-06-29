/**
 * Unit tests for event-analytics pure logic: the safe query builder, the
 * waterfall tree builder, Apdex scoring, time-range resolution, and CSV
 * serialization. No DB/env/network dependencies.
 */
import { describe, it, expect } from 'vitest';
import { AnalyticsQueryBuilder } from '../../../src/modules/event-analytics/query-builder.js';
import { buildWaterfallTree, computeApdex, type FlatSpan } from '../../../src/modules/event-analytics/waterfall.js';
import { resolveTimeRange, RANGE_MS, InvalidTimeRangeError } from '../../../src/modules/event-analytics/types.js';
import { toCsv } from '../../../src/modules/event-analytics/csv.js';

describe('AnalyticsQueryBuilder', () => {
  it('always scopes by organization_id as $1', () => {
    const { sql, params } = new AnalyticsQueryBuilder('errors', 'org-1').select();
    expect(sql).toContain('FROM events_errors');
    expect(sql).toContain('organization_id = $1');
    expect(params[0]).toBe('org-1');
  });

  it('binds all values as parameters (no interpolation)', () => {
    const { sql, params } = new AnalyticsQueryBuilder('requests', 'org-1')
      .whereTimeRange(new Date('2026-01-01'), new Date('2026-01-02'))
      .whereEq('method', 'GET')
      .whereEq('status_code', 500)
      .orderBy('timestamp', 'desc')
      .paginate(25, 50)
      .select('id, method');
    expect(sql).toMatch(/timestamp >= \$2 AND timestamp < \$3/);
    expect(sql).toContain('method = $4');
    expect(sql).toContain('status_code = $5');
    expect(sql).toContain('LIMIT $6 OFFSET $7');
    expect(params).toEqual(['org-1', new Date('2026-01-01'), new Date('2026-01-02'), 'GET', 500, 25, 50]);
  });

  it('skips undefined filters', () => {
    const { sql } = new AnalyticsQueryBuilder('errors', 'o').whereEq('service', undefined).select();
    expect(sql).not.toContain('service =');
  });

  it('rejects unknown tables', () => {
    // @ts-expect-error invalid table key
    expect(() => new AnalyticsQueryBuilder('drop_table', 'o')).toThrow();
  });

  it('builds bucketed time-series with extra aggregates', () => {
    const { sql } = new AnalyticsQueryBuilder('errors', 'o')
      .whereTimeRange(new Date(), new Date())
      .timeSeries('hour', `COUNT(*) FILTER (WHERE severity='fatal') AS fatal`);
    expect(sql).toContain("DATE_TRUNC('hour', timestamp)");
    expect(sql).toContain('GROUP BY bucket');
    expect(sql).toContain('fatal');
  });
});

describe('waterfall tree', () => {
  const spans = (): FlatSpan[] => [
    { span_id: 'root', parent_span_id: null, start_time: '2026-01-01T00:00:00Z' },
    { span_id: 'a', parent_span_id: 'root', start_time: '2026-01-01T00:00:01Z' },
    { span_id: 'b', parent_span_id: 'root', start_time: '2026-01-01T00:00:00.5Z' },
    { span_id: 'a1', parent_span_id: 'a', start_time: '2026-01-01T00:00:02Z' },
  ];

  it('nests children under parents and assigns depth', () => {
    const tree = buildWaterfallTree(spans());
    expect(tree).toHaveLength(1);
    expect(tree[0]!.span_id).toBe('root');
    expect(tree[0]!.depth).toBe(0);
    // children sorted by start_time → b (00.5) before a (01)
    expect(tree[0]!.children.map((c) => c.span_id)).toEqual(['b', 'a']);
    const a = tree[0]!.children.find((c) => c.span_id === 'a')!;
    expect(a.depth).toBe(1);
    expect(a.children[0]!.span_id).toBe('a1');
    expect(a.children[0]!.depth).toBe(2);
  });

  it('promotes orphaned spans (missing parent) to roots', () => {
    const tree = buildWaterfallTree([{ span_id: 'x', parent_span_id: 'ghost', start_time: '2026-01-01T00:00:00Z' }]);
    expect(tree).toHaveLength(1);
    expect(tree[0]!.span_id).toBe('x');
  });

  it('does not infinitely loop on cycles', () => {
    const cyclic: FlatSpan[] = [
      { span_id: 'p', parent_span_id: 'q', start_time: '2026-01-01T00:00:00Z' },
      { span_id: 'q', parent_span_id: 'p', start_time: '2026-01-01T00:00:01Z' },
    ];
    expect(() => buildWaterfallTree(cyclic)).not.toThrow();
  });
});

describe('apdex', () => {
  it('computes (satisfied + tolerating/2) / total', () => {
    expect(computeApdex(80, 10, 100)).toBe(0.85);
  });
  it('returns null with no samples', () => {
    expect(computeApdex(0, 0, 0)).toBeNull();
  });
});

describe('time range resolution', () => {
  it('derives from a named range', () => {
    const to = new Date('2026-06-29T12:00:00Z');
    const r = resolveTimeRange({ range: '24h', to });
    expect(to.getTime() - r.from.getTime()).toBe(RANGE_MS['24h']);
  });
  it('honors explicit from/to', () => {
    const from = new Date('2026-06-01'); const to = new Date('2026-06-02');
    const r = resolveTimeRange({ from, to });
    expect(r.from).toEqual(from);
    expect(r.to).toEqual(to);
  });
  it('rejects from >= to', () => {
    expect(() => resolveTimeRange({ from: new Date('2026-06-02'), to: new Date('2026-06-01') })).toThrow(InvalidTimeRangeError);
  });
});

describe('csv export', () => {
  it('serializes rows with a union header and escapes special chars', () => {
    const csv = toCsv([
      { a: 1, b: 'x' },
      { a: 2, b: 'has,comma', c: 'new\nline' },
    ]);
    const lines = csv.split('\n');
    expect(lines[0]).toBe('a,b,c');
    expect(csv).toContain('"has,comma"');
    expect(csv).toContain('"new\nline"');
  });
  it('returns empty string for no rows', () => {
    expect(toCsv([])).toBe('');
  });
});
