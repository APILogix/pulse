import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { EventAnalyticsRepository } from '../../src/modules/event-analytics/repository.js';
import { emptyHistogram, observe } from '../../src/modules/analytics-engine/histogram.js';
import { createSketch, hashValue, toBuffer } from '../../src/modules/analytics-engine/hll.js';

describe('EventAnalyticsRepository rollups (ANL-Q006 & ANL-Q007)', () => {
  const orgId = '11111111-1111-4111-8111-111111111111';
  const projectId = '22222222-2222-4222-8222-222222222222';
  const range = {
    from: new Date('2026-08-31T00:00:00.000Z'),
    to: new Date('2026-08-31T04:00:00.000Z'),
  };

  it('getRequestStats uses pre-aggregated rollup histograms when available', async () => {
    const hist = emptyHistogram();
    observe(hist, 45, 50); // 50 requests around 45ms
    observe(hist, 120, 45); // 45 requests around 120ms
    observe(hist, 800, 5); // 5 requests around 800ms

    const queryMock = vi.fn().mockResolvedValueOnce({
      rows: [{
        total: '100',
        errors: '2',
        latency_sum_ms: '9500',
        histograms: [hist],
      }],
    });

    const repo = new EventAnalyticsRepository({ query: queryMock } as unknown as Pool);
    const stats = await repo.getRequestStats(orgId, projectId, 'production', range);

    expect(queryMock).toHaveBeenCalledTimes(1);
    const sql = queryMock.mock.calls[0]![0] as string;
    expect(sql).toContain('FROM request_metrics_1h r');
    expect(sql).not.toContain('events_requests');
    expect(stats.total).toBe(100);
    expect(stats.errors).toBe(2);
    expect(stats.errorRate).toBe(0.02);
    expect(stats.avgLatencyMs).toBe(95);
    expect(stats.p50).toBeGreaterThanOrEqual(35);
    expect(stats.p50).toBeLessThanOrEqual(50);
    expect(stats.p95).toBeGreaterThanOrEqual(100);
    expect(stats.p99).toBeGreaterThanOrEqual(750);
  });

  it('getUniqueUserCount uses pre-aggregated HLL sketches when available', async () => {
    const sketch = createSketch();
    for (let i = 0; i < 50; i++) {
      const h = hashValue(`user-${i}`);
      sketch[2 + h.index] = Math.max(sketch[2 + h.index] ?? 0, h.rank);
    }
    const buf = toBuffer(sketch);

    const queryMock = vi.fn().mockResolvedValueOnce({
      rows: [{
        unique_users_exact: '50',
        sketches: [buf],
      }],
    });

    const repo = new EventAnalyticsRepository({ query: queryMock } as unknown as Pool);
    const count = await repo.getUniqueUserCount(orgId, projectId, 'production', range);

    expect(queryMock).toHaveBeenCalledTimes(1);
    const sql = queryMock.mock.calls[0]![0] as string;
    expect(sql).toContain('FROM request_metrics_1h r');
    expect(sql).not.toContain('events_requests');
    expect(count).toBeGreaterThanOrEqual(45);
    expect(count).toBeLessThanOrEqual(55);
  });

  it('falls back to events_requests if rollup data is not populated', async () => {
    const queryMock = vi.fn()
      .mockResolvedValueOnce({ rows: [{ total: '0', errors: '0', latency_sum_ms: '0', histograms: [] }] }) // rollup empty
      .mockResolvedValueOnce({
        rows: [{
          total: '5',
          errors: '1',
          avg: '60',
          p50: '50',
          p95: '95',
          p99: '99',
        }],
      }); // fallback

    const repo = new EventAnalyticsRepository({ query: queryMock } as unknown as Pool);
    const stats = await repo.getRequestStats(orgId, projectId, 'production', range);

    expect(queryMock).toHaveBeenCalledTimes(2);
    const fallbackSql = queryMock.mock.calls[1]![0] as string;
    expect(fallbackSql).toContain('FROM events_requests');
    expect(stats.total).toBe(5);
    expect(stats.errors).toBe(1);
    expect(stats.p50).toBe(50);
  });
});
