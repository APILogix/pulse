import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CONNECTOR_JOBS } from '../../../src/modules/connectors/job.constants.js';

const work = vi.fn();
const send = vi.fn();
const schedule = vi.fn();
const unschedule = vi.fn();
const createQueue = vi.fn();
const retryDelivery = vi.fn();
const insertAuditLog = vi.fn();

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
    dispatch: vi.fn(),
    processRetry: vi.fn(),
    instantiate: vi.fn(),
    };
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

describe('connector queue workers', () => {
  beforeEach(() => {
    work.mockReset();
    send.mockReset();
    schedule.mockReset();
    unschedule.mockReset();
    createQueue.mockReset();
    retryDelivery.mockReset();
    insertAuditLog.mockReset();
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
    await registerConnectorWorkers(logger() as never);

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
  });
});
