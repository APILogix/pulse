import { describe, expect, it, vi } from 'vitest';
import type { Pool, PoolClient } from 'pg';
import { AnalyticsRepository } from '../../src/modules/analytics/repository.js';

describe('AnalyticsRepository listEvents (ANL-Q010)', () => {
  const projectId = '22222222-2222-4222-8222-222222222222';
  const query = {
    from: new Date('2026-08-31T00:00:00.000Z'),
    to: new Date('2026-08-31T04:00:00.000Z'),
    limit: 50,
    sort: 'desc' as const,
  };

  it('queries only events_errors when type=error', async () => {
    const queryMock = vi.fn().mockResolvedValue({ rows: [] });
    const clientMock = { query: queryMock, release: vi.fn() } as unknown as PoolClient;
    const poolMock = { connect: vi.fn().mockResolvedValue(clientMock) } as unknown as Pool;

    const repo = new AnalyticsRepository(poolMock);
    await repo.listEvents(projectId, { ...query, type: 'error' });

    const sql = queryMock.mock.calls[2]![0] as string;
    expect(sql).toContain('FROM events_errors');
    expect(sql).not.toContain('FROM events_requests');
    expect(sql).not.toContain('FROM events_logs');
    expect(sql).not.toContain('FROM events_traces');
  });

  it('queries only events_requests when type=request', async () => {
    const queryMock = vi.fn().mockResolvedValue({ rows: [] });
    const clientMock = { query: queryMock, release: vi.fn() } as unknown as PoolClient;
    const poolMock = { connect: vi.fn().mockResolvedValue(clientMock) } as unknown as Pool;

    const repo = new AnalyticsRepository(poolMock);
    await repo.listEvents(projectId, { ...query, type: 'request' });

    const sql = queryMock.mock.calls[2]![0] as string;
    expect(sql).toContain('FROM events_requests');
    expect(sql).not.toContain('FROM events_errors');
    expect(sql).not.toContain('FROM events_logs');
  });

  it('searches indexed text columns instead of unindexed payload::text ILIKE serialization', async () => {
    const queryMock = vi.fn().mockResolvedValue({ rows: [] });
    const clientMock = { query: queryMock, release: vi.fn() } as unknown as PoolClient;
    const poolMock = { connect: vi.fn().mockResolvedValue(clientMock) } as unknown as Pool;

    const repo = new AnalyticsRepository(poolMock);
    await repo.listEvents(projectId, { ...query, searchQuery: 'auth timeout' });

    const sql = queryMock.mock.calls[2]![0] as string;
    expect(sql).not.toContain('payload::text');
    expect(sql).toContain('e.message ILIKE');
    expect(sql).toContain('e.url ILIKE');
    expect(sql).toContain('e.error_name ILIKE');
    expect(sql).toContain('e.service ILIKE');
  });
});
