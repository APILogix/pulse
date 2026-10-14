import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  env: { REDIS_REQUIRED: false },
  poolQuery: vi.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] }),
  logHealth: vi.fn().mockResolvedValue({ healthy: true }),
  redisPing: vi.fn().mockRejectedValue(new Error('redis://user:secret@cache unavailable')),
  warn: vi.fn(),
}));

vi.mock('../../src/config/env.js', () => ({ env: mocks.env }));
vi.mock('../../src/config/database.js', () => ({ pool: { query: mocks.poolQuery } }));
vi.mock('../../src/config/log-database.js', () => ({
  logDB: { healthCheck: mocks.logHealth },
}));
vi.mock('../../src/config/redis.js', () => ({ checkRedis: mocks.redisPing }));
vi.mock('../../src/config/logger.js', () => ({
  logger: { child: () => ({ warn: mocks.warn }) },
}));

import { registerHealthPlugin } from '../../src/config/plugins.js';

async function readyResponse() {
  const app = Fastify();
  await app.register(registerHealthPlugin);
  const response = await app.inject({ method: 'GET', url: '/ready' });
  await app.close();
  return response;
}

describe('Redis readiness policy', () => {
  afterEach(() => {
    mocks.env.REDIS_REQUIRED = false;
    vi.clearAllMocks();
    mocks.poolQuery.mockResolvedValue({ rows: [{ '?column?': 1 }] });
    mocks.logHealth.mockResolvedValue({ healthy: true });
    mocks.redisPing.mockRejectedValue(new Error('redis unavailable'));
  });

  it('keeps the API ready when optional Redis is unavailable', async () => {
    mocks.env.REDIS_REQUIRED = false;
    const response = await readyResponse();
    const payload = response.json();

    expect(response.statusCode).toBe(200);
    expect(payload.status).toBe('ready');
    expect(payload.checks.redis).toEqual(expect.objectContaining({
      healthy: false,
      error: 'unavailable',
    }));
    expect(JSON.stringify(payload)).not.toContain('secret');
  }, 15_000);

  it('fails readiness when Redis is explicitly required', async () => {
    mocks.env.REDIS_REQUIRED = true;
    const response = await readyResponse();

    expect(response.statusCode).toBe(503);
    expect(response.json().status).toBe('degraded');
  });
});
