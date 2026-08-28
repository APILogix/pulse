import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CONNECTOR_JOBS, connectorTransportQueue } from '../../../src/modules/connectors/job.constants.js';

/** Build a valid canonical V2 ConnectorTransportJob payload. */
function transportJob(overrides: Record<string, unknown> = {}) {
  return {
    organizationId: '11111111-1111-1111-1111-111111111111',
    notificationJobId: '22222222-2222-2222-2222-222222222222',
    connectorId: '33333333-3333-3333-3333-333333333333',
    channelKind: 'slack',
    severity: 'critical',
    idempotencyKey: 'idem-1',
    correlationId: 'corr-1',
    notificationType: 'alert',
    routingDecisionHash: null,
    payload: {
      notificationType: 'alert',
      severity: 'critical',
      title: 'CPU high',
      body: 'CPU exceeded threshold',
      correlationId: 'corr-1',
    },
    ...overrides,
  };
}

const work = vi.fn();
const send = vi.fn();
const schedule = vi.fn();
const unschedule = vi.fn();
const createQueue = vi.fn();
const retryDelivery = vi.fn();
const insertAuditLog = vi.fn();
const getByIds = vi.fn();
const findFirstActiveByType = vi.fn();
const getOrCreateManagedEmailConnector = vi.fn();
const dispatch = vi.fn();
const hasFeature = vi.fn();

vi.mock('../../../src/lib/pgboss.js', () => ({
  pgboss: {
    createQueue,
    work,
    send,
    schedule,
    unschedule,
  },
}));

vi.mock('../../../src/modules/connectors/repository.js', () => ({
  ConnectorRepository: vi.fn(function ConnectorRepository() {
    return {
    retryDelivery,
    insertAuditLog,
    getByIds,
    findFirstActiveByType,
    getOrCreateManagedEmailConnector,
    findById: vi.fn(),
    findByIdInternal: vi.fn(),
    claimRetryableDeliveries: vi.fn(),
    listMonitorable: vi.fn(),
    cleanupExpiredOAuthStates: vi.fn().mockResolvedValue(0),
    };
  }),
}));

vi.mock('../../../src/modules/connectors/delivery/delivery.service.js', () => ({
  NotificationDispatcher: vi.fn(function NotificationDispatcher() {
    return {
    dispatch,
    processRetry: vi.fn(),
    instantiate: vi.fn(),
    };
  }),
}));

vi.mock('../../../src/modules/billing/entitlements/repository.js', () => ({
  EntitlementsRepository: vi.fn(function EntitlementsRepository() {
    return { hasFeature };
  }),
}));

vi.mock('../../../src/modules/connectors/service.js', () => ({
  ConnectorService: vi.fn(function ConnectorService() {
    return {
    runHealthCheck: vi.fn(),
    rotateSecret: vi.fn(),
    runConnectionTest: vi.fn(),
    };
  }),
}));

vi.mock('../../../src/modules/connectors/monitor.js', () => ({
  ConnectorMonitor: vi.fn(function ConnectorMonitor() {
    return {
    processRetries: vi.fn().mockResolvedValue(0),
    runHealthChecks: vi.fn().mockResolvedValue(0),
    };
  }),
}));

function logger() {
  return {
    child: vi.fn().mockReturnThis(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

describe('connector queue workers', { timeout: 15000 }, () => {
  beforeEach(() => {
    work.mockReset().mockResolvedValue(undefined);
    send.mockReset().mockResolvedValue(undefined);
    schedule.mockReset().mockResolvedValue(undefined);
    unschedule.mockReset().mockResolvedValue(undefined);
    createQueue.mockReset().mockResolvedValue(undefined);
    retryDelivery.mockReset();
    insertAuditLog.mockReset();
    getByIds.mockReset();
    findFirstActiveByType.mockReset();
    getOrCreateManagedEmailConnector.mockReset();
    dispatch.mockReset();
    hasFeature.mockReset();
  });

  it('wakes delivery retry processing after a dead-letter retry job resets state', async () => {
    process.env.NODE_ENV = 'development';
    createQueue.mockResolvedValue(undefined);
    work.mockResolvedValue(undefined);
    schedule.mockResolvedValue(undefined);
    send.mockResolvedValue('delivery-retry-job');
    retryDelivery.mockResolvedValue({
      id: 'delivery-1',
      connector_id: 'connector-1',
    });
    insertAuditLog.mockResolvedValue(undefined);

    const { registerConnectorWorkers } = await import('../../../src/modules/connectors/queue.js');
    const workers = await registerConnectorWorkers(logger() as never);
    try {
      const deadLetterWork = work.mock.calls.find((call) => call[0] === CONNECTOR_JOBS.deadLetterRetry);
      expect(deadLetterWork).toBeTruthy();

      const handler = deadLetterWork![2] as (job: unknown) => Promise<void>;
      await handler({
        id: 'job-1',
        data: {
          organizationId: 'org-1',
          deliveryId: 'delivery-1',
          actorUserId: 'user-1',
        },
      });

      expect(retryDelivery).toHaveBeenCalledWith('org-1', 'delivery-1');
      expect(insertAuditLog).toHaveBeenCalledWith(expect.objectContaining({
        organizationId: 'org-1',
        connectorId: 'connector-1',
        action: 'delivery.dead_letter_retry_requested',
      }));
      expect(send).toHaveBeenCalledWith(
        CONNECTOR_JOBS.deliveryRetry,
        { organizationId: 'org-1', deliveryId: 'delivery-1' },
        { retryLimit: 3, retryDelay: 60, retryBackoff: true, expireInSeconds: 120 },
      );
    } finally {
      await workers.stop();
    }
  });

  it('fails closed when the requested connector is unavailable', async () => {
    process.env.NODE_ENV = 'development';
    createQueue.mockResolvedValue(undefined);
    work.mockResolvedValue(undefined);
    schedule.mockResolvedValue(undefined);
    getByIds.mockResolvedValue([]);
    findFirstActiveByType.mockResolvedValue(null);
    hasFeature.mockResolvedValue(true);
    getOrCreateManagedEmailConnector.mockResolvedValue({
      id: 'managed-email-1',
      type: 'email',
      status: 'active',
      metadata: { managedBy: 'pulse' },
    });
    dispatch.mockResolvedValue({
      deliveryId: 'delivery-1',
      status: 'sent',
      result: { success: true, latencyMs: 3 },
    });

    const { registerConnectorWorkers } = await import('../../../src/modules/connectors/queue.js');
    await registerConnectorWorkers(logger() as never);

    // Canonical V2 transport is the only send path.
    const sendWork = work.mock.calls.find((call) => call[0] === connectorTransportQueue('slack'));
    expect(sendWork).toBeTruthy();

    const handler = sendWork![2] as (job: unknown) => Promise<void>;
    await handler({
      id: 'job-1',
      data: transportJob({ connectorId: '99999999-9999-9999-9999-999999999999' }),
    });

    expect(findFirstActiveByType).not.toHaveBeenCalled();
    expect(hasFeature).not.toHaveBeenCalled();
    expect(getOrCreateManagedEmailConnector).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('does not reroute a blocked connector job through managed email', async () => {
    process.env.NODE_ENV = 'development';
    createQueue.mockResolvedValue(undefined);
    work.mockResolvedValue(undefined);
    schedule.mockResolvedValue(undefined);
    getByIds.mockResolvedValue([]);
    findFirstActiveByType.mockResolvedValue(null);
    hasFeature.mockResolvedValue(false);

    const { registerConnectorWorkers } = await import('../../../src/modules/connectors/queue.js');
    await registerConnectorWorkers(logger() as never);

    const sendWork = work.mock.calls.find((call) => call[0] === connectorTransportQueue('slack'));
    const handler = sendWork![2] as (job: unknown) => Promise<void>;
    await handler({
      id: 'job-1',
      data: transportJob({ connectorId: '99999999-9999-9999-9999-999999999999' }),
    });

    expect(hasFeature).not.toHaveBeenCalled();
    expect(findFirstActiveByType).not.toHaveBeenCalled();
    expect(getOrCreateManagedEmailConnector).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('registers only alert delivery connector consumers in alert-delivery mode', async () => {
    createQueue.mockResolvedValue(undefined);
    work.mockResolvedValue(undefined);
    schedule.mockResolvedValue(undefined);

    const { registerConnectorWorkers } = await import('../../../src/modules/connectors/queue.js');
    const workers = await registerConnectorWorkers(logger() as never, undefined, {
      group: 'alert-delivery',
    });
    try {
      const registeredQueues = work.mock.calls.map((call) => call[0] as string);
      const providers = ['email', 'slack', 'discord', 'teams', 'pagerduty', 'webhook', 'sms'];

      expect(registeredQueues).toEqual(expect.arrayContaining([
        CONNECTOR_JOBS.deliveryRetry,
        ...providers.map((provider) => connectorTransportQueue(provider)),
      ]));

      // MIGRATION PROOF: the legacy `connector-send-<provider>` transport family
      // must not be registered by any code path. If this ever fails, two
      // parallel transports are live again.
      for (const provider of providers) {
        expect(registeredQueues).not.toContain(`connector-send-${provider}`);
      }
      expect(registeredQueues.filter((queue) => queue.startsWith('connector-send'))).toEqual([]);
      // No duplicate consumers for any queue.
      expect(new Set(registeredQueues).size).toBe(registeredQueues.length);
      expect(registeredQueues).not.toEqual(expect.arrayContaining([
        CONNECTOR_JOBS.healthCheck,
        CONNECTOR_JOBS.test,
        CONNECTOR_JOBS.secretRotation,
        CONNECTOR_JOBS.oauthRefresh,
        CONNECTOR_JOBS.cleanup,
        CONNECTOR_JOBS.deadLetterRetry,
      ]));
      expect(schedule).toHaveBeenCalledWith(
        CONNECTOR_JOBS.deliveryRetry,
        '* * * * *',
        {},
        { singletonKey: 'connector-delivery-retry' },
      );
      expect(schedule).toHaveBeenCalledTimes(1);
    } finally {
      await workers.stop();
    }
  });
});
