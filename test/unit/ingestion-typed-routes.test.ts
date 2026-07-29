/**
 * Behavioral tests for the typed-ingestion service path.
 *
 * Acceptance criterion (docs/distributed-ingestion-routing-master-prompt.md):
 *   "A typed route rejects mismatched event types with INVALID_EVENT_TYPE."
 *
 * These tests exercise the REAL IngestionService.ingestTyped() -> processIngest()
 * policy boundary (the same code the data-driven routes call). The API key is
 * resolved from the in-process LRU cache (seeded below) so no primary-DB round
 * trip is required, and the pg-boss singleton is mocked so queue provisioning
 * and enqueue are no-ops that never touch a live database or queue.
 */
import { describe, expect, it, beforeAll, afterEach, vi } from 'vitest';
import { createHash } from 'node:crypto';

// Env must be present before any src/config/env.js import runs its schema parse.
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

// Mock the pg-boss singleton so provisioning + enqueue are hermetic no-ops.
vi.mock('../../src/lib/pgboss.js', () => {
  const pgboss = {
    createQueue: vi.fn(async () => {}),
    insert: vi.fn(async () => ['job-id']),
    send: vi.fn(async () => 'job-id'),
    on: vi.fn(),
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
  };
  return {
    pgboss,
    startPgBoss: vi.fn(async () => {}),
    stopPgBoss: vi.fn(async () => {}),
  };
});

import { IngestionService } from '../../src/modules/ingestion/service.js';
import { apiKeyCache, type CachedProjectConfig } from '../../src/config/lrucashe.js';

const TEST_API_KEY = 'pulse_test_key_0123456789abcdef0123456789abcdef';

function seedApiKeyCache(): void {
  const keyHash = createHash('sha256').update(TEST_API_KEY).digest('hex');
  const cached: CachedProjectConfig = {
    id: '11111111-1111-1111-1111-111111111111',
    orgId: '22222222-2222-2222-2222-222222222222',
    name: 'Test Project',
    environment: 'production',
    environmentId: '33333333-3333-3333-3333-333333333333',
    environmentName: 'Production',
    rateLimitPerSecond: 1_000_000,
    rateLimitPerMinute: 1_000_000,
    rateLimitPerHour: null,
    allowedEventTypes: ['*'],
    permissions: ['ingest:write'],
    allowedEndpoints: ['*'],
    blockedEndpoints: [],
    allowedOrigins: [],
    allowedIps: [],
    allowedDomains: [],
    allowedSdks: [],
    samplingRules: {},
    featureFlags: {},
    sdkConfig: {},
    isActive: true,
    apiKeyId: '44444444-4444-4444-4444-444444444444',
    planTier: 'free',
    orgRateLimitPerSecond: 1_000_000,
    orgRateLimitPerMinute: 1_000_000,
  };
  apiKeyCache.set(keyHash, cached);
}

// Every query returns empty rows: the quota pre-check reads nothing (fail-open),
// the queue-depth probe reports zero depth, and the usage-counter staging insert
// is a no-op. That is all the DB behaviour the accept/reject paths require.
function createFakePool() {
  return {
    query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
  } as unknown as import('pg').Pool;
}

function buildService(): IngestionService {
  const pool = createFakePool();
  const writer = {
    pool,
    resolveApiKey: vi.fn(async () => null),
    updateApiKeyLastUsed: vi.fn(async () => {}),
    healthCheck: vi.fn(async () => true),
  } as never;
  return new IngestionService(pool, writer, {
    maxBatchSize: 1000,
    defaultRateLimitPerSecond: 1_000_000,
    defaultRateLimitPerMinute: 1_000_000,
  });
}

describe('IngestionService typed routing', () => {
  let service: IngestionService | undefined;

  beforeAll(() => {
    seedApiKeyCache();
  });

  afterEach(async () => {
    if (service) {
      await service.shutdown();
      service = undefined;
    }
  });

  it('rejects a mismatched event type on a typed route with INVALID_EVENT_TYPE', async () => {
    service = buildService();
    await expect(
      service.ingestTyped(
        {
          apiKey: TEST_API_KEY,
          events: [
            {
              type: 'request',
              requestId: 'r1',
              url: '/x',
              method: 'GET',
              statusCode: 200,
              latency: 5,
            } as never,
          ],
        },
        TEST_API_KEY,
        'error',
      ),
    ).rejects.toThrow('INVALID_EVENT_TYPE');
  });

  it('accepts a matching event type on a typed route', async () => {
    service = buildService();
    const result = await service.ingestTyped(
      { apiKey: TEST_API_KEY, events: [{ type: 'error', message: 'boom' } as never] },
      TEST_API_KEY,
      'error',
    );
    expect(result.success).toBe(true);
    expect(result.accepted).toBe(1);
    expect(result.rejected).toBe(0);
  });

  it('rejects when ANY event in a typed batch is a foreign type', async () => {
    service = buildService();
    await expect(
      service.ingestTyped(
        {
          apiKey: TEST_API_KEY,
          events: [
            { type: 'log', level: 'info', message: 'ok' } as never,
            { type: 'metric', metricName: 'm', metricType: 'counter', value: 1 } as never,
          ],
        },
        TEST_API_KEY,
        'log',
      ),
    ).rejects.toThrow('INVALID_EVENT_TYPE');
  });
});
