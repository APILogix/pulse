import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { RequestMeta } from '../../../src/modules/connectors/types.js';
import type { ConnectorService as ConnectorServiceType } from '../../../src/modules/connectors/service.js';
import type * as SecretService from '../../../src/modules/connectors/secrets/secret.service.js';

let ConnectorService: typeof ConnectorServiceType;
let decryptConfig: typeof SecretService.decryptConfig;
let encryptConfig: typeof SecretService.encryptConfig;

beforeAll(async () => {
  process.env.NODE_ENV = 'development';
  ({ ConnectorService } = await import('../../../src/modules/connectors/service.js'));
  ({ decryptConfig, encryptConfig } = await import('../../../src/modules/connectors/secrets/secret.service.js'));
});

const meta: RequestMeta = {
  actorUserId: '11111111-1111-4111-8111-111111111111',
  actorIp: '127.0.0.1',
  actorUserAgent: 'vitest',
  requestId: '22222222-2222-4222-8222-222222222222',
};

function makeBaseRow() {
  return {
  id: '33333333-3333-4333-8333-333333333333',
  organization_id: '44444444-4444-4444-8444-444444444444',
  project_id: null,
  name: 'eng-slack',
  type: 'slack',
  status: 'active',
  description: null,
  encrypted_config: encryptConfig({
    webhookUrl: 'https://hooks.slack.com/services/T000/B000/EXISTING',
    defaultChannel: '#alerts',
  }),
  config_schema_version: 1,
  display_config: {},
  supports_rich_formatting: true,
  supports_threading: true,
  supports_attachments: true,
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
}

describe('ConnectorService update config', () => {
  it('merges partial config patches with existing decrypted config before encrypting', async () => {
    const baseRow = makeBaseRow();
    const updatedRow = { ...baseRow, display_config: { channel: '#incidents' } };
    const repository = {
      findById: vi.fn().mockResolvedValue(baseRow),
      update: vi.fn().mockResolvedValue(updatedRow),
      insertAuditLog: vi.fn().mockResolvedValue(undefined),
    };
    const service = new ConnectorService({
      repository: repository as never,
      dispatcher: {} as never,
      logger: { info: vi.fn(), error: vi.fn(), child: vi.fn().mockReturnThis() } as never,
      emitEvent: vi.fn().mockResolvedValue(undefined),
    });

    await service.updateConnector(baseRow.organization_id, meta, baseRow.id, {
      config: { defaultChannel: '#incidents' },
      displayConfig: { channel: '#incidents' },
    });

    expect(repository.update).toHaveBeenCalledWith(
      baseRow.organization_id,
      baseRow.id,
      expect.objectContaining({
        displayConfig: { channel: '#incidents' },
        encryptedConfig: expect.any(Buffer),
      }),
    );
    const encryptedConfig = repository.update.mock.calls[0]![2].encryptedConfig;
    const decrypted = decryptConfig(encryptedConfig);
    expect(decrypted).toMatchObject({
      webhookUrl: 'https://hooks.slack.com/services/T000/B000/EXISTING',
      defaultChannel: '#incidents',
    });
    expect(encryptedConfig.toString('utf8')).not.toContain('EXISTING');
  });
});
