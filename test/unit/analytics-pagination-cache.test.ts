import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UsageAnalyticsService } from '../../src/modules/projects/usage/analytics.service.js';
import { assertCacheKeyTenantScoped } from '../helpers/tenant-cache-key.helper.js';

describe('Tier 1.1: Analytics Pagination Cache Key (retain cursor and scope by org)', () => {
  let service: UsageAnalyticsService;
  let mockRepository: any;
  let mockBase: any;
  let mockLogger: any;

  const orgId = 'org_test_12345678';
  const projectId = 'proj_test_87654321';
  const userId = 'user_test_111';

  beforeEach(() => {
    mockRepository = {
      getSummary: vi.fn().mockResolvedValue({ totalRequests: 1000, errorCount: 10 }),
      getTimeSeries: vi.fn().mockImplementation((pId: string, q: any) => {
        if (q.cursor) {
          // Page 2 data
          return Promise.resolve({
            points: [{ timestamp: '2026-10-16T01:00:00Z', totalRequests: 50, errorCount: 0 }],
            hasMore: false,
          });
        }
        // Page 1 data
        return Promise.resolve({
          points: [{ timestamp: '2026-10-16T00:00:00Z', totalRequests: 100, errorCount: 2 }],
          hasMore: true,
        });
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

  it('Page 2 returns Page 2 data and does not serve cached Page 1', async () => {
    // 1. Fetch Page 1
    const page1Query = {
      from: '2026-10-16T00:00:00Z',
      to: '2026-10-16T02:00:00Z',
      interval: '1h' as const,
      limit: 1,
      offset: 0,
    };

    const res1 = await service.getUsageAnalytics(orgId, projectId, userId, page1Query as any);
    expect(res1.timeSeries[0].timestamp).toBe('2026-10-16T00:00:00Z');
    expect(res1.nextCursor).toBeTruthy();

    // 2. Fetch Page 2 with the cursor returned from Page 1
    const page2Query = {
      ...page1Query,
      cursor: res1.nextCursor!,
    };

    const res2 = await service.getUsageAnalytics(orgId, projectId, userId, page2Query as any);

    // CRITICAL: Page 2 must contain Page 2 data, NOT cached Page 1!
    expect(res2.timeSeries[0].timestamp).toBe('2026-10-16T01:00:00Z');
    expect(res2.timeSeries[0].totalRequests).toBe(50);
    expect(mockRepository.getTimeSeries).toHaveBeenCalledTimes(2);
  });

  it('Analytics cache keys are tenant-scoped with orgId', async () => {
    const page1Query = {
      from: '2026-10-16T00:00:00Z',
      to: '2026-10-16T02:00:00Z',
      interval: '1h' as const,
      limit: 10,
      offset: 0,
    };

    await service.getUsageAnalytics(orgId, projectId, userId, page1Query as any);

    // Inspect keys stored in cache
    const cacheKeys = Array.from((service as any).cache.keys()) as string[];
    expect(cacheKeys.length).toBeGreaterThan(0);

    for (const key of cacheKeys) {
      assertCacheKeyTenantScoped(key, { expectedOrgId: orgId });
    }
  });
});
