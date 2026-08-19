import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';

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

import { UsageAnalyticsRepository } from '../../src/modules/projects/usage/analytics.repository.js';

describe('UsageAnalyticsRepository', () => {
  it('queries project_usage_monthly by year_month instead of bucket', async () => {
    const mockQuery = vi.fn().mockResolvedValue({
      rows: [
        {
          year_month: '2026-08',
          total_events: '1250',
          total_bytes: '512000',
          api_key_requests: '300',
          rate_limited_events: '10',
          alert_notifications: '5',
          active_users: '12',
        },
      ],
    });

    const mockDb = { query: mockQuery } as unknown as Pool;
    const repository = new UsageAnalyticsRepository(mockDb);

    const result = await repository.getMonthlyUsageVsPlan('proj-123');

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQuery.mock.calls[0];

    // Ensure SQL does NOT reference bucket on project_usage_monthly
    expect(sql).not.toContain('bucket');
    expect(sql).toContain('year_month');
    expect(sql).toContain('FROM project_usage_monthly');
    expect(sql).toContain('ORDER BY year_month DESC');
    expect(params).toEqual(['proj-123']);

    expect(result).toEqual([
      {
        yearMonth: '2026-08',
        totalEvents: 1250,
        totalBytes: 512000,
        apiKeyRequests: 300,
        rateLimitedEvents: 10,
        alertNotifications: 5,
        activeUsers: 12,
        planLimit: null,
        usagePercent: null,
      },
    ]);
  });
});
