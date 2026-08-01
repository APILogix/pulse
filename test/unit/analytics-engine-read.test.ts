import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  AnalyticsQueryError,
  cacheKeyFor,
  isCsvRequested,
  parseEnvironment,
  parseScope,
  parseSort,
} from '../../src/modules/analytics-engine/read/query-scope.js';
import {
  buildCard,
  buildFreshness,
  buildMeta,
  buildRankedList,
  buildSeries,
  buildTable,
  formatBytes,
  formatCompact,
  formatLatency,
  formatValue,
  num,
  numOrNull,
  ratePct,
  sparklineFrom,
  tableToCsv,
  trendFor,
} from '../../src/modules/analytics-engine/read/formatters.js';
import {
  ANALYTICS_V2_GLOBAL_ROUTES,
  ANALYTICS_V2_SCOPED_ROUTES,
  analyticsV2Paths,
} from '../../src/modules/analytics-engine/api/route-manifest.js';
import { ALL_ENVIRONMENTS_SENTINEL } from '../../src/modules/analytics-engine/types.js';

const ORG = '11111111-1111-4111-8111-111111111111';
const PROJECT = '22222222-2222-4222-8222-222222222222';

const scope = parseScope(
  { from: '2026-08-01T00:00:00Z', to: '2026-08-01T01:00:00Z', environment: 'production' },
  { organizationId: ORG, projectId: PROJECT },
);

describe('analytics v2 — query scope parsing', () => {
  it('defaults to a 24h window with previous-period comparison', () => {
    const parsed = parseScope({}, { organizationId: ORG, now: new Date('2026-08-01T12:00:00Z') });
    expect(parsed.range.to.getTime() - parsed.range.from.getTime()).toBe(24 * 3_600 * 1_000);
    expect(parsed.compareRange).not.toBeNull();
    expect(parsed.compareRange!.to.getTime()).toBe(parsed.range.from.getTime());
  });

  it('resolves named ranges', () => {
    const parsed = parseScope(
      { range: '15m' },
      { organizationId: ORG, now: new Date('2026-08-01T12:00:00Z') },
    );
    expect(parsed.range.to.getTime() - parsed.range.from.getTime()).toBe(15 * 60 * 1_000);
    expect(parsed.window).toBe('1m');
  });

  it('rejects an unknown named range with the documented code', () => {
    try {
      parseScope({ range: '3y' }, { organizationId: ORG });
      throw new Error('expected a rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(AnalyticsQueryError);
      expect((error as AnalyticsQueryError).code).toBe('INVALID_TIME_RANGE');
    }
  });

  it('rejects an inverted range', () => {
    expect(() =>
      parseScope(
        { from: '2026-08-01T02:00:00Z', to: '2026-08-01T01:00:00Z' },
        { organizationId: ORG },
      ),
    ).toThrow(/must be after/);
  });

  it('rejects a range beyond retention', () => {
    try {
      parseScope(
        { from: '2020-01-01T00:00:00Z', to: '2026-01-01T00:00:00Z' },
        { organizationId: ORG },
      );
      throw new Error('expected a rejection');
    } catch (error) {
      expect((error as AnalyticsQueryError).code).toBe('ANALYTICS_WINDOW_TOO_LARGE');
    }
  });

  it('treats a missing/blank/all environment as the cross-environment sentinel', () => {
    expect(parseEnvironment(undefined)).toBe(ALL_ENVIRONMENTS_SENTINEL);
    expect(parseEnvironment('')).toBe(ALL_ENVIRONMENTS_SENTINEL);
    expect(parseEnvironment('all')).toBe(ALL_ENVIRONMENTS_SENTINEL);
    expect(parseEnvironment('Customer.Prod_1')).toBe('Customer.Prod_1');
  });

  it('rejects an environment that ingestion could never produce', () => {
    expect(() => parseEnvironment('bad environment')).toThrow(/Invalid environment/);
    expect(() => parseEnvironment('-leading-dash')).toThrow(/Invalid environment/);
    expect(() => parseEnvironment('x'.repeat(65))).toThrow(/Invalid environment/);
  });

  it('only allows allowlisted sort columns', () => {
    expect(parseSort('requests:asc', ['requests', 'errors'])).toEqual({
      column: 'requests',
      direction: 'asc',
    });
    expect(() => parseSort('total_count; DROP TABLE x', ['requests'])).toThrow(
      /Cannot sort by/,
    );
    expect(() => parseSort('requests:sideways', ['requests'])).toThrow(/asc or desc/);
  });

  it('clamps limit to the route maximum', () => {
    const parsed = parseScope({ limit: '5000' }, { organizationId: ORG, maxLimit: 200 });
    expect(parsed.limit).toBe(200);
    expect(parseScope({ limit: '0' }, { organizationId: ORG }).limit).toBe(1);
  });

  it('downgrades an unserviceable requested window instead of failing', () => {
    const parsed = parseScope(
      { range: '30d', window: '1m' },
      { organizationId: ORG, now: new Date() },
    );
    expect(parsed.window).toBe('1d');
  });

  it('produces a deterministic cache key that ignores request timing', () => {
    const a = cacheKeyFor('requests.summary', scope);
    const b = cacheKeyFor('requests.summary', scope);
    expect(a).toBe(b);
    expect(a).toContain(ORG);
    expect(a).toContain(PROJECT);
    expect(a).toContain('production');
  });

  it('detects CSV export requests', () => {
    expect(isCsvRequested({ format: 'csv' })).toBe(true);
    expect(isCsvRequested({})).toBe(false);
  });
});

describe('analytics v2 — formatters', () => {
  it('formats values per unit', () => {
    expect(formatCompact(1_500)).toBe('1.5k');
    expect(formatCompact(2_400_000)).toBe('2.4M');
    expect(formatLatency(450)).toBe('450ms');
    expect(formatLatency(1_500)).toBe('1.50s');
    expect(formatBytes(2_048)).toBe('2.0 KB');
    expect(formatValue(null, 'ms')).toBe('—');
    expect(formatValue(12.3456, 'percent')).toBe('12.35%');
    expect(formatValue(1_500_000, 'micros')).toBe('$1.50');
  });

  it('separates trend direction from good/bad semantics', () => {
    expect(trendFor(10, 5)).toBe('up');
    expect(trendFor(5, 10)).toBe('down');
    expect(trendFor(5, 5)).toBe('flat');
    expect(trendFor(5, null)).toBe('flat');

    const card = buildCard(
      {
        key: 'requests.error_rate',
        label: 'Error rate',
        value: 2,
        unit: 'percent',
        direction: 'lower_is_better',
        previous: 1,
      },
      scope,
    );
    expect(card.trend).toBe('up');
    expect(card.direction).toBe('lower_is_better');
    expect(card.deltaPct).toBeCloseTo(100);
    expect(card.formatted).toBe('2.00%');
  });

  it('ships an aiContext string with every card so the client never builds prompts', () => {
    const card = buildCard(
      { key: 'requests.total', label: 'Requests', value: 1_234, unit: 'count', direction: 'neutral', previous: 1_000 },
      scope,
    );
    expect(card.aiContext).toContain('Requests');
    expect(card.aiContext).toContain('1.2k');
    expect(card.aiContext).toContain('production');
    expect(card.aiContext).toContain(PROJECT);
    expect(card.aiContext).toMatch(/vs the previous window/);
  });

  it('handles a null previous window without producing NaN', () => {
    const card = buildCard(
      { key: 'requests.total', label: 'Requests', value: 10, unit: 'count', direction: 'neutral' },
      scope,
    );
    expect(card.delta).toBeNull();
    expect(card.deltaPct).toBeNull();
    expect(card.trend).toBe('flat');
    expect(card.aiContext).toContain('no comparable previous window');
  });

  it('zero-fills counter series across every bucket', () => {
    const series = buildSeries(
      'requests.total',
      'Requests',
      'count',
      '5m',
      [{ bucket: new Date('2026-08-01T00:10:00Z'), value: 7 }],
      { from: new Date('2026-08-01T00:00:00Z'), to: new Date('2026-08-01T00:30:00Z') },
    );
    expect(series.points).toHaveLength(6);
    expect(series.points[0]!.v).toBe(0);
    expect(series.points[2]!.v).toBe(7);
    expect(series.points.every((point) => point.v !== null)).toBe(true);
  });

  it('null-fills gauge series so a gap is not read as zero latency', () => {
    const series = buildSeries(
      'requests.latency_p95',
      'p95',
      'ms',
      '5m',
      [{ bucket: new Date('2026-08-01T00:10:00Z'), value: 120 }],
      { from: new Date('2026-08-01T00:00:00Z'), to: new Date('2026-08-01T00:30:00Z') },
      'null',
    );
    expect(series.points[0]!.v).toBeNull();
    expect(series.points[2]!.v).toBe(120);
  });

  it('downsamples sparklines to a bounded point count', () => {
    const series = buildSeries(
      'requests.total',
      'Requests',
      'count',
      '1m',
      Array.from({ length: 120 }, (_, index) => ({
        bucket: new Date(Date.UTC(2026, 7, 1, 0, index)),
        value: index,
      })),
      { from: new Date('2026-08-01T00:00:00Z'), to: new Date('2026-08-01T02:00:00Z') },
    );
    expect(sparklineFrom(series, 24)).toHaveLength(24);
  });

  it('builds tables and renders RFC-4180 CSV', () => {
    const table = buildTable(
      'endpoints',
      [
        { key: 'endpoint', label: 'Endpoint', align: 'left', format: 'mono', sortable: true },
        { key: 'requests', label: 'Requests', align: 'right', format: 'compact', sortable: true },
      ],
      [{ endpoint: 'GET /a,b', requests: 5 }, { endpoint: 'GET /"q"', requests: 1 }],
      { column: 'requests', direction: 'desc' },
    );
    const csv = tableToCsv(table);
    expect(csv.split('\n')[0]).toBe('Endpoint,Requests');
    expect(csv).toContain('"GET /a,b",5');
    expect(csv).toContain('"GET /""q""",1');
  });

  it('builds ranked lists with formatted values', () => {
    const list = buildRankedList({
      key: 'endpoints.top_slowest',
      label: 'Slowest endpoints',
      unit: 'ms',
      items: [{ key: 'a', label: 'GET /a', value: 1_500, severity: 'critical' }],
    });
    expect(list.items[0]!.formatted).toBe('1.50s');
    expect(list.items[0]!.severity).toBe('critical');
    expect(list.total).toBe(1);
  });

  it('reports freshness and staleness honestly', () => {
    const now = new Date('2026-08-01T12:00:00Z');
    expect(buildFreshness(null, 300, now)).toEqual({
      watermark: null,
      lagSeconds: null,
      stale: true,
    });
    const fresh = buildFreshness(new Date('2026-08-01T11:59:00Z'), 300, now);
    expect(fresh.lagSeconds).toBe(60);
    expect(fresh.stale).toBe(false);
    const stale = buildFreshness(new Date('2026-08-01T11:00:00Z'), 300, now);
    expect(stale.stale).toBe(true);
  });

  it('builds the documented response envelope', () => {
    const meta = buildMeta({
      scope,
      freshness: buildFreshness(new Date(), 300),
      queryTimeMs: 4,
      cacheHit: true,
    });
    expect(meta.scope).toBe('project');
    expect(meta.window).toBe('1m');
    expect(meta.cache).toEqual({ hit: true, layer: 'lru' });
    expect(meta.refresh.suggestedIntervalMs).toBeGreaterThan(0);
    expect(meta.compareRange).not.toBeNull();
    expect(meta.range.from).toBe('2026-08-01T00:00:00.000Z');
  });

  it('coerces Postgres numerics safely', () => {
    expect(num('42')).toBe(42);
    expect(num(null)).toBe(0);
    expect(num('not-a-number')).toBe(0);
    expect(numOrNull(null)).toBeNull();
    expect(numOrNull('7.5')).toBe(7.5);
    expect(ratePct(5, 0)).toBeNull();
    expect(ratePct(5, 10)).toBe(50);
  });
});

describe('analytics v2 — architectural invariants', () => {
  it('never reads raw telemetry from the dashboard read repository', async () => {
    const path = fileURLToPath(
      new URL('../../src/modules/analytics-engine/read/dashboard.repository.ts', import.meta.url),
    );
    const source = await readFile(path, 'utf8');

    // Strip comments so documentation references to events_* do not trip the check.
    const withoutComments = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter((line) => !line.trim().startsWith('*') && !line.trim().startsWith('//'))
      .join('\n');

    expect(withoutComments).not.toMatch(/FROM\s+events_/i);
    expect(withoutComments).not.toMatch(/JOIN\s+events_/i);
  });

  it('reads only rollup and analytics state tables', async () => {
    const path = fileURLToPath(
      new URL('../../src/modules/analytics-engine/read/dashboard.repository.ts', import.meta.url),
    );
    const source = await readFile(path, 'utf8');

    // Capture both literal table names and template-interpolated ones.
    const referenced = [...source.matchAll(/\bFROM\s+(\$\{)?([a-z_][a-z0-9_]*)/gi)]
      .map((match) => match[2])
      .filter((name): name is string => Boolean(name));

    const allowed = (name: string): boolean =>
      // Template variables resolved at runtime from tableFor(), which only ever
      // returns `<domain>_metrics_<window>`.
      name === 'table' ||
      // CTE names.
      name === 'rolled' ||
      // Explicit analytics-owned tables.
      /_metrics_(1m|5m|1h|1d)$/.test(name) ||
      name.startsWith('analytics_') ||
      name === 'project_health_5m';

    const violations = referenced.filter((name) => !allowed(name));
    expect(violations).toEqual([]);
  });

  it('declares every route in the documented v2 surface', () => {
    expect(ANALYTICS_V2_SCOPED_ROUTES).toContain('/requests/summary');
    expect(ANALYTICS_V2_SCOPED_ROUTES).toContain('/requests/latency-histogram');
    expect(ANALYTICS_V2_SCOPED_ROUTES).toContain('/errors/groups');
    expect(ANALYTICS_V2_SCOPED_ROUTES).toContain('/services');
    expect(ANALYTICS_V2_SCOPED_ROUTES).toContain('/overview');
    expect(new Set(ANALYTICS_V2_SCOPED_ROUTES).size).toBe(ANALYTICS_V2_SCOPED_ROUTES.length);
    expect(ANALYTICS_V2_GLOBAL_ROUTES).toContain('/system/health');
  });

  it('exposes every scoped route under both org and project prefixes', () => {
    const paths = analyticsV2Paths();
    expect(paths).toHaveLength(ANALYTICS_V2_SCOPED_ROUTES.length * 2 + ANALYTICS_V2_GLOBAL_ROUTES.length);
    expect(paths).toContain('/analytics/v2/org/:orgId/requests/summary');
    expect(paths).toContain('/analytics/v2/projects/:projectId/requests/summary');
  });

  it('registers the v2 handlers for every manifest route', async () => {
    // The routes module is imported lazily so this assertion does not pull the
    // database pools into the rest of the suite.
    const module = await import('../../src/modules/analytics-engine/api/analytics-v2.routes.js');
    const registered: string[] = [];
    const fakeFastify = {
      analyticsEngine: {
        read: {},
        cache: { get: () => undefined, set: () => undefined },
        watermarks: {},
        resolveProjectOrg: async () => null,
      },
      get(path: string) {
        registered.push(path);
      },
    };

    await module.analyticsV2Routes(fakeFastify as never, {} as never);

    for (const route of ANALYTICS_V2_SCOPED_ROUTES) {
      expect(registered).toContain(`/org/:orgId${route}`);
      expect(registered).toContain(`/projects/:projectId${route}`);
    }
    expect(registered).toContain('/system/health');
    expect(registered).toContain('/org/:orgId/projects/health');
  });
});
