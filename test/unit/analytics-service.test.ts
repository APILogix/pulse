import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';

vi.hoisted(() => {
  process.env.NODE_ENV = 'development';
  process.env.DATABASE_URL = 'postgresql://localhost:5432/test';
  process.env.REDIS_URL = 'redis://localhost:6379';
  process.env.JWT_SECRET = 'jwt-secret-jwt-secret-jwt-secret-jwt-secret';
  process.env.JWT_REFRESH_SECRET = 'refresh-secret-refresh-secret-refresh-secret';
  process.env.COOKIE_SECRET = 'cookie-secret-cookie-secret-cookie-secret';
  process.env.AUTH_TOKEN_SECRET = 'auth-token-secret-auth-token-secret';
  process.env.ENCRYPTION_KEY = 'encryption-key-encryption-key-32';
});

import { UsageAnalyticsService } from '../../src/modules/projects/usage/analytics.service.js';
import { UsageAnalyticsRepository } from '../../src/modules/projects/usage/analytics.repository.js';
import { BaseProjectService } from '../../src/modules/projects/shared/base.service.js';
import { ProjectMemberRole } from '../../src/modules/projects/types.js';
import type {
  UsageAnalyticsQuery,
  UsageSummary,
  UsageTimeSeriesPoint,
} from '../../src/modules/projects/usage/analytics.types.js';

const createMockLogger = (): FastifyBaseLogger =>
  ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    trace: vi.fn(),
    child: vi.fn().mockReturnThis(),
    bindings: vi.fn().mockReturnValue({}),
    flush: vi.fn(),
    level: 'silent',
  } as unknown as FastifyBaseLogger);

describe('UsageAnalyticsService', () => {
  let repository: UsageAnalyticsRepository;
  let base: BaseProjectService;
  let service: UsageAnalyticsService;
  const logger = createMockLogger();

  beforeEach(() => {
    repository = {
      getSummary: vi.fn(),
      getTimeSeries: vi.fn(),
      getCalendarHeatmap: vi.fn(),
      getHourlyHeatmap: vi.fn(),
      getDayOfWeekHeatmap: vi.fn(),
      getTopList: vi.fn(),
      getComparison: vi.fn(),
      getMonthlyUsageVsPlan: vi.fn(),
    } as unknown as UsageAnalyticsRepository;

    base = {
      requireProjectAccess: vi.fn().mockResolvedValue({ id: 'project-1' }),
    } as unknown as BaseProjectService;

    service = new UsageAnalyticsService(repository, base, logger);
  });

  const query: UsageAnalyticsQuery = {
    from: new Date('2025-01-01T00:00:00Z'),
    to: new Date('2025-01-02T00:00:00Z'),
    granularity: 'hourly',
    limit: 10,
    offset: 0,
  };

  const summary: UsageSummary = {
    totalEvents: 100,
    errors: 5,
    requests: 80,
    transactions: 0,
    traces: 0,
    spans: 0,
    logs: 0,
    metrics: 0,
    profiles: 0,
    aiEvents: 0,
    sdkRequests: 0,
    activeApiKeys: 1,
    activeEnvironments: 1,
    activeUsers: 0,
    activeMembers: 0,
    alertCount: 0,
    connectorDeliveries: 0,
    failedNotifications: 0,
    rateLimitUsage: 0,
    latencyMsP50: null,
    latencyMsP95: null,
    latencyMsP99: null,
  };

  const point: UsageTimeSeriesPoint = {
    bucket: '2025-01-01T00:00:00.000Z',
    totalEvents: 10,
    errors: 0,
    requests: 8,
    transactions: 0,
    traces: 0,
    spans: 0,
    logs: 0,
    metrics: 0,
    profiles: 0,
    aiEvents: 0,
    sdkRequests: 0,
    activeApiKeys: 1,
    activeEnvironments: 1,
    activeUsers: 0,
    activeMembers: 0,
    alertCount: 0,
    connectorDeliveries: 0,
    failedNotifications: 0,
    rateLimitUsage: 0,
    latencyMsP50: null,
    latencyMsP95: null,
    latencyMsP99: null,
  };

  it('authorizes viewers before reading analytics', async () => {
    (repository.getSummary as ReturnType<typeof vi.fn>).mockResolvedValue(summary);
    (repository.getTimeSeries as ReturnType<typeof vi.fn>).mockResolvedValue({
      points: [point],
      hasMore: false,
    });

    await service.getUsageAnalytics('org-1', 'project-1', 'user-1', query);

    expect(base.requireProjectAccess).toHaveBeenCalledWith(
      'org-1',
      'project-1',
      'user-1',
      ProjectMemberRole.VIEWER,
    );
  });

  it('returns cached analytics response on repeated identical queries', async () => {
    (repository.getSummary as ReturnType<typeof vi.fn>).mockResolvedValue(summary);
    (repository.getTimeSeries as ReturnType<typeof vi.fn>).mockResolvedValue({
      points: [point],
      hasMore: false,
    });

    const first = await service.getUsageAnalytics('org-1', 'project-1', 'user-1', query);
    const second = await service.getUsageAnalytics('org-1', 'project-1', 'user-1', query);

    expect(first).toBe(second);
    expect(repository.getSummary).toHaveBeenCalledTimes(1);
    expect(repository.getTimeSeries).toHaveBeenCalledTimes(1);
  });

  it('encodes and decodes cursor pagination', async () => {
    (repository.getSummary as ReturnType<typeof vi.fn>).mockResolvedValue(summary);
    (repository.getTimeSeries as ReturnType<typeof vi.fn>).mockResolvedValue({
      points: Array.from({ length: 11 }, (_, i) => ({ ...point, bucket: `2025-01-01T0${i}:00:00.000Z` })),
      hasMore: true,
    });

    const response = await service.getUsageAnalytics('org-1', 'project-1', 'user-1', query);

    expect(response.hasMore).toBe(true);
    expect(response.nextCursor).toBeDefined();
    // Decoded cursor should equal the original offset + limit.
    const decoded = Number.parseInt(
      Buffer.from(response.nextCursor ?? '', 'base64').toString('utf8'),
      10,
    );
    expect(decoded).toBe(query.offset + query.limit);
  });

  it('evicts project-specific cache entries', async () => {
    (repository.getSummary as ReturnType<typeof vi.fn>).mockResolvedValue(summary);
    (repository.getTimeSeries as ReturnType<typeof vi.fn>).mockResolvedValue({
      points: [point],
      hasMore: false,
    });

    await service.getUsageAnalytics('org-1', 'project-1', 'user-1', query);
    service.evictProjectCache('project-1');
    await service.getUsageAnalytics('org-1', 'project-1', 'user-1', query);

    expect(repository.getSummary).toHaveBeenCalledTimes(2);
  });
});
