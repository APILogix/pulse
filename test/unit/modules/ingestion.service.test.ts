import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { IngestionService } from '../../../src/modules/ingestion/service.js';
import { apiKeyCache, type CachedProjectConfig } from '../../../src/config/lrucashe.js';
import { entitlementsService } from '../../../src/modules/billing/entitlements/service.js';

vi.mock('../../../src/lib/pgboss.js', () => {
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

const TEST_API_KEY = 'pulse_test_key_disable_rate_limit_0123456789abcdef';

function seedRateLimitTestApiKey(): void {
  const keyHash = createHash('sha256').update(TEST_API_KEY).digest('hex');
  const cached: CachedProjectConfig = {
    id: '11111111-1111-1111-1111-111111111111',
    orgId: '22222222-2222-2222-2222-222222222222',
    name: 'Rate Limit Disabled Project',
    environment: 'production',
    environmentId: '33333333-3333-3333-3333-333333333333',
    environmentName: 'Production',
    rateLimitPerSecond: 1,
    rateLimitPerMinute: 1,
    rateLimitPerHour: null,
    allowedEventTypes: ['*'],
    permissions: ['ingest:write'],
    allowedEndpoints: ['*'],
    blockedEndpoints: [],
    allowedOrigins: [],
    allowedIps: [],
    allowedDomains: [],
    allowedSdks: [],
    isActive: true,
    apiKeyId: '44444444-4444-4444-4444-444444444444',
    apiKeyName: 'SDK key',
    planTier: 'free',
    orgRateLimitPerSecond: 1,
    orgRateLimitPerMinute: 1,
  };
  apiKeyCache.set(keyHash, cached);
}

describe.skip('ingestion service unit coverage', () => {
  it('is not implemented yet');
});

describe('IngestionService job chunking', () => {
  function jobBuilder(jobChunkSize: number, jobMaxBytes: number) {
    const service = Object.create(IngestionService.prototype) as {
      jobChunkSize: number;
      jobMaxBytes: number;
      buildJobs(params: unknown): Array<{ payload: { events: unknown[]; eventType: string }; queue: string }>;
    };
    service.jobChunkSize = jobChunkSize;
    service.jobMaxBytes = jobMaxBytes;
    return service;
  }

  const baseParams = {
    organizationId: '00000000-0000-0000-0000-000000000001',
    projectId: '00000000-0000-0000-0000-000000000002',
    apiKeyId: 'key-1',
    apiKeyName: 'SDK key',
    planTier: 'business',
    environment: 'production',
    batchId: 'batch-1',
    receivedAt: '2026-08-24T00:00:00.000Z',
  };

  it('splits pg-boss jobs by approximate serialized event bytes', () => {
    const service = jobBuilder(10, 100);
    const jobs = service.buildJobs({
      ...baseParams,
      byType: new Map([
        ['span', [
          { raw: { type: 'span', eventId: 'a' }, bytes: 60 },
          { raw: { type: 'span', eventId: 'b' }, bytes: 60 },
          { raw: { type: 'span', eventId: 'c' }, bytes: 20 },
        ]],
      ]),
    });

    expect(jobs.map((job) => job.payload.events.length)).toEqual([1, 2]);
    expect(jobs.every((job) => job.queue === 'ingest.span')).toBe(true);
  });

  it('still enforces the configured event-count ceiling per job', () => {
    const service = jobBuilder(2, 10_000);
    const jobs = service.buildJobs({
      ...baseParams,
      byType: new Map([
        ['error', [
          { raw: { type: 'error', eventId: 'a' }, bytes: 10 },
          { raw: { type: 'error', eventId: 'b' }, bytes: 10 },
          { raw: { type: 'error', eventId: 'c' }, bytes: 10 },
        ]],
      ]),
    });

    expect(jobs.map((job) => job.payload.events.length)).toEqual([2, 1]);
    expect(jobs.every((job) => job.payload.eventType === 'error')).toBe(true);
  });
});

describe('IngestionService queue depth cache', () => {
  it('returns the cached queue depth without waiting for a stale refresh', async () => {
    let resolveDepthQuery!: (value: { rows: unknown[] }) => void;
    const depthQuery = new Promise<{ rows: unknown[] }>((resolve) => {
      resolveDepthQuery = resolve;
    });
    const pool = {
      query: vi.fn()
        .mockReturnValueOnce(depthQuery)
        .mockResolvedValueOnce({ rows: [] }),
    };
    const service = Object.create(IngestionService.prototype) as {
      pool: unknown;
      cachedDepth: { pending: number; ready: number; deferred: number; active: number; failed: number; deadLettered: number; oldestPendingAgeMs: null; perQueue: unknown[]; dlqPerQueue: unknown[] };
      cachedDepthAt: number;
      depthRefreshPromise: Promise<void> | null;
      queueDepth(): Promise<{ pending: number }>;
    };
    service.pool = pool;
    service.cachedDepth = {
      pending: 42,
      ready: 40,
      deferred: 2,
      active: 0,
      failed: 0,
      deadLettered: 0,
      oldestPendingAgeMs: null,
      perQueue: [],
      dlqPerQueue: [],
    };
    service.cachedDepthAt = 0;
    service.depthRefreshPromise = null;

    const depth = await service.queueDepth();

    expect(depth.pending).toBe(42);
    expect(pool.query).toHaveBeenCalledTimes(1);

    resolveDepthQuery({ rows: [] });
    await service.depthRefreshPromise;
    expect(pool.query).toHaveBeenCalledTimes(2);
  });
});

describe('IngestionService quota cache', () => {
  it('does not wait on a cold quota refresh before allowing ingestion', async () => {
    let resolveEntitlement!: (value: number) => void;
    let resolveUsage!: (value: { rows: Array<{ events_used: string }> }) => void;
    const entitlement = new Promise<number>((resolve) => {
      resolveEntitlement = resolve;
    });
    const usage = new Promise<{ rows: Array<{ events_used: string }> }>((resolve) => {
      resolveUsage = resolve;
    });
    const entitlementSpy = vi
      .spyOn(entitlementsService, 'getEffectiveIntegerFeature')
      .mockReturnValueOnce(entitlement);
    const pool = {
      query: vi.fn().mockReturnValueOnce(usage),
    };
    const service = Object.create(IngestionService.prototype) as {
      pool: unknown;
      quotaCache: Map<string, unknown>;
      quotaRefreshes: Map<string, Promise<void>>;
      quotaCacheTtlMs: number;
      assertQuotaAvailable(orgId: string): void;
    };
    service.pool = pool;
    service.quotaCache = new Map();
    service.quotaRefreshes = new Map();
    service.quotaCacheTtlMs = 60_000;

    service.assertQuotaAvailable('org-1');

    expect(entitlementSpy).toHaveBeenCalledWith('org-1', 'quota.monthly_events');
    expect(pool.query).toHaveBeenCalledTimes(1);
    expect(service.quotaCache.has('org-1')).toBe(false);

    resolveEntitlement(100);
    resolveUsage({ rows: [{ events_used: '10' }] });
    await service.quotaRefreshes.get('org-1');
    expect(service.quotaCache.get('org-1')).toMatchObject({
      eventsUsed: 10,
      eventLimit: 100,
    });

    entitlementSpy.mockRestore();
  });

  it('still rejects immediately when a cached hard-limit quota is exhausted', () => {
    const service = Object.create(IngestionService.prototype) as {
      quotaCache: Map<string, unknown>;
      quotaRefreshes: Map<string, Promise<void>>;
      quotaCacheTtlMs: number;
      assertQuotaAvailable(orgId: string): void;
    };
    service.quotaCache = new Map([
      ['org-1', {
        eventsUsed: 100,
        eventLimit: 100,
        usageBehavior: 'hard_limit',
        at: Date.now(),
      }],
    ]);
    service.quotaRefreshes = new Map();
    service.quotaCacheTtlMs = 60_000;

    expect(() => service.assertQuotaAvailable('org-1')).toThrow('QUOTA_EXCEEDED');
  });
});

describe('IngestionService without route rate limiting', () => {
  it('accepts consecutive batches even when cached project limits are tiny', async () => {
    seedRateLimitTestApiKey();
    const pool = {
      query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
    } as unknown as import('pg').Pool;
    const writer = {
      pool,
      resolveApiKey: vi.fn(async () => null),
      updateApiKeyLastUsed: vi.fn(async () => {}),
      healthCheck: vi.fn(async () => true),
    } as never;
    const service = new IngestionService(
      pool,
      writer,
      {
        maxBatchSize: 1000,
        defaultRateLimitPerSecond: 1,
        defaultRateLimitPerMinute: 1,
      },
    );

    const request = {
      events: [{ type: 'span' }],
      metadata: { environment: 'production' },
    } as never;

    await expect(service.ingestTyped(request, TEST_API_KEY, 'span')).resolves.toMatchObject({
      success: true,
      accepted: 1,
      rejected: 0,
    });
    await expect(service.ingestTyped(request, TEST_API_KEY, 'span')).resolves.toMatchObject({
      success: true,
      accepted: 1,
      rejected: 0,
    });

    await service.shutdown();
  });
});
