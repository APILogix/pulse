import { describe, expect, it, vi } from 'vitest';
import type { Pool, PoolClient } from 'pg';

vi.mock('../../../src/config/database.js', () => ({
  pool: { query: vi.fn(), connect: vi.fn() },
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
  it('provisions environment, usage, activity, and audit through the transaction client', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 1 });
    const repo = new ProjectRepository({} as Pool);
    await repo.provisionRuntimeDefaults(project as any, meta.actorUserId, meta, { query } as any);
    const sql = query.mock.calls.map(([statement]) => statement).join('\n');
    expect(sql).toContain('project_environments');
    expect(sql).toContain("'production'");
    expect(sql).toContain('project_usage_current');
    expect(sql).toContain('project_activity');
    expect(sql).toContain('project_audit_logs');
    expect(sql).not.toContain('project_alert_thresholds');
    expect(sql).not.toContain('project_alert_channels');
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

  it('invokes every required application seed inside createProject transaction', async () => {
    const client = { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 1 }) } as unknown as PoolClient;
    const repository = {
      findOrganizationMembership: vi.fn().mockResolvedValue({ role: 'owner', isActive: true }),
      getProjectModuleUsageCounts: vi.fn().mockResolvedValue({ projects: 0, environments: 0, apiKeys: 0 }),
      findProjectBySlug: vi.fn().mockResolvedValue(null),
      withTransaction: vi.fn(async (work: (client: PoolClient) => Promise<unknown>) => work(client)),
      createProject: vi.fn().mockResolvedValue(project),
      ensureProjectOwner: vi.fn().mockResolvedValue({}),
      provisionRuntimeDefaults: vi.fn().mockResolvedValue(undefined),
    };
    const settings = { createDefault: vi.fn().mockResolvedValue({}) };
    const orgRepo = {
      getBillingEntitlements: vi.fn().mockResolvedValue({ subscription_status: 'active', feature_config: {} }),
      createAuditLog: vi.fn().mockResolvedValue(undefined),
    };
    const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
    const service = new ProjectService(
      repository as any, logger as any, orgRepo as any, settings as any,
      {} as any, {} as any, {} as any, {} as any,
    );

    await service.createProject(project.orgId, meta.actorUserId, { name: project.name } as any, meta);
    expect(repository.ensureProjectOwner).toHaveBeenCalledWith(project.id, project.orgId, meta.actorUserId, client);
    expect(settings.createDefault).toHaveBeenCalledWith(project.id, project.orgId, client);
    expect(repository.provisionRuntimeDefaults).toHaveBeenCalledWith(project, meta.actorUserId, meta, client);
    expect((client.query as any).mock.calls[0][0]).toContain('project_notification_preferences');
  });
});

describe('canonical project API key runtime', () => {
  it('reads usage only from canonical daily and minute rollups', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ total_requests: '10', total_success: '8', total_errors: '2', bytes_ingested: '30', events_ingested: '9' }] })
      .mockResolvedValueOnce({ rows: [{ d: '2026-01-01', c: '10' }] });
    const repo = new ApiKeyRepository({ query } as unknown as Pool);
    const result = await repo.getApiKeyUsageSummary('key-id');
    const sql = query.mock.calls.map(([statement]) => statement).join('\n');
    expect(sql).toContain('api_key_usage_daily');
    expect(sql).toContain('api_key_usage_minute');
    expect(sql).not.toContain('project_api_key_usage');
    expect(sql).toContain('api_key_id = $1');
    expect(sql).toMatch(/SELECT requests, errors, bytes_ingested, events/);
    expect(sql).not.toMatch(/api_key_usage_[\s\S]*total_events/);
    expect(result.totalSuccess).toBe(8);
  });

  it('requires an active nondeleted tenant-matched environment during validation lookup', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const repo = new ApiKeyRepository({ query } as unknown as Pool);
    await repo.findActiveApiKeyCandidatesByPrefix('pulsiv_production_public');
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
    const service = new ApiKeyService({} as any, { info: vi.fn() } as any, {} as any, {} as any, apiKeys as any, environments as any, {} as any, {} as any);
    vi.spyOn(service, 'requireProjectAccess').mockResolvedValue(project as any);
    vi.spyOn(service, 'enforceProjectModuleLimit').mockResolvedValue({} as any);
    vi.spyOn(service, 'audit').mockResolvedValue(undefined);
    vi.spyOn(service, 'warmApiKeyCache').mockImplementation(() => undefined);

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
    const service = new ApiKeyService({} as any, { warn: vi.fn() } as any, {} as any, {} as any, apiKeys as any, environments as any, {} as any, {} as any);
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
