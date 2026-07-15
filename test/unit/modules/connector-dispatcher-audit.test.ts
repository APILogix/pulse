import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { ConnectorConfigRow, DeliveryRow, NotificationPayload } from '../../../src/modules/connectors/types.js';
import type { NotificationDispatcher as NotificationDispatcherType } from '../../../src/modules/connectors/delivery/delivery.service.js';

let NotificationDispatcher: typeof NotificationDispatcherType;

beforeAll(async () => {
  process.env.NODE_ENV = 'development';
  ({ NotificationDispatcher } = await import('../../../src/modules/connectors/delivery/delivery.service.js'));
});

const connectorRow = {
  id: '33333333-3333-4333-8333-333333333333',
  organization_id: '44444444-4444-4444-8444-444444444444',
  project_id: null,
  name: 'webhook',
  type: 'webhook',
  status: 'active',
  description: null,
  encrypted_config: Buffer.from('encrypted'),
  config_schema_version: 1,
  display_config: {},
  supports_rich_formatting: false,
  supports_threading: false,
  supports_attachments: false,
  rate_limit_requests: 100,
  rate_limit_window_seconds: 60,
  max_retries: 2,
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
} as ConnectorConfigRow;

const deliveryRow = {
  id: '55555555-5555-4555-8555-555555555555',
  organization_id: connectorRow.organization_id,
  connector_id: connectorRow.id,
  route_id: null,
  notification_type: 'alert',
  severity: 'critical',
  payload: {},
  payload_size_bytes: 2,
  status: 'pending',
  attempts: 0,
  retry_count: 0,
  max_attempts: 3,
  next_retry_at: null,
  external_message_id: null,
  provider_response: null,
  response_status_code: null,
  response_body: null,
  http_status: null,
  error_code: null,
  error_message: null,
  error_details: null,
  delivery_latency_ms: null,
  duration_ms: null,
  correlation_id: 'corr-1',
  parent_delivery_id: null,
  sent_at: null,
  delivered_at: null,
  failed_at: null,
  created_at: new Date('2026-07-14T10:00:00.000Z'),
  updated_at: new Date('2026-07-14T10:00:00.000Z'),
} as DeliveryRow;

const payload: NotificationPayload = {
  notificationType: 'alert',
  severity: 'critical',
  title: 'CPU high',
  body: 'CPU exceeded threshold',
  correlationId: 'corr-1',
};

function makeRepository() {
  return {
    insertDelivery: vi.fn().mockResolvedValue(deliveryRow),
    markDeliverySent: vi.fn().mockResolvedValue(undefined),
    markDeliveryRetrying: vi.fn().mockResolvedValue(undefined),
    markDeliveryFailed: vi.fn().mockResolvedValue(undefined),
    insertDeadLetter: vi.fn().mockResolvedValue(undefined),
    recordSuccess: vi.fn().mockResolvedValue(undefined),
    recordFailure: vi.fn().mockResolvedValue(undefined),
    insertAuditLog: vi.fn().mockResolvedValue(undefined),
  };
}

function makeDispatcher(repository: ReturnType<typeof makeRepository>, result: Record<string, unknown>) {
  const logger = {
    child: vi.fn().mockReturnThis(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  const dispatcher = new NotificationDispatcher(repository as never, logger as never);
  vi.spyOn(dispatcher, 'instantiate').mockReturnValue({
    send: vi.fn().mockResolvedValue(result),
  } as never);
  return dispatcher;
}

describe('NotificationDispatcher delivery audit', () => {
  it('audits successful deliveries', async () => {
    const repository = makeRepository();
    const dispatcher = makeDispatcher(repository, {
      success: true,
      statusCode: 202,
      externalMessageId: 'provider-1',
      latencyMs: 37,
    });

    await dispatcher.dispatch(connectorRow, payload);

    expect(repository.insertAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: connectorRow.organization_id,
      connectorId: connectorRow.id,
      action: 'delivery.sent',
      changesSummary: expect.objectContaining({
        deliveryId: deliveryRow.id,
        statusCode: 202,
        externalMessageId: 'provider-1',
      }),
    }));
  });

  it('audits retry scheduling for retryable failures', async () => {
    const repository = makeRepository();
    const dispatcher = makeDispatcher(repository, {
      success: false,
      errorMessage: 'rate limited',
      failureCategory: 'rate_limit',
      retryable: true,
      latencyMs: 12,
    });

    await dispatcher.dispatch(connectorRow, payload);

    expect(repository.markDeliveryRetrying).toHaveBeenCalled();
    expect(repository.insertAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'delivery.retry_scheduled',
      changesSummary: expect.objectContaining({
        deliveryId: deliveryRow.id,
        category: 'rate_limit',
        attemptsSoFar: 1,
      }),
    }));
  });

  it('audits terminal failures before dead-lettering', async () => {
    const repository = makeRepository();
    const dispatcher = makeDispatcher(repository, {
      success: false,
      errorMessage: 'invalid credentials',
      failureCategory: 'auth_error',
      retryable: false,
      latencyMs: 8,
    });

    await dispatcher.dispatch(connectorRow, payload);

    expect(repository.markDeliveryFailed).toHaveBeenCalledWith(
      deliveryRow.id,
      'invalid credentials',
      { category: 'auth_error' },
    );
    expect(repository.insertAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'delivery.failed',
      changesSummary: expect.objectContaining({
        deliveryId: deliveryRow.id,
        category: 'auth_error',
        retryable: false,
      }),
    }));
    expect(repository.insertDeadLetter).toHaveBeenCalled();
  });
});
