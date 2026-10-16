import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  isObservabilityQueryCacheable,
  buildObservabilityQueryCacheKey,
} from '../../src/modules/observability/query-engine/cache.js';
import { ExplorerQueryEngine, type QueryExecutor } from '../../src/modules/observability/query-engine/engine.js';
import type { ExplorerQuery, QueryContext } from '../../src/modules/observability/query-engine/types.js';
import { spansResource } from '../../src/modules/observability/resources/spans.resource.js';
import { redisCache } from '../../src/config/redis.js';

describe('Tier 2.5: Observability Query Cache (TimescaleDB query cache in Redis for queries > 5m ago)', () => {
  const orgA = 'org_tenant_alpha';
  const orgB = 'org_tenant_beta';
  const now = Date.now();

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('Cache eligibility: live queries (<= 5m ago) are never cached; historical queries (> 5m ago) are cached', () => {
    const liveQuery: ExplorerQuery = {
      filters: [],
      timeRange: { from: new Date(now - 60_000), to: new Date(now) },
      sort: { field: 'occurredAt', direction: 'desc' },
      limit: 50,
    };
    expect(isObservabilityQueryCacheable(liveQuery, now)).toBe(false);

    const historicalQuery: ExplorerQuery = {
      filters: [],
      timeRange: { from: new Date(now - 3600_000), to: new Date(now - 600_000) }, // ended 10m ago
      sort: { field: 'occurredAt', direction: 'desc' },
      limit: 50,
    };
    expect(isObservabilityQueryCacheable(historicalQuery, now)).toBe(true);
  });

  it('Cache key incorporates org_id, query hash, and floored time bucket (1m)', () => {
    const query: ExplorerQuery = {
      filters: [{ field: 'serviceName', op: 'eq', value: 'auth-service' }],
      timeRange: { from: new Date(now - 3600_000), to: new Date(now - 600_000) },
      sort: { field: 'occurredAt', direction: 'desc' },
      limit: 25,
    };

    const keyA = buildObservabilityQueryCacheKey(orgA, 'spans', query, {});
    const keyB = buildObservabilityQueryCacheKey(orgB, 'spans', query, {});

    // Must be tenant-isolated
    expect(keyA).toContain(orgA);
    expect(keyB).toContain(orgB);
    expect(keyA).not.toBe(keyB);

    // Must contain floored 1m bucket
    const expectedBucket = Math.floor(query.timeRange.to.getTime() / 60_000);
    expect(keyA).toContain(String(expectedBucket));
  });

  it('Historical query hits Redis cache and avoids TimescaleDB executor on refresh', async () => {
    const redisStore = new Map<string, string>();
    vi.spyOn(redisCache, 'get').mockImplementation(async (key: string) => redisStore.get(key) ?? null);
    vi.spyOn(redisCache, 'set').mockImplementation(async (key: string, val: string, _mode?: any, _ttl?: any) => {
      redisStore.set(key, val);
      return 'OK';
    });

    const mockRun = vi.fn().mockResolvedValue([
      {
        __id: 'span_1',
        __t: new Date(now - 700_000),
        span_id: 'span_1',
        trace_id: 'trace_1',
        service_name: 'api',
        name: 'GET /users',
        start_time: new Date(now - 700_000),
        duration_ms: 12.5,
        status_code: 'STATUS_CODE_OK',
      },
    ]);

    const executor: QueryExecutor = { run: mockRun };
    const engine = new ExplorerQueryEngine(executor);

    const ctx: QueryContext = { organizationId: orgA };
    const query: ExplorerQuery = {
      filters: [],
      timeRange: { from: new Date(now - 3600_000), to: new Date(now - 600_000) }, // ended 10m ago
      sort: { field: 'occurredAt', direction: 'desc' },
      limit: 20,
    };

    // First call: misses cache, executes SQL query
    const res1 = await engine.list(spansResource as any, ctx, query);
    expect(res1.items.length).toBe(1);
    const initialRunCount = mockRun.mock.calls.length;
    expect(initialRunCount).toBeGreaterThan(0);

    // Second call: hits Redis cache, 0 SQL executions
    const res2 = await engine.list(spansResource as any, ctx, query);
    expect(res2.items.length).toBe(1);
    expect(mockRun.mock.calls.length).toBe(initialRunCount); // No additional DB calls!
  });
});
