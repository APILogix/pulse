import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => {
  const primaryClient = {
    query: vi.fn().mockResolvedValue({ rows: [{ source: 'primary' }], rowCount: 1 }),
    release: vi.fn(),
  };
  const replicaClient = {
    query: vi.fn().mockRejectedValue(Object.assign(new Error('replica unavailable'), { code: 'ECONNRESET' })),
    release: vi.fn(),
  };
  return { primaryClient, replicaClient, poolsCreated: 0 };
});

vi.mock('pg', () => ({
  Pool: class {
    private readonly client = state.poolsCreated++ === 0 ? state.primaryClient : state.replicaClient;
    connect = vi.fn(async () => this.client);
    query = vi.fn(async (sql: string) => this.client.query(sql));
    on = vi.fn();
    end = vi.fn().mockResolvedValue(undefined);
    totalCount = 0;
    idleCount = 0;
    waitingCount = 0;
  },
}));

vi.mock('../../src/config/env.js', () => ({
  env: {
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://u:p@primary:5432/main',
    DB_FAMILY: undefined,
    LOG_DB_PRIMARY: 'postgresql://u:p@log-primary:5432/logs',
    LOG_DB_REPLICA: 'postgresql://u:p@log-replica:5432/logs',
    LOG_POOL_MAX: 4,
    LOG_POOL_MIN: 0,
    LOG_DB_IDLE_TIMEOUT: 30_000,
    LOG_DB_CONNECTION_TIMEOUT: 10_000,
    LOG_DB_KEEPALIVE_MS: 10_000,
    LOG_DB_SLOW_QUERY_MS: 1000,
    LOG_QUERY_TIMEOUT: 0,
    LOG_DB_WRITE_TIMEOUT: 0,
    LOG_RETRIES: 1,
    LOG_DB_SSL_ENABLED: undefined,
    LOG_DB_SSL_REJECT_UNAUTHORIZED: undefined,
    LOG_DB_ENABLE_TIMESCALE: false,
  },
}));

vi.mock('../../src/config/logger.js', () => ({
  logger: {
    child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  },
}));

vi.mock('../../src/config/postgres-ssl.js', () => ({
  resolvePostgresSslConfig: () => false,
  isExpectedServerlessDisconnect: () => false,
  sanitizePostgresConnectionString: (value: string) => value,
}));

import { logDB } from '../../src/config/log-database.js';

describe('Log DB replica fallback', () => {
  beforeEach(() => {
    state.primaryClient.query.mockClear();
    state.replicaClient.query.mockClear();
    state.primaryClient.release.mockClear();
    state.replicaClient.release.mockClear();
    state.replicaClient.query.mockRejectedValue(
      Object.assign(new Error('replica unavailable'), { code: 'ECONNRESET' }),
    );
  });

  it('retries a failed replica read once against primary', async () => {
    const result = await logDB.queryWithRetry<{ source: string }>(
      'SELECT source',
      [],
      { operation: 'read', timeout: 0, maxRetries: 1 },
    );

    expect(state.replicaClient.query).toHaveBeenCalledWith('SELECT source', []);
    expect(state.primaryClient.query).toHaveBeenCalledWith('SELECT source', []);
    expect(result.rows).toEqual([{ source: 'primary' }]);
    expect(state.replicaClient.release).toHaveBeenCalledOnce();
    expect(state.primaryClient.release).toHaveBeenCalledOnce();

    state.primaryClient.query.mockClear();
    state.replicaClient.query.mockClear();
    await logDB.queryWithRetry('SELECT second', [], { operation: 'read', timeout: 0, maxRetries: 1 });
    expect(state.replicaClient.query).not.toHaveBeenCalled();
    expect(state.primaryClient.query).toHaveBeenCalledWith('SELECT second', []);
  });
});
