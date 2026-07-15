import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { ConnectorService as ConnectorServiceType } from '../../../src/modules/connectors/service.js';

let ConnectorService: typeof ConnectorServiceType;

beforeAll(async () => {
  process.env.NODE_ENV = 'development';
  ({ ConnectorService } = await import('../../../src/modules/connectors/service.js'));
});

const connectorRow = {
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
  created_by: null,
  updated_by: null,
  created_at: new Date('2026-07-14T10:00:00.000Z'),
  updated_at: new Date('2026-07-14T10:00:00.000Z'),
  deleted_at: null,
} as const;

describe('ConnectorService queued connection tests', () => {
  it('persists health and connector_test_runs and activates pending connectors after success', async () => {
    const repository = {
      insertHealthCheck: vi.fn().mockResolvedValue(undefined),
      insertTestRun: vi.fn().mockResolvedValue(undefined),
      setStatus: vi.fn().mockResolvedValue(undefined),
    };
    const dispatcher = {
      instantiate: vi.fn().mockReturnValue({
        testConnection: vi.fn().mockResolvedValue({
          success: true,
          message: 'ok',
          latencyMs: 42,
          details: { statusCode: 200 },
        }),
      }),
    };
    const service = new ConnectorService({
      repository: repository as never,
      dispatcher: dispatcher as never,
      logger: { info: vi.fn(), error: vi.fn(), child: vi.fn().mockReturnThis() } as never,
    });

    const result = await service.runConnectionTest(connectorRow, null);

    expect(result.success).toBe(true);
    expect(dispatcher.instantiate).toHaveBeenCalledWith(connectorRow);
    expect(repository.insertHealthCheck).toHaveBeenCalledWith(
      connectorRow.id,
      'healthy',
      42,
      null,
      { statusCode: 200 },
    );
    expect(repository.insertTestRun).toHaveBeenCalledWith({
      connectorId: connectorRow.id,
      triggeredBy: null,
      status: 'success',
      response: { message: 'ok', details: { statusCode: 200 } },
      durationMs: 42,
    });
    expect(repository.setStatus).toHaveBeenCalledWith(connectorRow.organization_id, connectorRow.id, 'active');
  });

  it('persists failed health and test run when provider test throws', async () => {
    const repository = {
      insertHealthCheck: vi.fn().mockResolvedValue(undefined),
      insertTestRun: vi.fn().mockResolvedValue(undefined),
      setStatus: vi.fn().mockResolvedValue(undefined),
    };
    const dispatcher = {
      instantiate: vi.fn().mockReturnValue({
        testConnection: vi.fn().mockRejectedValue(new Error('provider unavailable')),
      }),
    };
    const service = new ConnectorService({
      repository: repository as never,
      dispatcher: dispatcher as never,
      logger: { info: vi.fn(), error: vi.fn(), child: vi.fn().mockReturnThis() } as never,
    });

    const result = await service.runConnectionTest(connectorRow, null);

    expect(result).toMatchObject({
      success: false,
      message: 'provider unavailable',
      details: { errorType: 'Error' },
    });
    expect(repository.insertHealthCheck).toHaveBeenCalledWith(
      connectorRow.id,
      'unhealthy',
      expect.any(Number),
      'provider unavailable',
      { errorType: 'Error' },
    );
    expect(repository.insertTestRun).toHaveBeenCalledWith({
      connectorId: connectorRow.id,
      triggeredBy: null,
      status: 'failed',
      response: { message: 'provider unavailable', details: { errorType: 'Error' } },
      durationMs: expect.any(Number),
    });
    expect(repository.setStatus).not.toHaveBeenCalled();
  });
});
