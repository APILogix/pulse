import { describe, expect, it, vi } from 'vitest';
import type { Pool, PoolClient } from 'pg';

vi.mock('../../../src/config/database.js', () => ({
  pool: { query: vi.fn(), connect: vi.fn() },
}));

// The project/api-key services now sync best-effort Log DB lookup snapshots,
// which transitively imports the Log DB manager. Keep this unit test hermetic
// by stubbing it so no real pg pool is constructed.
vi.mock('../../../src/config/log-database.js', () => ({
  logDB: { queryWithRetry: vi.fn() },
}));

import { ProjectRepository } from '../../../src/modules/projects/core/project.repository.js';
import { ProjectService } from '../../../src/modules/projects/core/project.service.js';
import { ApiKeyRepository } from '../../../src/modules/projects/api-keys/api-key.repository.js';
import { ApiKeyService } from '../../../src/modules/projects/api-keys/api-key.service.js';
import { UsageRepository } from '../../../src/modules/projects/usage/usage.repository.js';
import { AIRepository } from '../../../src/modules/ai/repository.js';

const project = {
  id: '11111111-1111-4111-8111-111111111111',
  orgId: '22222222-2222-4222-8222-222222222222',
  name: 'Payments', slug: 'payments', description: null, status: 'active',
  visibility: 'private', timezone: 'UTC', tags: [], icon: null, color: null,
  metadata: {}, archivedAt: null, deletedAt: null, deletedBy: null,
  createdAt: new Date('2026-01-01T00:00:00Z'), updatedAt: new Date('2026-01-01T00:00:00Z'), version: 1,
} as const;

const meta = {
  actorUserId: '33333333-3333-4333-8333-333333333333', actorEmail: null,
  actorSessionId: null, actorIp: '127.0.0.1', actorUserAgent: 'vitest',
  requestId: '44444444-4444-4444-8444-444444444444', httpMethod: 'POST', endpoint: '/projects',
};

describe('project core runtime provisioning', () => {
  it('seeds only the usage counter (no environments) through the transaction client', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 1 });
    const repo = new ProjectRepository({} as Pool);
    await repo.provisionUsageCounter(project as any, { query } as any);
    const sql = query.mock.calls.map(([statement]) => statement).join('\n');
    // Environments are provisioned explicitly by the service layer now — the
    // repository default provisioning only seeds the usage counter.
    expect(sql).toContain('project_usage_current');
    expect(sql).not.toContain('project_environments');
    expect(sql).not.toContain("'staging'");
    expect(sql).not.toContain("'testing'");
    expect(sql).not.toContain("'preview'");
    expect(sql).not.toContain('organization_audit_logs');
  });

  it('rolls back the project transaction when provisioning fails', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const release = vi.fn();
    const db = { connect: vi.fn().mockResolvedValue({ query, release }) } as unknown as Pool;
    const repo = new ProjectRepository(db);
    await expect(repo.withTransaction(async () => { throw new Error('seed failed'); })).rejects.toThrow('seed failed');
    expect(query.mock.calls.map(([sql]) => sql)).toEqual(['BEGIN', 'ROLLBACK']);
    expect(release).toHaveBeenCalledOnce();
  });

  it('provisions Production environment, SDK config, and initial API key inside createProject transaction', async () => {
    const client = { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 1 }) } as unknown as PoolClient;
    const environment = {
      id: '55555555-5555-4555-8555-555555555555', slug: 'production', name: 'Production',
      type: 'production', isDefault: true, isActive: true, deletedAt: null,
    };
    const repository = {
      findOrganizationMembership: vi.fn().mockResolvedValue({ role: 'owner', isActive: true }),
      getProjectModuleUsageCounts: vi.fn().mockResolvedValue({ projects: 0, environments: 0, apiKeys: 0 }),
      findProjectBySlug: vi.fn().mockResolvedValue(null),
      withTransaction: vi.fn(async (work: (client: PoolClient) => Promise<unknown>) => work(client)),
      createProject: vi.fn().mockResolvedValue(project),
      ensureProjectOwner: vi.fn().mockResolvedValue({}),
      provisionUsageCounter: vi.fn().mockResolvedValue(undefined),
    };
    const settings = { createDefault: vi.fn().mockResolvedValue({}) };
    const environmentRepository = { createEnvironment: vi.fn().mockResolvedValue(environment) };
    const apiKeyRepository = {
      createApiKey: vi.fn(async (input: any) => ({ ...input, id: 'key-id', status: 'active' })),
      publicShape: vi.fn((record: any) => { const shape = { ...record }; delete shape.secretHash; return shape; }),
    };
    const sdkConfigProvisioner = { provisionInitial: vi.fn().mockResolvedValue({ headId: 'h', revisionId: 'r', configHash: 'x' }) };
    const orgRepo = {
      getBillingEntitlements: vi.fn().mockResolvedValue({ subscription_status: 'active', feature_config: {} }),
    };
    const auditService = { audit: vi.fn().mockResolvedValue(undefined) };
    const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
    const service = new ProjectService(
      repository as any, logger as any, orgRepo as any, auditService as any,
      settings as any, apiKeyRepository as any, environmentRepository as any, {} as any,
      sdkConfigProvisioner as any,
    );

    const result = await service.createProject(project.orgId, meta.actorUserId, { name: project.name } as any, meta);

    expect(repository.ensureProjectOwner).toHaveBeenCalledWith(project.id, project.orgId, meta.actorUserId, client);
    expect(settings.createDefault).toHaveBeenCalledWith(project.id, project.orgId, client);

    // Exactly one Production environment is created (default + active).
    expect(environmentRepository.createEnvironment).toHaveBeenCalledTimes(1);
    expect(environmentRepository.createEnvironment).toHaveBeenCalledWith(
      expect.objectContaining({ slug: 'production', type: 'production', isDefault: true, isActive: true }),
      client,
    );

    // SDK config head + revision #1 provisioned in the same transaction.
    expect(sdkConfigProvisioner.provisionInitial).toHaveBeenCalledWith(
      client,
      expect.objectContaining({ environmentId: environment.id, environmentKey: 'production' }),
      meta.actorUserId,
    );

    // Exactly one initial Production API key, bound to the environment.
    expect(apiKeyRepository.createApiKey).toHaveBeenCalledTimes(1);
    expect(apiKeyRepository.createApiKey).toHaveBeenCalledWith(
      expect.objectContaining({ environmentId: environment.id }),
      client,
    );

    expect(repository.provisionUsageCounter).toHaveBeenCalledWith(project, client);
    expect(auditService.audit).toHaveBeenCalledWith(meta, expect.objectContaining({
      orgId: project.orgId,
      projectId: project.id,
      action: 'project.created',
    }));
    expect((client.query as any).mock.calls[0][0]).toContain('project_notification_preferences');

    // The result surfaces project, environment, and the one-time raw key.
    expect(result.project.id).toBe(project.id);
    expect(result.environment.id).toBe(environment.id);
    expect(result.apiKey).not.toHaveProperty('secretHash');
    expect(result.fullKey.startsWith(`${result.apiKey.publicKey}.`)).toBe(true);
  });
});

describe('canonical project API key runtime', () => {
  it.each([
    ['hourly', 'api_key_usage_hourly'],
    ['daily', 'api_key_usage_daily'],
    ['monthly', 'api_key_usage_monthly'],
  ] as const)('reads %s usage from the normalized %s source in ascending order', async (granularity, source) => {
    const query = vi.fn().mockResolvedValue({
      rows: [{
        bucket: new Date('2026-01-01T00:00:00Z'),
        request_count: '10', accepted_event_count: '9', error_event_count: '1',
        ingestion_failure_count: '0', accepted_bytes: '30', rate_limited_request_count: '2',
      }],
    });
    const repo = new ApiKeyRepository({ query } as unknown as Pool);
    const series = await repo.getApiKeyUsageSeries(
      'key-id', new Date('2026-01-01T00:00:00Z'), new Date('2026-01-02T00:00:00Z'), granularity,
    );
    const sql = query.mock.calls[0]![0] as string;
    expect(sql).toContain(source);
    expect(sql).toContain('api_key_id = $1');
    expect(sql).toContain('ORDER BY bucket ASC');
    expect(sql).not.toMatch(/latency|percentile/i);
    expect(series[0]).toMatchObject({ requests: 10, acceptedEvents: 9, errorEvents: 1, rateLimitedRequests: 2 });
  });

  it('accepts rotated credentials only while a rotation grace window is open', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const repo = new ApiKeyRepository({ query } as unknown as Pool);
    await repo.findActiveApiKeyCandidatesByPrefix('pv_live_public');
    const sql = query.mock.calls[0]![0] as string;
    expect(sql).toContain('project_api_key_rotations');
    expect(sql).toContain("r.state = 'grace_period'");
    expect(sql).not.toContain('grace_period_ends_at');
    expect(sql).not.toContain('k.is_active');
  });

  it('persists rotation workflow history instead of credential rotation columns', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [{
        id: 'rotation-1', organization_id: project.orgId, project_id: project.id,
        environment_id: '55555555-5555-4555-8555-555555555555',
        old_key_id: 'old', new_key_id: 'new', state: 'grace_period', reason: 'manual_rotation',
        initiated_by: meta.actorUserId, initiated_at: new Date(),
        grace_ends_at: new Date(Date.now() + 3_600_000), completed_at: null,
      }],
    });
    const repo = new ApiKeyRepository({ query } as unknown as Pool);
    const rotation = await repo.recordRotation({
      organizationId: project.orgId,
      projectId: project.id,
      environmentId: '55555555-5555-4555-8555-555555555555',
      oldKeyId: 'old',
      newKeyId: 'new',
      reason: 'manual_rotation',
      initiatedBy: meta.actorUserId,
      graceEndsAt: new Date(Date.now() + 3_600_000),
    });
    const sql = query.mock.calls[0]![0] as string;
    expect(sql).toContain('INSERT INTO project_api_key_rotations');
    expect(query.mock.calls[0]![1]).toContain('grace_period');
    expect(rotation.state).toBe('grace_period');
  });

  it('requires an active nondeleted tenant-matched environment during validation lookup', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const repo = new ApiKeyRepository({ query } as unknown as Pool);
    await repo.findActiveApiKeyCandidatesByPrefix('pv_live_public');
    const sql = query.mock.calls[0]![0] as string;
    expect(sql).toContain('p.org_id = k.organization_id');
    expect(sql).toContain('e.organization_id = k.organization_id');
    expect(sql).toContain('e.is_active = TRUE');
    expect(sql).toContain('e.deleted_at IS NULL');
    expect(sql).toContain("p.status = 'active'");
  });

  it('returns the raw key once while persisting only public key and hash', async () => {
    const apiKeys = {
      countActiveApiKeys: vi.fn().mockResolvedValue(0),
      createApiKey: vi.fn(async (input: any) => ({
        ...input, id: 'key-id', orgId: input.organizationId,
        isActive: true, status: 'active', allowedSdks: [], metadata: {},
      })),
    };
    const environments = { findEnvironment: vi.fn().mockResolvedValue({
      id: '55555555-5555-4555-8555-555555555555', slug: 'production', name: 'Production',
      isActive: true, deletedAt: null,
    }) };
    const service = new ApiKeyService(
      {} as any, { info: vi.fn() } as any, {} as any, {} as any,
      {} as any, apiKeys as any, environments as any, {} as any,
    );
    vi.spyOn(service, 'requireProjectAccess').mockResolvedValue(project as any);
    vi.spyOn(service, 'enforceProjectModuleLimit').mockResolvedValue({} as any);
    vi.spyOn(service, 'audit').mockResolvedValue(undefined);

    const result = await service.createApiKey(project.orgId, project.id, meta.actorUserId, {
      environmentId: environments.findEnvironment.mock.results[0]?.value?.id ?? '55555555-5555-4555-8555-555555555555',
      keyType: 'read_write',
    } as any, meta);
    const persisted = apiKeys.createApiKey.mock.calls[0]![0];
    expect(result.fullKey.startsWith(`${result.apiKey.publicKey}.`)).toBe(true);
    expect(result.apiKey).not.toHaveProperty('secretHash');
    expect(persisted).toHaveProperty('secretHash');
    expect(persisted).not.toHaveProperty('fullKey');
    expect(persisted.organizationId).toBe(project.orgId);
  });

  it('rejects key creation for an inactive environment before persistence', async () => {
    const apiKeys = { createApiKey: vi.fn(), countActiveApiKeys: vi.fn() };
    const environments = { findEnvironment: vi.fn().mockResolvedValue({ isActive: false, deletedAt: null }) };
    const service = new ApiKeyService(
      {} as any, { warn: vi.fn() } as any, {} as any, {} as any,
      {} as any, apiKeys as any, environments as any, {} as any,
    );
    vi.spyOn(service, 'requireProjectAccess').mockResolvedValue(project as any);
    vi.spyOn(service, 'enforceProjectModuleLimit').mockResolvedValue({} as any);
    await expect(service.createApiKey(project.orgId, project.id, meta.actorUserId, {
      environmentId: '55555555-5555-4555-8555-555555555555', keyType: 'read_write',
    } as any, meta)).rejects.toMatchObject({ code: 'ENVIRONMENT_NOT_FOUND' });
    expect(apiKeys.createApiKey).not.toHaveBeenCalled();
  });
});

describe('canonical project usage and AI access', () => {
  it('writes canonical usage bucket and total columns', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const repo = new UsageRepository({ query } as unknown as Pool);
    await repo.incrementHourly(project.id, project.orgId, new Date(), 2, 100, {}, {});
    await repo.incrementDaily(project.id, project.orgId, new Date(), 2, 100, {}, {});
    const sql = query.mock.calls.map(([statement]) => statement).join('\n');
    expect(sql).toContain('bucket, total_events, total_bytes');
    expect(sql).not.toMatch(/bucket_hour|bucket_date|event_count|event_bytes/);
  });

  it('requires active project membership and resolves an active default environment', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ id: project.id, name: project.name, slug: project.slug, environment: 'production' }] });
    const repo = new AIRepository({ query } as unknown as Pool);
    const result = await repo.getAccessibleProjects(project.orgId, meta.actorUserId, project.id);
    const sql = query.mock.calls[0]![0] as string;
    expect(sql).toContain('JOIN project_members pm');
    expect(sql).toContain("pm.status = 'active'");
    expect(sql).toContain('JOIN LATERAL');
    expect(sql).toContain('e.is_default DESC');
    expect(sql).toContain('e.is_active = TRUE');
    expect(sql).not.toContain('default_environment');
    expect(result[0]?.environment).toBe('production');
  });
});
