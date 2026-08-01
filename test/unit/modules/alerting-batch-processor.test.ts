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
        batch: { id: 'batch-1', status: 'processing' },
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
      getRuleActionsByRuleIds: vi.fn().mockResolvedValue([]),
      listEscalationStepsByPolicyIds: vi.fn().mockResolvedValue([]),
      getThrottleStates: vi.fn().mockResolvedValue([]),
      recordThrottleNotifications: vi.fn().mockResolvedValue(undefined),
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
      debug: vi.fn(),
    };

    const processor = new AlertBatchProcessor(
      alertRepo as never,
      connectorRepo as never,
      enqueueConnectorJob,
      logger as never,
      undefined,
      async (events) => ({
        eligible: events,
        suppressedUpdates: [],
        suppressedAttempts: [],
      }),
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
          dedupKey: event.fingerprint,
        }),
      }),
      expect.objectContaining({ retryLimit: 0, expireInSeconds: 45 }),
    );
    expect(alertRepo.bulkUpdateEventStatus).toHaveBeenCalledWith(
      event.organization_id,
      [expect.objectContaining({ id: event.id, status: 'firing' })],
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
      getBatchWithEvents: vi.fn().mockResolvedValue({ batch: { id: 'batch-2', status: 'processing' }, events: [event] }),
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
      getRuleActionsByRuleIds: vi.fn().mockResolvedValue([]),
      listEscalationStepsByPolicyIds: vi.fn().mockResolvedValue([]),
      getThrottleStates: vi.fn().mockResolvedValue([]),
      recordThrottleNotifications: vi.fn().mockResolvedValue(undefined),
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
    const logger = { child: vi.fn().mockReturnThis(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

    const processor = new AlertBatchProcessor(
      alertRepo as never,
      connectorRepo as never,
      enqueueConnectorJob,
      logger as never,
      undefined,
      async (events) => ({
        eligible: events,
        suppressedUpdates: [],
        suppressedAttempts: [],
      }),
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
          dedupKey: event.fingerprint,
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

describe('AlertBatchProcessor project subscription gating', () => {
  const organizationId = '44444444-4444-4444-8444-444444444444';
  const projectId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const allowedConnectorId = '77777777-7777-4777-8777-777777777777';
  const blockedConnectorId = '88888888-8888-4888-8888-888888888888';

  function dependencies(event: Record<string, unknown>, actions: Record<string, unknown>[] = []) {
    const alertRepo = {
      getBatchWithEvents: vi.fn().mockResolvedValue({ batch: { id: 'batch-project', status: 'processing' }, events: [event] }),
      listRoutingRules: vi.fn().mockResolvedValue([{
        id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        organization_id: organizationId,
        name: 'project-route',
        description: null,
        priority: 100,
        conditions: { severity: ['critical'] },
        target_connector_ids: [blockedConnectorId, allowedConnectorId],
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
      getRuleActionsByRuleIds: vi.fn().mockResolvedValue(actions),
      listEscalationStepsByPolicyIds: vi.fn().mockResolvedValue([]),
      getThrottleStates: vi.fn().mockResolvedValue([]),
      recordThrottleNotifications: vi.fn().mockResolvedValue(undefined),
    };
    const connectorRepo = {
      listRoutesByIds: vi.fn().mockResolvedValue([]),
      getByIds: vi.fn().mockResolvedValue([
        { id: blockedConnectorId },
        { id: allowedConnectorId },
      ]),
    };
    return { alertRepo, connectorRepo };
  }

  function projectEvent() {
    return {
      id: '33333333-3333-4333-8333-333333333333',
      organization_id: organizationId,
      project_id: projectId,
      rule_id: '55555555-5555-4555-8555-555555555555',
      status: 'pending',
      severity: 'critical',
      source: 'monitoring',
      labels: { category: 'performance' },
      payload: { title: 'Security event', message: 'Investigate', category: 'security' },
      fingerprint: 'fp-project',
    };
  }

  const logger = { child: vi.fn().mockReturnThis(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const authorize = async (events: never[]) => ({ eligible: events, suppressedUpdates: [], suppressedAttempts: [] });

  function resolverWithChannelTargets(channelTargets: Array<{
    userId: string;
    channelId: string;
    channelConnectorId: string;
    subscriptionConnectorId: string;
  }>) {
    return {
      resolveByProjectId: vi.fn().mockResolvedValue({
        projectId,
        organizationId,
        environmentId: null,
        apiKeyId: null,
        subscriptions: [allowedConnectorId, blockedConnectorId].map((connectorId) => ({
          subscriptionId: `subscription-${connectorId}`,
          connectorId,
          enabled: true,
          alertCategories: ['security'],
          severityThreshold: 'warning',
          memberIds: [],
          channelOverrides: {},
        })),
        members: [{
          userId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          role: 'developer',
          email: 'member@example.com',
        }],
      }),
      resolveImmediateDeliveryTargets: vi.fn().mockResolvedValue(channelTargets),
    };
  }

  it('fails closed for project events when no subscription resolver is configured', async () => {
    const event = projectEvent();
    const { alertRepo, connectorRepo } = dependencies(event);
    const enqueue = vi.fn();
    const processor = new AlertBatchProcessor(
      alertRepo as never,
      connectorRepo as never,
      enqueue,
      logger as never,
      undefined,
      authorize as never,
    );

    const result = await processor.processBatch({ batchId: 'batch-project', organizationId });

    expect(result.skipped).toBe(1);
    expect(result.success).toBe(0);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('requires category, severity, active-member intersection and filters target connector IDs', async () => {
    const event = projectEvent();
    const actionId = '99999999-9999-4999-8999-999999999999';
    const action = {
      id: actionId,
      rule_id: event.rule_id,
      action_type: 'notify',
      connector_id: allowedConnectorId,
      route_id: null,
      escalation_policy_id: null,
      throttle_duration_seconds: 0,
      max_notifications_per_hour: null,
    };
    const { alertRepo, connectorRepo } = dependencies(event, [action]);
    const enqueue = vi.fn().mockResolvedValue('project-job');
    const resolver = {
      resolveByProjectId: vi.fn().mockResolvedValue({
        projectId,
        organizationId,
        environmentId: null,
        apiKeyId: null,
        subscriptions: [{
          subscriptionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          connectorId: allowedConnectorId,
          enabled: true,
          alertCategories: ['security'],
          severityThreshold: 'error',
          memberIds: ['cccccccc-cccc-4ccc-8ccc-cccccccccccc'],
          channelOverrides: {},
        }],
        members: [{
          userId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          role: 'developer',
          email: 'member@example.com',
        }],
      }),
    };
    const processor = new AlertBatchProcessor(
      alertRepo as never,
      connectorRepo as never,
      enqueue,
      logger as never,
      resolver,
      authorize as never,
    );

    const result = await processor.processBatch({ batchId: 'batch-project', organizationId });

    expect(result.success).toBe(1);
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ connectorId: allowedConnectorId }),
      expect.any(Object),
    );
    expect(alertRepo.recordThrottleNotifications).toHaveBeenCalledWith([actionId]);
  });

  it('drops subscribed targets when no authoritative channel recipient is eligible', async () => {
    const event = projectEvent();
    const { alertRepo, connectorRepo } = dependencies(event);
    const enqueue = vi.fn();
    const resolver = resolverWithChannelTargets([]);
    const processor = new AlertBatchProcessor(
      alertRepo as never,
      connectorRepo as never,
      enqueue,
      logger as never,
      resolver,
      authorize as never,
    );

    const result = await processor.processBatch({ batchId: 'batch-project', organizationId });

    expect(result.skipped).toBe(1);
    expect(result.success).toBe(0);
    expect(enqueue).not.toHaveBeenCalled();
    expect(resolver.resolveImmediateDeliveryTargets).toHaveBeenCalledOnce();
    expect(resolver.resolveImmediateDeliveryTargets).toHaveBeenCalledWith({
      organizationId,
      projectId,
      category: 'security',
      severity: 'critical',
    });
  });

  it('allows only matching authoritative channel connectors with one lookup per tuple', async () => {
    const event = projectEvent();
    const { alertRepo, connectorRepo } = dependencies(event);
    const enqueue = vi.fn().mockResolvedValue('channel-authorized-job');
    const resolver = resolverWithChannelTargets([{
      userId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      channelId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      channelConnectorId: allowedConnectorId,
      subscriptionConnectorId: allowedConnectorId,
    }]);
    const processor = new AlertBatchProcessor(
      alertRepo as never,
      connectorRepo as never,
      enqueue,
      logger as never,
      resolver,
      authorize as never,
    );

    const result = await processor.processBatch({ batchId: 'batch-project', organizationId });

    expect(result.success).toBe(1);
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ connectorId: allowedConnectorId }),
      expect.any(Object),
    );
    expect(resolver.resolveImmediateDeliveryTargets).toHaveBeenCalledOnce();
    expect(enqueue).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        projectChannel: expect.objectContaining({
          userId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          channelId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        }),
      }),
      expect.any(Object),
    );
  });

  it('materializes a connectorless member email channel and audits the recipient', async () => {
    const event = projectEvent();
    const { alertRepo, connectorRepo } = dependencies(event);
    const enqueue = vi.fn().mockResolvedValue('connector-email-job-1');
    const userId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const channelId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    const resolver = {
      resolveByProjectId: vi.fn().mockResolvedValue({
        projectId,
        organizationId,
        environmentId: null,
        apiKeyId: null,
        subscriptions: [],
        members: [{ userId, role: 'developer', email: 'member@example.com' }],
      }),
      resolveImmediateDeliveryTargets: vi.fn().mockResolvedValue([{
        userId,
        channelId,
        channelType: 'email',
        memberDestination: 'member@example.com',
        channelMetadata: {},
        channelConnectorId: null,
        subscriptionConnectorId: null,
      }]),
    };
    const processor = new AlertBatchProcessor(
      alertRepo as never,
      connectorRepo as never,
      enqueue,
      logger as never,
      resolver,
      authorize as never,
    );

    const result = await processor.processBatch({ batchId: 'batch-project', organizationId });

    expect(result.success).toBe(1);
    expect(enqueue).toHaveBeenCalledWith(
      'connector-send-email',
      expect.objectContaining({
        connectorId: '00000000-0000-0000-0000-000000000000',
        projectChannel: expect.objectContaining({
          userId,
          channelId,
          destination: 'member@example.com',
        }),
      }),
      expect.any(Object),
    );
    expect(alertRepo.bulkInsertDeliveryAttempts).toHaveBeenCalledWith([
      expect.objectContaining({
        connectorId: null,
        projectAlertChannelId: channelId,
        recipientUserId: userId,
        status: 'queued',
        externalMessageId: 'connector-email-job-1',
      }),
    ]);
  });
});
