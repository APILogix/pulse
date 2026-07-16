import { describe, expect, it, vi, beforeAll } from 'vitest';
import { CONNECTOR_JOBS } from '../../../src/modules/connectors/job.constants.js';

let AlertBatchProcessor: typeof import('../../../src/modules/alerting/batch-processor.js').AlertBatchProcessor;

beforeAll(async () => {
  process.env.NODE_ENV = 'development';
  ({ AlertBatchProcessor } = await import('../../../src/modules/alerting/batch-processor.js'));
});

describe('AlertBatchProcessor connector delivery handoff', () => {
  it('BUG-03: enqueues connector-send jobs and records queued alert delivery attempts', async () => {
    const event = {
      id: '33333333-3333-4333-8333-333333333333',
      organization_id: '44444444-4444-4444-8444-444444444444',
      rule_id: '55555555-5555-4555-8555-555555555555',
      severity: 'critical',
      source: 'monitoring',
      labels: { env: 'prod' },
      payload: { title: 'CPU high', message: 'CPU above threshold' },
      fingerprint: 'fp-1',
    };
    const alertRepo = {
      getBatchWithEvents: vi.fn().mockResolvedValue({
        batch: { id: 'batch-1' },
        events: [event],
      }),
      listRoutingRules: vi.fn().mockResolvedValue([{
        id: '66666666-6666-4666-8666-666666666666',
        organization_id: event.organization_id,
        name: 'critical',
        description: null,
        priority: 100,
        conditions: { severity: ['critical'] },
        target_connector_ids: ['77777777-7777-4777-8777-777777777777'],
        target_route_ids: [],
        fallback_connector_ids: [],
        template_id: null,
        is_active: true,
        created_at: new Date(),
        updated_at: new Date(),
        deleted_at: null,
      }]),
      bulkUpdateEventStatus: vi.fn().mockResolvedValue(undefined),
      bulkInsertDeliveryAttempts: vi.fn().mockResolvedValue(undefined),
      completeBatch: vi.fn().mockResolvedValue(undefined),
    };
    const connectorRepo = {
      listRoutesByIds: vi.fn().mockResolvedValue([]),
      getByIds: vi.fn().mockResolvedValue([{ id: '77777777-7777-4777-8777-777777777777' }]),
    };
    const enqueueConnectorJob = vi.fn().mockResolvedValue('connector-job-1');
    const logger = {
      child: vi.fn().mockReturnThis(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    const processor = new AlertBatchProcessor(
      alertRepo as never,
      connectorRepo as never,
      enqueueConnectorJob,
      logger as never,
    );

    const result = await processor.processBatch({
      batchId: '88888888-8888-4888-8888-888888888888',
      organizationId: event.organization_id,
    });

    expect(result.status).toBe('completed');
    expect(result.success).toBe(1);
    expect(enqueueConnectorJob).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        organizationId: event.organization_id,
        connectorId: '77777777-7777-4777-8777-777777777777',
        routeId: null,
        payload: expect.objectContaining({
          notificationType: 'alert',
          severity: 'critical',
          title: 'CPU high',
          body: 'CPU above threshold',
          correlationId: event.id,
          dedupKey: event.id,
        }),
      }),
      expect.objectContaining({ retryLimit: 0, expireInSeconds: 45 }),
    );
    expect(alertRepo.bulkUpdateEventStatus).toHaveBeenCalledWith(
      event.organization_id,
      [{ id: event.id, status: 'firing' }],
    );
    expect(alertRepo.bulkInsertDeliveryAttempts).toHaveBeenCalledWith([
      expect.objectContaining({
        organizationId: event.organization_id,
        eventId: event.id,
        connectorId: '77777777-7777-4777-8777-777777777777',
        status: 'queued',
        externalMessageId: 'connector-job-1',
      }),
    ]);
  });

  it('resolves alert routing rule target routes into matching connector-send jobs', async () => {
    const event = {
      id: '99999999-9999-4999-8999-999999999999',
      organization_id: '44444444-4444-4444-8444-444444444444',
      rule_id: null,
      severity: 'critical',
      source: 'monitoring',
      labels: { env: 'production', projectId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
      payload: {
        title: 'Error budget burn',
        message: 'Burn rate is high',
        eventType: 'incident.created',
      },
      fingerprint: 'fp-route',
    };
    const routeId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const connectorId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const alertRepo = {
      getBatchWithEvents: vi.fn().mockResolvedValue({ batch: { id: 'batch-2' }, events: [event] }),
      listRoutingRules: vi.fn().mockResolvedValue([{
        id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        organization_id: event.organization_id,
        name: 'route-target',
        description: null,
        priority: 100,
        conditions: { severity: ['critical'] },
        target_connector_ids: [],
        target_route_ids: [routeId],
        fallback_connector_ids: [],
        template_id: null,
        is_active: true,
        created_at: new Date(),
        updated_at: new Date(),
        deleted_at: null,
      }]),
      bulkUpdateEventStatus: vi.fn().mockResolvedValue(undefined),
      bulkInsertDeliveryAttempts: vi.fn().mockResolvedValue(undefined),
      completeBatch: vi.fn().mockResolvedValue(undefined),
    };
    const connectorRepo = {
      listRoutesByIds: vi.fn().mockResolvedValue([{
        id: routeId,
        connector_id: connectorId,
        project_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        environment: 'production',
        event_type: 'incident.created',
        severity: 'critical',
        enabled: true,
        created_at: new Date(),
      }]),
      getByIds: vi.fn().mockResolvedValue([{ id: connectorId }]),
    };
    const enqueueConnectorJob = vi.fn().mockResolvedValue('connector-job-route');
    const logger = { child: vi.fn().mockReturnThis(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const processor = new AlertBatchProcessor(
      alertRepo as never,
      connectorRepo as never,
      enqueueConnectorJob,
      logger as never,
    );

    const result = await processor.processBatch({
      batchId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      organizationId: event.organization_id,
    });

    expect(result.status).toBe('completed');
    expect(connectorRepo.listRoutesByIds).toHaveBeenCalledWith(event.organization_id, [routeId]);
    expect(connectorRepo.getByIds).toHaveBeenCalledWith([connectorId]);
    expect(enqueueConnectorJob).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        organizationId: event.organization_id,
        connectorId,
        routeId,
        payload: expect.objectContaining({
          title: 'Error budget burn',
          body: 'Burn rate is high',
          dedupKey: event.id,
        }),
      }),
      expect.objectContaining({ retryLimit: 0, expireInSeconds: 45 }),
    );
    expect(alertRepo.bulkInsertDeliveryAttempts).toHaveBeenCalledWith([
      expect.objectContaining({
        connectorId,
        routeId,
        status: 'queued',
        externalMessageId: 'connector-job-route',
      }),
    ]);
  });
});
