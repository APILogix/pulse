import { beforeAll, describe, expect, it, vi } from 'vitest';
import { CONNECTOR_JOBS } from '../../../src/modules/connectors/job.constants.js';
import type { RequestMeta } from '../../../src/modules/connectors/types.js';
import type { ConnectorService as ConnectorServiceType } from '../../../src/modules/connectors/service.js';

let ConnectorService: typeof ConnectorServiceType;

beforeAll(async () => {
  process.env.NODE_ENV = 'development';
  ({ ConnectorService } = await import('../../../src/modules/connectors/service.js'));
});

const meta: RequestMeta = {
  actorUserId: '11111111-1111-4111-8111-111111111111',
  actorIp: '127.0.0.1',
  actorUserAgent: 'vitest',
  requestId: '22222222-2222-4222-8222-222222222222',
};

function makeService(overrides: {
  findById?: ReturnType<typeof vi.fn>;
  consumeOAuthState?: ReturnType<typeof vi.fn>;
  upsertCredential?: ReturnType<typeof vi.fn>;
  setStatus?: ReturnType<typeof vi.fn>;
  insertAuditLog?: ReturnType<typeof vi.fn>;
  enqueueConnectorJob?: ReturnType<typeof vi.fn>;
} = {}) {
  const repository = {
    findById: overrides.findById ?? vi.fn().mockResolvedValue({ id: 'connector-1' }),
    consumeOAuthState: overrides.consumeOAuthState ?? vi.fn().mockResolvedValue({ id: 'state-1' }),
    upsertCredential: overrides.upsertCredential ?? vi.fn().mockResolvedValue(undefined),
    setStatus: overrides.setStatus ?? vi.fn().mockResolvedValue(undefined),
    insertAuditLog: overrides.insertAuditLog ?? vi.fn().mockResolvedValue(undefined),
  };
  const enqueueConnectorJob = overrides.enqueueConnectorJob ?? vi.fn().mockResolvedValue('job-1');

  const service = new ConnectorService({
    repository: repository as never,
    dispatcher: {} as never,
    logger: {
      info: vi.fn(),
      error: vi.fn(),
      child: vi.fn().mockReturnThis(),
    } as never,
    enqueueConnectorJob,
  });

  return { service, repository, enqueueConnectorJob };
}

describe('ConnectorService OAuth refresh', () => {
  it('enqueues a durable OAuth refresh job after validating connector ownership', async () => {
    const { service, repository, enqueueConnectorJob } = makeService();

    const result = await service.refreshOAuth('org-1', meta, 'connector-1');

    expect(result).toEqual({ queued: true, jobId: 'job-1' });
    expect(repository.findById).toHaveBeenCalledWith('org-1', 'connector-1');
    expect(enqueueConnectorJob).toHaveBeenCalledWith(
      CONNECTOR_JOBS.oauthRefresh,
      { organizationId: 'org-1', connectorId: 'connector-1' },
      { retryLimit: 3, retryDelay: 60, retryBackoff: true, expireInSeconds: 3600 },
    );
    expect(repository.insertAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: 'org-1',
      connectorId: 'connector-1',
      action: 'oauth.refresh_requested',
      actorId: meta.actorUserId,
      requestId: meta.requestId,
    }));
  });

  it('fails with a typed connector error when no queue dependency is configured', async () => {
    const repository = {
      findById: vi.fn().mockResolvedValue({ id: 'connector-1' }),
      insertAuditLog: vi.fn().mockResolvedValue(undefined),
    };
    const service = new ConnectorService({
      repository: repository as never,
      dispatcher: {} as never,
      logger: { info: vi.fn(), error: vi.fn(), child: vi.fn().mockReturnThis() } as never,
    });

    await expect(service.refreshOAuth('org-1', meta, 'connector-1')).rejects.toMatchObject({
      code: 'CONNECTOR_QUEUE_UNAVAILABLE',
      statusCode: 503,
    });
    expect(repository.insertAuditLog).not.toHaveBeenCalled();
  });
});

describe('ConnectorService OAuth callback', () => {
  it('stores OAuth token material encrypted, marks connector active, and schedules refresh', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-14T10:00:00.000Z'));
    try {
      const { service, repository, enqueueConnectorJob } = makeService();

      const result = await service.completeOAuth('org-1', meta, 'connector-1', {
        state: 'oauth-state-value-123456',
        code: 'auth-code',
        accessToken: 'access-secret',
        refreshToken: 'refresh-secret',
        tokenType: 'Bearer',
        scope: 'chat:write',
        expiresIn: 3600,
      });

      expect(result).toEqual({ connected: true, refreshQueued: true, refreshJobId: 'job-1' });
      expect(repository.consumeOAuthState).toHaveBeenCalledWith('org-1', 'connector-1', 'oauth-state-value-123456');
      expect(repository.upsertCredential).toHaveBeenCalledWith(expect.objectContaining({
        organizationId: 'org-1',
        connectorId: 'connector-1',
        credentialType: 'oauth',
        keyName: 'oauth',
        expiresAt: new Date('2026-07-14T11:00:00.000Z'),
        actorUserId: meta.actorUserId,
      }));
      const encryptedValue = repository.upsertCredential.mock.calls[0]![0].encryptedValue;
      expect(Buffer.isBuffer(encryptedValue)).toBe(true);
      expect(encryptedValue.toString('utf8')).not.toContain('access-secret');
      expect(encryptedValue.toString('utf8')).not.toContain('refresh-secret');
      expect(repository.setStatus).toHaveBeenCalledWith('org-1', 'connector-1', 'active');
      expect(enqueueConnectorJob).toHaveBeenCalledWith(
        CONNECTOR_JOBS.oauthRefresh,
        { organizationId: 'org-1', connectorId: 'connector-1' },
        {
          startAfter: new Date('2026-07-14T10:55:00.000Z'),
          retryLimit: 3,
          retryDelay: 60,
          retryBackoff: true,
          expireInSeconds: 3600,
        },
      );
      expect(repository.insertAuditLog).toHaveBeenCalledWith(expect.objectContaining({
        action: 'oauth.connected',
        changesSummary: expect.objectContaining({
          hasAccessToken: true,
          hasRefreshToken: true,
          expiresAt: '2026-07-14T11:00:00.000Z',
          refreshQueued: true,
        }),
      }));
      expect(JSON.stringify(repository.insertAuditLog.mock.calls)).not.toContain('access-secret');
      expect(JSON.stringify(repository.insertAuditLog.mock.calls)).not.toContain('refresh-secret');
    } finally {
      vi.useRealTimers();
    }
  });

  it('consumes state and validates callback when no token material is provided', async () => {
    const { service, repository, enqueueConnectorJob } = makeService();

    const result = await service.completeOAuth('org-1', meta, 'connector-1', {
      state: 'oauth-state-value-123456',
      code: 'auth-code',
    });

    expect(result).toEqual({ connected: false, refreshQueued: false, refreshJobId: null });
    expect(repository.upsertCredential).not.toHaveBeenCalled();
    expect(repository.setStatus).not.toHaveBeenCalled();
    expect(enqueueConnectorJob).not.toHaveBeenCalled();
    expect(repository.insertAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'oauth.callback_validated',
    }));
  });
});

describe('ConnectorService OAuth disconnect', () => {
  it('revokes stored OAuth credential material and marks connector revoked', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-14T12:00:00.000Z'));
    try {
      const { service, repository } = makeService();

      const result = await service.disconnectOAuth('org-1', meta, 'connector-1');

      expect(result).toEqual({ disconnected: true });
      expect(repository.findById).toHaveBeenCalledWith('org-1', 'connector-1');
      expect(repository.upsertCredential).toHaveBeenCalledWith(expect.objectContaining({
        organizationId: 'org-1',
        connectorId: 'connector-1',
        credentialType: 'oauth_revoked',
        keyName: 'oauth',
        expiresAt: new Date('2026-07-14T12:00:00.000Z'),
        actorUserId: meta.actorUserId,
      }));
      const encryptedValue = repository.upsertCredential.mock.calls[0]![0].encryptedValue;
      expect(Buffer.isBuffer(encryptedValue)).toBe(true);
      expect(encryptedValue.toString('utf8')).not.toContain('revokedAt');
      expect(repository.setStatus).toHaveBeenCalledWith('org-1', 'connector-1', 'revoked');
      expect(repository.insertAuditLog).toHaveBeenCalledWith(expect.objectContaining({
        action: 'oauth.disconnected',
        changesSummary: { revokedAt: '2026-07-14T12:00:00.000Z' },
      }));
    } finally {
      vi.useRealTimers();
    }
  });
});
