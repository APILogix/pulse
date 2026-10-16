import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UsageAnalyticsService } from '../../src/modules/projects/usage/analytics.service.js';

describe('Tier 2.2: Analytics Time-Window Quantization', () => {
  let service: UsageAnalyticsService;
  let mockRepository: any;
  let mockBase: any;
  let mockLogger: any;

  const orgId = 'org_quant_123';
  const projectId = 'proj_quant_456';
  const userId = 'user_quant_789';

  beforeEach(() => {
    mockRepository = {
      getSummary: vi.fn().mockImplementation(async () => {
        await new Promise((r) => setTimeout(r, 20));
        return { totalRequests: 500, errorCount: 5 };
      }),
      getTimeSeries: vi.fn().mockImplementation(async () => {
        await new Promise((r) => setTimeout(r, 20));
        return {
          points: [{ timestamp: '2026-10-16T14:00:00Z', totalRequests: 50, errorCount: 0 }],
          hasMore: false,
        };
      }),
    };

    mockBase = {
      requireProjectAccess: vi.fn().mockResolvedValue(undefined),
    };

    mockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    service = new UsageAnalyticsService(mockRepository, mockBase, mockLogger);
  });

  it('Two queries 10 seconds apart with the same relative range share a cache entry', async () => {
    // Query 1 at 14:00:12 (<1h range: 30 minutes)
    const query1 = {
      from: '2026-10-16T13:30:12.000Z',
      to: '2026-10-16T14:00:12.000Z',
      interval: '1m' as const,
      limit: 50,
      offset: 0,
    };

    const start1 = performance.now();
    const res1 = await service.getUsageAnalytics(orgId, projectId, userId, query1 as any);
    const duration1 = performance.now() - start1;

    expect(res1.summary.totalRequests).toBe(500);
    expect(mockRepository.getTimeSeries).toHaveBeenCalledTimes(1);

    // Query 2 fired 10 seconds later (from and to shifted forward by 10s within the same 1m bucket)
    const query2 = {
      from: '2026-10-16T13:30:22.000Z',
      to: '2026-10-16T14:00:22.000Z',
      interval: '1m' as const,
      limit: 50,
      offset: 0,
    };

    const start2 = performance.now();
    const res2 = await service.getUsageAnalytics(orgId, projectId, userId, query2 as any);
    const duration2 = performance.now() - start2;

    // CRITICAL: Query 2 must hit the cache!
    // DB query count must NOT increase; latency must be sub-millisecond (< 10ms vs ~40ms DB call)
    expect(res2.summary.totalRequests).toBe(500);
    expect(mockRepository.getTimeSeries).toHaveBeenCalledTimes(1);
    expect(duration2).toBeLessThan(duration1);
  });

  it('5-minute quantization applies for ranges >= 1 hour', async () => {
    // Range: 2 hours
    const query1 = {
      from: '2026-10-16T12:01:15.000Z',
      to: '2026-10-16T14:01:15.000Z',
      interval: '5m' as const,
      limit: 50,
      offset: 0,
    };

    await service.getUsageAnalytics(orgId, projectId, userId, query1 as any);
    expect(mockRepository.getTimeSeries).toHaveBeenCalledTimes(1);

    // Shift by 2 minutes (within the same 5-minute bucket: 12:00:00 to 14:00:00)
    const query2 = {
      from: '2026-10-16T12:03:45.000Z',
      to: '2026-10-16T14:03:45.000Z',
      interval: '5m' as const,
      limit: 50,
      offset: 0,
    };

    await service.getUsageAnalytics(orgId, projectId, userId, query2 as any);

    // Must hit cache
    expect(mockRepository.getTimeSeries).toHaveBeenCalledTimes(1);
  });
});
