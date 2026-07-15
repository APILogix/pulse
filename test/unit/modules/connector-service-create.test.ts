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

const createdRow = {
  id: '33333333-3333-4333-8333-333333333333',
  organization_id: '44444444-4444-4444-8444-444444444444',
  project_id: null,
  name: 'incident-webhook',
  type: 'webhook',
  status: 'pending_setup',
  description: null,
  encrypted_config: Buffer.from('encrypted'),
  config_schema_version: 1,
  display_config: {},
  supports_rich_formatting: false,
  supports_threading: false,
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

describe('ConnectorService create lifecycle', () => {
  it('stores encrypted config and queues connector-test for activation validation', async () => {
    const repository = {
      create: vi.fn().mockResolvedValue(createdRow),
      insertAuditLog: vi.fn().mockResolvedValue(undefined),
    };
    const enqueueConnectorJob = vi.fn().mockResolvedValue('test-job-1');
    const service = new ConnectorService({
      repository: repository as never,
      dispatcher: {} as never,
      logger: { info: vi.fn(), error: vi.fn(), child: vi.fn().mockReturnThis() } as never,
      emitEvent: vi.fn().mockResolvedValue(undefined),
      enqueueConnectorJob,
    });

    const result = await service.createConnector(createdRow.organization_id, meta, {
      name: 'incident-webhook',
      type: 'webhook',
      config: {
        url: 'https://example.com/alerts',
        signingSecret: 'super-secret-signing-key',
      },
    });

    expect(result.status).toBe('pending_setup');
    expect(repository.create).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: createdRow.organization_id,
      name: 'incident-webhook',
      type: 'webhook',
      createdBy: meta.actorUserId,
    }));
    const encryptedConfig = repository.create.mock.calls[0]![0].encryptedConfig;
    expect(Buffer.isBuffer(encryptedConfig)).toBe(true);
    expect(encryptedConfig.toString('utf8')).not.toContain('super-secret-signing-key');
    expect(enqueueConnectorJob).toHaveBeenCalledWith(
      CONNECTOR_JOBS.test,
      { organizationId: createdRow.organization_id, connectorId: createdRow.id },
      { retryLimit: 2, retryDelay: 60, retryBackoff: true, expireInSeconds: 1800 },
    );
    expect(repository.insertAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'created',
      connectorId: createdRow.id,
    }));
    expect(repository.insertAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'test.queued',
      connectorId: createdRow.id,
      changesSummary: { jobId: 'test-job-1' },
    }));
  });
});
