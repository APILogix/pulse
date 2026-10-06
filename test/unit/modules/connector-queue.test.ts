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

const send = vi.fn();
const createQueue = vi.fn();
const retryDelivery = vi.fn();
const insertAuditLog = vi.fn();
const getByIds = vi.fn();
const findFirstActiveByType = vi.fn();
const getOrCreateManagedEmailConnector = vi.fn();
const dispatch = vi.fn();
const hasFeature = vi.fn();

vi.mock('../../../src/lib/pgmq.js', () => ({
  pgmq: {
    createQueue,
    send,
    readWithPoll: vi.fn().mockResolvedValue([]),
    setVt: vi.fn(),
    delete: vi.fn().mockResolvedValue(true),
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
    send.mockReset().mockResolvedValue(undefined);
    createQueue.mockReset().mockResolvedValue(undefined);
    retryDelivery.mockReset();
    insertAuditLog.mockReset();
    getByIds.mockReset();
    findFirstActiveByType.mockReset();
    getOrCreateManagedEmailConnector.mockReset();
    dispatch.mockReset();
    hasFeature.mockReset();
  });

  it('registers connector consumers in alert-delivery mode', async () => {
    createQueue.mockResolvedValue(undefined);

    const { registerConnectorWorkers } = await import('../../../src/modules/connectors/queue.js');
    const workers = await registerConnectorWorkers(logger() as never, undefined, {
      group: 'alert-delivery',
    });
    try {
      const createdQueues = createQueue.mock.calls.map((call) => call[0] as string);
      const providers = ['email', 'slack', 'discord', 'teams', 'pagerduty', 'webhook', 'sms'];

      expect(createdQueues).toEqual(expect.arrayContaining([
        CONNECTOR_JOBS.deliveryRetry,
        ...providers.map((provider) => connectorTransportQueue(provider)),
      ]));
    } finally {
      await workers.stop();
    }
  });
});
