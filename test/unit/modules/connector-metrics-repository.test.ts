import { beforeEach, describe, expect, it, vi } from 'vitest';

const query = vi.fn();

vi.mock('../../../src/config/database.js', () => ({
  pool: {
    query,
  },
}));

async function createRepository() {
  const { ConnectorMetricsRepository } = await import('../../../src/modules/connectors/metrics/metrics.repository.js');
  return new ConnectorMetricsRepository();
}

describe('ConnectorMetricsRepository health checks', () => {
  beforeEach(() => {
    query.mockReset();
  });

  it('stores health history and updates connector status from the health state', async () => {
    const checkedAt = new Date('2026-07-14T12:00:00.000Z');
    query
      .mockResolvedValueOnce({
        rows: [{
          id: 'health-1',
          connector_id: 'connector-1',
          status: 'unhealthy',
          response_time_ms: 250,
          error_message: 'unauthorized',
          details: { httpStatus: 401 },
          checked_at: checkedAt,
        }],
      })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] });

    const repository = await createRepository();

    const row = await repository.insertHealthCheck(
      'connector-1',
      'unhealthy',
      250,
      'unauthorized',
      { httpStatus: 401 },
    );

    expect(row.status).toBe('unhealthy');
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0]![0]).toContain('INSERT INTO connector_health_checks');
    expect(query.mock.calls[1]![0]).toContain("WHEN $2='healthy' THEN 'active'");
    expect(query.mock.calls[1]![0]).toContain("WHEN $2='degraded' THEN 'degraded'");
    expect(query.mock.calls[1]![0]).toContain("ELSE 'error'");
    expect(query.mock.calls[1]![0]).toContain("status IN ('disabled','inactive','revoked')");
    expect(query.mock.calls[1]![1]).toEqual(['connector-1', 'unhealthy']);
  });
});
