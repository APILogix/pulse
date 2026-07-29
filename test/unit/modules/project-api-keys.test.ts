import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/config/database.js', () => ({
  pool: { query: vi.fn(), connect: vi.fn() },
}));

// The api-key service now syncs best-effort Log DB lookup snapshots, which
// transitively imports the Log DB manager. Stub it to keep this test hermetic.
vi.mock('../../../src/config/log-database.js', () => ({
  logDB: { queryWithRetry: vi.fn() },
}));

import {
  ApiKeyUsageQuerySchema,
  CreateApiKeyBodySchema,
  UpdateApiKeyBodySchema,
} from '../../../src/modules/projects/api-keys/api-key.types.js';
import { ApiKeyService } from '../../../src/modules/projects/api-keys/api-key.service.js';

const orgId = '11111111-1111-4111-8111-111111111111';
const projectId = '22222222-2222-4222-8222-222222222222';
const environmentId = '33333333-3333-4333-8333-333333333333';
const apiKeyId = '44444444-4444-4444-8444-444444444444';
const userId = '55555555-5555-4555-8555-555555555555';

const meta = {
  actorUserId: userId, actorEmail: null, actorSessionId: null,
  actorIp: '127.0.0.1', actorUserAgent: 'vitest',
  requestId: '66666666-6666-4666-8666-666666666666',
  httpMethod: 'POST', endpoint: '/api-keys',
};

function serviceWith(apiKeys: Record<string, unknown>, environments: Record<string, unknown> = {}) {
  const service = new ApiKeyService(
    { withTransaction: vi.fn(async (work: any) => work({})) } as any,
    { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() } as any,
    {} as any, {} as any, {} as any,
    apiKeys as any, environments as any, {} as any,
  );
  vi.spyOn(service, 'requireProjectAccess').mockResolvedValue({} as any);
  vi.spyOn(service, 'enforceProjectModuleLimit').mockResolvedValue({} as any);
  vi.spyOn(service, 'audit').mockResolvedValue(undefined);
  return service;
}

describe('API key request contract', () => {
  it('accepts only identity fields on create', () => {
    expect(CreateApiKeyBodySchema.parse({ environmentId, name: 'Web SDK' })).toMatchObject({
      environmentId, name: 'Web SDK',
    });
  });

  it('rejects credential-owned policy, rate limits, and key types', () => {
    for (const removed of [
      { keyType: 'read_write' },
      { rateLimitPerSecond: 100 },
      { permissions: ['ingest:write'] },
      { allowedIps: ['10.0.0.1'] },
      { allowedEventTypes: ['error'] },
      { autoRotateEnabled: true },
      { publicKey: 'spoofed_prefix' },
    ]) {
      expect(() => CreateApiKeyBodySchema.parse({ environmentId, name: 'Key', ...removed })).toThrow();
    }
    expect(() => UpdateApiKeyBodySchema.parse({ rateLimitPerMinute: 10 })).toThrow();
  });

  it('defaults usage reads to the daily billing grain and validates the window', () => {
    const parsed = ApiKeyUsageQuerySchema.parse({
      from: '2026-01-01T00:00:00.000Z', to: '2026-01-08T00:00:00.000Z',
    });
    expect(parsed.granularity).toBe('daily');
    expect(() => ApiKeyUsageQuerySchema.parse({
      from: '2026-01-08T00:00:00.000Z', to: '2026-01-01T00:00:00.000Z',
    })).toThrow();
  });
});

describe('API key lifecycle uses status as the only source of truth', () => {
  it('records rotation history and links the new credential lineage', async () => {
    const apiKeys = {
      findApiKeyRecordById: vi.fn().mockResolvedValue({
        id: apiKeyId, projectId, environmentId, name: 'Web SDK',
        status: 'active', expiresAt: null, secretHash: 'a'.repeat(64),
      }),
      markApiKeyRotated: vi.fn().mockResolvedValue(undefined),
      createApiKey: vi.fn(async (input: any) => ({ ...input, id: 'new-key', status: 'active' })),
      recordRotation: vi.fn().mockResolvedValue({ id: 'rotation-1', state: 'grace_period' }),
    };
    const environments = {
      findEnvironment: vi.fn().mockResolvedValue({
        id: environmentId, slug: 'production', isActive: true, deletedAt: null,
      }),
    };
    const service = serviceWith(apiKeys, environments);

    const result = await service.rotateApiKey(orgId, projectId, apiKeyId, userId, {}, meta as any);

    expect(apiKeys.markApiKeyRotated).toHaveBeenCalled();
    expect(apiKeys.createApiKey.mock.calls[0]![0]).toMatchObject({ rotatedFromKeyId: apiKeyId });
    expect(apiKeys.recordRotation.mock.calls[0]![0]).toMatchObject({
      oldKeyId: apiKeyId, newKeyId: 'new-key', initiatedBy: userId,
    });
    expect(result.fullKey.startsWith(`${result.apiKey.publicKey}.`)).toBe(true);
    expect(result.apiKey).not.toHaveProperty('secretHash');
  });

  it('refuses to resume a revoked credential', async () => {
    const apiKeys = {
      findApiKeyRecordById: vi.fn().mockResolvedValue({
        id: apiKeyId, projectId, environmentId, name: 'Web SDK',
        status: 'revoked', expiresAt: null, secretHash: 'b'.repeat(64),
      }),
      setApiKeyStatus: vi.fn(),
    };
    const service = serviceWith(apiKeys);
    await expect(service.enableApiKey(orgId, projectId, apiKeyId, userId, meta as any))
      .rejects.toMatchObject({ code: 'API_KEY_NOT_RESUMABLE' });
    expect(apiKeys.setApiKeyStatus).not.toHaveBeenCalled();
  });

  it('summarizes usage with an accepted-versus-error rate and no percentiles', () => {
    const service = serviceWith({});
    const summary = service.summarizeUsage([
      {
        bucket: '2026-01-01T00:00:00.000Z', requests: 10, acceptedEvents: 8,
        errorEvents: 2, ingestionFailures: 1, acceptedBytes: 100, rateLimitedRequests: 3,
      },
      {
        bucket: '2026-01-02T00:00:00.000Z', requests: 10, acceptedEvents: 10,
        errorEvents: 0, ingestionFailures: 0, acceptedBytes: 100, rateLimitedRequests: 0,
      },
    ]);
    expect(summary).toEqual({
      requests: 20, acceptedEvents: 18, errorEvents: 2, ingestionFailures: 1,
      acceptedBytes: 200, rateLimitedRequests: 3, errorRate: 10,
    });
    expect(summary).not.toHaveProperty('latencyMsP95');
  });
});
