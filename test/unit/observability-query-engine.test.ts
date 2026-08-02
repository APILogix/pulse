/**
 * Unit tests for the Unified Explorer Query Engine — pure logic only (no DB).
 *
 * Covers: parameter binding, operator → SQL, keyset cursors, the search DSL,
 * field resolution (incl. JSON paths), index-aware SQL generation, HTTP→DSL
 * parsing, and the engine's envelope + bidirectional pagination via a fake
 * executor. These guarantee tenant scoping, parameterization, and no OFFSET.
 */
import { describe, it, expect } from 'vitest';
import { ParamBag, coerceScalar, buildOperatorFragment } from '../../src/modules/observability/query-engine/operators.js';
import { encodeCursor, decodeCursor } from '../../src/modules/observability/query-engine/cursor.js';
import { parseSearch } from '../../src/modules/observability/query-engine/search-parser.js';
import { resolveField, buildFacets } from '../../src/modules/observability/query-engine/field-registry.js';
import {
  buildListStatement,
  buildSummaryStatement,
  buildStatisticsStatement,
  buildScopePredicates,
} from '../../src/modules/observability/query-engine/sql-builder.js';
import { buildExplorerQuery } from '../../src/modules/observability/query-engine/query-schema.js';
import { ExplorerQueryEngine, type QueryExecutor } from '../../src/modules/observability/query-engine/engine.js';
import { QueryValidationError } from '../../src/modules/observability/query-engine/errors.js';
import type { ExplorerQuery, QueryContext } from '../../src/modules/observability/query-engine/types.js';
import { requestsResource } from '../../src/modules/observability/resources/requests.resource.js';
import { errorsResource } from '../../src/modules/observability/resources/errors.resource.js';
import { explorerRegistry } from '../../src/modules/observability/resources/index.js';

const ORG = '11111111-1111-1111-1111-111111111111';

function ctx(overrides: Partial<QueryContext> = {}): QueryContext {
  return { organizationId: ORG, ...overrides };
}

function baseQuery(overrides: Partial<ExplorerQuery> = {}): ExplorerQuery {
  return {
    timeRange: { from: new Date('2026-01-01T00:00:00Z'), to: new Date('2026-01-02T00:00:00Z') },
    filters: [],
    sort: { field: 'timestamp', direction: 'desc' },
    direction: 'forward',
    limit: 50,
    live: false,
    ...overrides,
  };
}

describe('ParamBag', () => {
  it('hands out sequential placeholders and records params', () => {
    const bag = new ParamBag();
    expect(bag.next('a')).toBe('$1');
    expect(bag.next(2)).toBe('$2');
    expect(bag.params).toEqual(['a', 2]);
    expect(bag.size).toBe(2);
  });
});

describe('coerceScalar', () => {
  it('coerces numbers, booleans, timestamps, and uuids', () => {
    expect(coerceScalar('500', 'number', 'x')).toBe(500);
    expect(coerceScalar('true', 'boolean', 'x')).toBe(true);
    expect(coerceScalar('false', 'boolean', 'x')).toBe(false);
    expect(coerceScalar('2026-01-01', 'timestamp', 'x')).toBeInstanceOf(Date);
    expect(coerceScalar(ORG, 'uuid', 'x')).toBe(ORG);
  });
  it('rejects invalid values', () => {
    expect(() => coerceScalar('abc', 'number', 'x')).toThrow(QueryValidationError);
    expect(() => coerceScalar('not-a-uuid', 'uuid', 'x')).toThrow(QueryValidationError);
    expect(() => coerceScalar('nope', 'boolean', 'x')).toThrow(QueryValidationError);
  });
});

describe('buildOperatorFragment', () => {
  it('binds scalar operators as parameters', () => {
    const bag = new ParamBag();
    expect(buildOperatorFragment('status_code', 'eq', 'number', '500', 'status', bag)).toBe('status_code = $1');
    expect(bag.params).toEqual([500]);
  });
  it('uses ANY for in and ALL for nin', () => {
    const bag = new ParamBag();
    expect(buildOperatorFragment('method', 'in', 'string', ['GET', 'POST'], 'method', bag)).toBe('method = ANY($1)');
    expect(bag.params[0]).toEqual(['GET', 'POST']);
  });
  it('handles between with two bound params', () => {
    const bag = new ParamBag();
    expect(buildOperatorFragment('latency_ms', 'between', 'number', ['10', '20'], 'latency', bag)).toBe('latency_ms BETWEEN $1 AND $2');
    expect(bag.params).toEqual([10, 20]);
  });
  it('escapes LIKE wildcards for contains', () => {
    const bag = new ParamBag();
    buildOperatorFragment('url', 'contains', 'string', '50%_off', 'url', bag);
    expect(bag.params[0]).toBe('%50\\%\\_off%');
  });
  it('renders nullary exists/nexists without params', () => {
    const bag = new ParamBag();
    expect(buildOperatorFragment('trace_id', 'exists', 'string', undefined, 'trace', bag)).toBe('trace_id IS NOT NULL');
    expect(buildOperatorFragment('trace_id', 'nexists', 'string', undefined, 'trace', bag)).toBe('trace_id IS NULL');
    expect(bag.size).toBe(0);
  });
  it('empty IN matches nothing; empty NIN matches everything', () => {
    const bag = new ParamBag();
    expect(buildOperatorFragment('m', 'in', 'string', [], 'm', bag)).toBe('FALSE');
    expect(buildOperatorFragment('m', 'nin', 'string', [], 'm', bag)).toBe('TRUE');
  });
});

describe('keyset cursor', () => {
  it('round-trips a payload', () => {
    const enc = encodeCursor({ t: '2026-01-01T00:00:00.000Z', id: 'abc', d: 'desc' });
    expect(decodeCursor(enc)).toEqual({ t: '2026-01-01T00:00:00.000Z', id: 'abc', d: 'desc' });
  });
  it('rejects tampered cursors', () => {
    expect(() => decodeCursor('not-base64-json')).toThrow(QueryValidationError);
    expect(() => decodeCursor(Buffer.from('{"t":"x","id":"y","d":"desc"}').toString('base64url'))).toThrow(QueryValidationError);
  });
});

describe('search DSL', () => {
  it('parses key:value and comparison operators', () => {
    const { filters } = parseSearch(requestsResource, 'status:500 method:POST latency>1000');
    expect(filters).toEqual([
      { field: 'statusCode', op: 'eq', value: '500' },
      { field: 'method', op: 'eq', value: 'POST' },
      { field: 'latencyMs', op: 'gt', value: '1000' },
    ]);
  });
  it('turns comma values into an in filter', () => {
    const { filters } = parseSearch(requestsResource, 'method:GET,POST');
    expect(filters[0]).toEqual({ field: 'method', op: 'in', value: ['GET', 'POST'] });
  });
  it('keeps quoted phrases and bare words as free text', () => {
    const { filters, text } = parseSearch(requestsResource, '"timeout error" checkout');
    expect(filters).toHaveLength(0);
    expect(text).toEqual(['timeout error', 'checkout']);
  });
  it('rejects unknown keys (fail-closed)', () => {
    expect(() => parseSearch(requestsResource, 'bogus:1')).toThrow(QueryValidationError);
  });
});

describe('field resolution', () => {
  it('resolves a registered field to its column/selectExpr', () => {
    expect(resolveField(requestsResource, 'latencyMs').expr).toBe('duration_ms');
    expect(resolveField(requestsResource, 'clientIp').expr).toBe('client_ip::text');
  });
  it('resolves JSON path fields by binding the key as a parameter', () => {
    const bag = new ParamBag();
    const resolved = resolveField(requestsResource, 'attr:region', bag);
    expect(resolved.expr).toBe('attributes ->> $1');
    expect(bag.params).toEqual(['region']);
    expect(resolved.jsonPath).toBe(true);
  });
  it('throws on unknown fields', () => {
    expect(() => resolveField(requestsResource, 'nope')).toThrow(QueryValidationError);
  });
  it('builds facets excluding non-filterable fields', () => {
    const facets = buildFacets(requestsResource);
    expect(facets.find((f) => f.field === 'method')).toBeTruthy();
    expect(facets.find((f) => f.field === 'hasTrace')).toBeFalsy(); // filterable: false
  });
});

describe('SQL builder', () => {
  it('always scopes organization_id as $1 and binds the time window', () => {
    const bag = new ParamBag();
    const preds = buildScopePredicates(requestsResource, ctx(), baseQuery(), bag, []);
    expect(preds[0]).toBe('organization_id = $1');
    expect(bag.params[0]).toBe(ORG);
    expect(preds.some((p) => p.includes('timestamp >='))).toBe(true);
    expect(preds.some((p) => p.includes('timestamp <'))).toBe(true);
  });

  it('adds project and environment predicates from context', () => {
    const bag = new ParamBag();
    const preds = buildScopePredicates(requestsResource, ctx({ projectId: 'p1', environment: 'production' }), baseQuery(), bag, []);
    expect(preds.some((p) => p.startsWith('project_id ='))).toBe(true);
    expect(preds.some((p) => p.startsWith('environment ='))).toBe(true);
    expect(bag.params).toContain('p1');
    expect(bag.params).toContain('production');
  });

  it('builds a keyset list statement with ORDER BY, no OFFSET, and LIMIT+1', () => {
    const { sql, params, limit } = buildListStatement(requestsResource, ctx(), baseQuery({ limit: 25 }), []);
    expect(sql).toContain('FROM events_requests');
    expect(sql).toContain('ORDER BY timestamp DESC, id DESC');
    expect(sql).not.toContain('OFFSET');
    expect(sql).toContain('AS "__id"');
    expect(sql).toContain('AS "__t"');
    expect(params[params.length - 1]).toBe(26); // limit + 1
    expect(limit).toBe(25);
  });

  it('adds a tuple keyset predicate when a cursor is supplied', () => {
    const cursor = encodeCursor({ t: '2026-01-01T12:00:00.000Z', id: 'row-9', d: 'desc' });
    const { sql } = buildListStatement(requestsResource, ctx(), baseQuery({ cursor }), []);
    expect(sql).toMatch(/\(timestamp, id\) < \(\$\d+, \$\d+\)/);
  });

  it('reverses the scan order for backward pagination', () => {
    const { sql, reversed } = buildListStatement(requestsResource, ctx(), baseQuery({ direction: 'backward' }), []);
    expect(sql).toContain('ORDER BY timestamp ASC, id ASC');
    expect(reversed).toBe(true);
  });

  it('clamps the window to the retention floor', () => {
    const floor = new Date('2026-01-01T06:00:00Z');
    const bag = new ParamBag();
    buildScopePredicates(requestsResource, ctx({ retentionFloor: floor }), baseQuery(), bag, []);
    // The `from` (00:00) is older than the floor (06:00), so the floor is used.
    expect(bag.params).toContainEqual(floor);
  });

  it('generates summary and statistics from the resource definition', () => {
    const summary = buildSummaryStatement(requestsResource, ctx(), baseQuery(), []);
    const stats = buildStatisticsStatement(requestsResource, ctx(), baseQuery(), []);
    expect(summary?.sql).toContain('AS "total"');
    expect(stats?.sql).toContain('AS "p95"');
    expect(summary?.sql).toContain('FROM events_requests');
  });

  it('returns null statistics for resources without a statistics map', () => {
    expect(buildStatisticsStatement(errorsResource, ctx(), baseQuery(), [])).toBeNull();
  });
});

describe('HTTP → DSL parsing', () => {
  it('parses filters JSON, sort, fields CSV, and range', () => {
    const q = buildExplorerQuery(
      {
        range: '24h',
        sort: 'latencyMs:asc',
        fields: 'id,method,url',
        filters: JSON.stringify([{ field: 'statusCode', op: 'gte', value: 500 }]),
      },
      requestsResource.defaultSort,
    );
    expect(q.sort).toEqual({ field: 'latencyMs', direction: 'asc' });
    expect(q.fields).toEqual(['id', 'method', 'url']);
    expect(q.filters).toEqual([{ field: 'statusCode', op: 'gte', value: 500 }]);
    expect(q.timeRange.to.getTime() - q.timeRange.from.getTime()).toBe(24 * 60 * 60 * 1000);
  });

  it('parses live=false correctly (no coercion footgun)', () => {
    expect(buildExplorerQuery({ live: 'false' }, requestsResource.defaultSort).live).toBe(false);
    expect(buildExplorerQuery({ live: 'true' }, requestsResource.defaultSort).live).toBe(true);
  });

  it('rejects invalid filters JSON', () => {
    expect(() => buildExplorerQuery({ filters: '{not json' }, requestsResource.defaultSort)).toThrow(QueryValidationError);
  });
});

describe('ExplorerQueryEngine', () => {
  class FakeExecutor implements QueryExecutor {
    calls: Array<{ sql: string; params: unknown[] }> = [];
    constructor(private readonly listRows: Array<Record<string, unknown>>) {}
    async run<T>(sql: string, params: unknown[]): Promise<T[]> {
      this.calls.push({ sql, params });
      // Only the list statement has a bound LIMIT param; aggregates do not
      // (statistics contains ORDER BY only inside WITHIN GROUP).
      if (sql.includes('LIMIT $')) return this.listRows as unknown as T[];
      return [{ total: '2', errors: '1' }] as unknown as T[];
    }
  }

  const rows = [
    { id: 'a', method: 'GET', __id: 'a', __t: new Date('2026-01-01T00:00:03Z') },
    { id: 'b', method: 'POST', __id: 'b', __t: new Date('2026-01-01T00:00:02Z') },
  ];

  it('assembles the full envelope with items, summary, facets, and query echo', async () => {
    const engine = new ExplorerQueryEngine(new FakeExecutor(rows));
    const res = await engine.list(requestsResource, ctx(), baseQuery());
    expect(res.success).toBe(true);
    expect(res.items).toHaveLength(2);
    expect(res.summary.total).toBe(2);
    expect(res.availableFilters.length).toBeGreaterThan(0);
    expect(res.query.resource).toBe('requests');
    expect(res.states.empty).toBe(false);
  });

  it('reports hasNext and a nextCursor when more rows exist than the limit', async () => {
    const engine = new ExplorerQueryEngine(new FakeExecutor(rows));
    const res = await engine.list(requestsResource, ctx(), baseQuery({ limit: 1 }));
    expect(res.items).toHaveLength(1);
    expect(res.pagination.hasNext).toBe(true);
    expect(res.pagination.nextCursor).toBeTruthy();
    // The cursor decodes back to the last presented row.
    expect(decodeCursor(res.pagination.nextCursor as string).id).toBe('a');
  });

  it('rejects filters on unknown fields', async () => {
    const engine = new ExplorerQueryEngine(new FakeExecutor(rows));
    await expect(
      engine.list(requestsResource, ctx(), baseQuery({ filters: [{ field: 'ghost', op: 'eq', value: 1 }] })),
    ).rejects.toThrow(QueryValidationError);
  });
});


describe('resource registry integrity', () => {
  for (const resource of explorerRegistry.list()) {
    describe(resource.name, () => {
      it('searchFields resolve to registered fields', () => {
        for (const field of resource.searchFields) {
          expect(() => resolveField(resource, field)).not.toThrow();
        }
      });

      it('searchAlias targets are registered fields', () => {
        for (const target of Object.values(resource.searchAliases ?? {})) {
          expect(resource.fields[target], `alias → ${target}`).toBeTruthy();
        }
      });

      it('defaultProjection fields exist and are projectable', () => {
        for (const name of resource.defaultProjection ?? []) {
          const def = resource.fields[name];
          expect(def, `field ${name}`).toBeTruthy();
          expect(def?.projectable === false).toBe(false);
        }
      });

      it('defaultSort targets the time column or a sortable field', () => {
        const sort = resource.defaultSort;
        const valid = sort.field === resource.timeColumn || resource.fields[sort.field]?.sortable === true;
        expect(valid).toBe(true);
      });

      it('builds a list statement with free-text search without throwing', () => {
        const { filters, text } = parseSearch(resource, 'hello world');
        const query = baseQuery({ filters });
        expect(() => buildListStatement(resource, ctx(), query, text)).not.toThrow();
      });

      it('generates a summary statement scoped to the resource table', () => {
        const summary = buildSummaryStatement(resource, ctx(), baseQuery(), []);
        if (summary) expect(summary.sql).toContain(`FROM ${resource.table}`);
      });
    });
  }
});
