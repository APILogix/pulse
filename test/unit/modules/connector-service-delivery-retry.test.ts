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

const deliveryRow = {
  id: '33333333-3333-4333-8333-333333333333',
  organization_id: '44444444-4444-4444-8444-444444444444',
  connector_id: '55555555-5555-4555-8555-555555555555',
  route_id: null,
  notification_type: 'alert',
  severity: 'critical',
  payload: { title: 'CPU high' },
  payload_size_bytes: 20,
  status: 'retrying',
  attempts: 3,
  retry_count: 3,
  max_attempts: 4,
  next_retry_at: new Date('2026-07-14T10:01:00.000Z'),
  external_message_id: null,
  provider_response: null,
  response_status_code: 503,
  response_body: null,
  http_status: 503,
  error_code: 'provider_unavailable',
  error_message: 'Provider unavailable',
  error_details: { category: 'server_error' },
  delivery_latency_ms: 120,
  duration_ms: 120,
  correlation_id: 'corr-1',
  parent_delivery_id: null,
  sent_at: null,
  delivered_at: null,
  failed_at: new Date('2026-07-14T10:00:00.000Z'),
  created_at: new Date('2026-07-14T09:59:00.000Z'),
  updated_at: new Date('2026-07-14T10:00:00.000Z'),
} as const;

describe('ConnectorService delivery retry', () => {
  it('marks retryable delivery and wakes the delivery retry worker', async () => {
    const repository = {
      retryDelivery: vi.fn().mockResolvedValue(deliveryRow),
      insertAuditLog: vi.fn().mockResolvedValue(undefined),
    };
    const enqueueConnectorJob = vi.fn().mockResolvedValue('retry-job-1');
    const service = new ConnectorService({
      repository: repository as never,
      dispatcher: {} as never,
      logger: { info: vi.fn(), error: vi.fn(), child: vi.fn().mockReturnThis() } as never,
      enqueueConnectorJob,
    });

    const result = await service.retryDelivery(deliveryRow.organization_id, meta, deliveryRow.id);

    expect(result.id).toBe(deliveryRow.id);
    expect(result.maxAttempts).toBe(4);
    expect(result.retryCount).toBe(3);
    expect(result.nextRetryAt).toEqual(new Date('2026-07-14T10:01:00.000Z'));
    expect(repository.retryDelivery).toHaveBeenCalledWith(deliveryRow.organization_id, deliveryRow.id);
    expect(enqueueConnectorJob).toHaveBeenCalledWith(
      CONNECTOR_JOBS.deliveryRetry,
      {
        organizationId: deliveryRow.organization_id,
        deliveryId: deliveryRow.id,
        actorUserId: meta.actorUserId,
      },
      { retryLimit: 3, retryDelay: 60, retryBackoff: true, expireInSeconds: 3600 },
    );
    expect(repository.insertAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: deliveryRow.organization_id,
      connectorId: deliveryRow.connector_id,
      action: 'delivery.retry_requested',
      changesSummary: { deliveryId: deliveryRow.id, retryJobId: 'retry-job-1' },
    }));
  });
});
