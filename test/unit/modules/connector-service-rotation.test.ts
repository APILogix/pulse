import { beforeAll, describe, expect, it, vi } from 'vitest';
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

const connectorRow = {
  id: '33333333-3333-4333-8333-333333333333',
  organization_id: '44444444-4444-4444-8444-444444444444',
  project_id: null,
  name: 'eng-alerts',
  type: 'slack',
  status: 'active',
  description: null,
  encrypted_config: Buffer.from('encrypted'),
  config_schema_version: 1,
  display_config: {},
  supports_rich_formatting: true,
  supports_threading: true,
  supports_attachments: false,
  rate_limit_requests: 60,
  rate_limit_window_seconds: 60,
  max_retries: 3,
  retry_backoff_base_ms: 1000,
  retry_backoff_multiplier: '2.0',
  last_health_check_at: null,
  last_successful_delivery_at: null,
  consecutive_failures: 0,
  failure_threshold: 5,
  metadata: {},
  created_by: meta.actorUserId,
  updated_by: null,
  created_at: new Date('2026-07-14T10:00:00.000Z'),
  updated_at: new Date('2026-07-14T10:00:00.000Z'),
  deleted_at: null,
} as const;

describe('ConnectorService secret rotation', () => {
  it('stores rotated config through versioned credentials with the actor recorded', async () => {
    const repository = {
      findById: vi.fn()
        .mockResolvedValueOnce(connectorRow)
        .mockResolvedValueOnce(connectorRow),
      upsertCredential: vi.fn().mockResolvedValue(undefined),
      insertAuditLog: vi.fn().mockResolvedValue(undefined),
    };
    const service = new ConnectorService({
      repository: repository as never,
      dispatcher: {} as never,
      logger: { info: vi.fn(), error: vi.fn(), child: vi.fn().mockReturnThis() } as never,
    });

    const result = await service.rotateSecret(
      connectorRow.organization_id,
      meta,
      connectorRow.id,
      { config: { webhookUrl: 'https://hooks.slack.com/services/T000/B000/ROTATED' } },
    );

    expect(result.id).toBe(connectorRow.id);
    expect(repository.upsertCredential).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: connectorRow.organization_id,
      connectorId: connectorRow.id,
      credentialType: 'config',
      keyName: 'config',
      expiresAt: null,
      actorUserId: meta.actorUserId,
    }));
    const encryptedValue = repository.upsertCredential.mock.calls[0]![0].encryptedValue;
    expect(Buffer.isBuffer(encryptedValue)).toBe(true);
    expect(encryptedValue.toString('utf8')).not.toContain('ROTATED');
    expect(repository.insertAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'secret.rotated',
      actorId: meta.actorUserId,
      changesSummary: { versioned: true },
    }));
  });

  it('allows system rotation without fabricating a user id', async () => {
    const repository = {
      findById: vi.fn()
        .mockResolvedValueOnce(connectorRow)
        .mockResolvedValueOnce(connectorRow),
      upsertCredential: vi.fn().mockResolvedValue(undefined),
      insertAuditLog: vi.fn().mockResolvedValue(undefined),
    };
    const service = new ConnectorService({
      repository: repository as never,
      dispatcher: {} as never,
      logger: { info: vi.fn(), error: vi.fn(), child: vi.fn().mockReturnThis() } as never,
    });

    await service.rotateSecret(
      connectorRow.organization_id,
      { ...meta, actorUserId: null, actorUserAgent: 'connector-worker' },
      connectorRow.id,
      { config: { webhookUrl: 'https://hooks.slack.com/services/T000/B000/SYSTEM' } },
    );

    expect(repository.upsertCredential).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId: null,
    }));
    expect(repository.insertAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      actorId: null,
      actorType: 'system',
    }));
  });
});
