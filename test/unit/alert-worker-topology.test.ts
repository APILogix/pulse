import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ALERT_JOBS, ALERT_DELIVERY_WORKER_JOBS } from '../../src/modules/alerting/queue.js';

const { work, send, schedule, unschedule, createQueue } = vi.hoisted(() => ({
  work: vi.fn(),
  send: vi.fn(),
  schedule: vi.fn(),
  unschedule: vi.fn(),
  createQueue: vi.fn(),
}));

vi.mock('../../src/lib/pgboss.js', () => ({
  pgboss: { createQueue, work, send, schedule, unschedule },
}));

vi.mock('../../src/config/database.js', () => ({
  pool: { query: vi.fn(), connect: vi.fn() },
}));

vi.mock('../../src/config/log-database.js', () => ({
  logDB: { getPrimaryPool: vi.fn(() => ({ query: vi.fn() })) },
}));

vi.mock('../../src/modules/alerting/repository.js', () => ({
  AlertingRepository: vi.fn(function AlertingRepository() {
    return {
      purgeOldTerminalEvents: vi.fn(),
      purgeOldBatches: vi.fn(),
      purgeOldDeliveryAttempts: vi.fn(),
      purgeOldDeadLetters: vi.fn(),
      purgeOldThrottleWindows: vi.fn(),
    };
  }),
}));

vi.mock('../../src/modules/connectors/repository.js', () => ({
  ConnectorRepository: vi.fn(function ConnectorRepository() {
    return {};
  }),
}));

vi.mock('../../src/modules/alerting/runtime/engines.js', () => ({
  AlertRuntimeEngines: vi.fn(function AlertRuntimeEngines() {
    return { evaluateFast: vi.fn(), evaluateTier: vi.fn() };
  }),
}));

vi.mock('../../src/modules/alerting/runtime/notification-routing.service.js', () => ({
  NotificationRoutingService: vi.fn(function NotificationRoutingService() {
    return {};
  }),
}));

vi.mock('../../src/modules/projects/alerts/channels/channel.repository.js', () => ({
  AlertChannelRepository: vi.fn(),
}));

vi.mock('../../src/modules/alerting/config/alert-config.repository.js', () => ({
  AlertConfigRepository: vi.fn(),
}));

vi.mock('../../src/modules/alerting/runtime/notification-router.js', () => ({
  AlertNotificationRouter: vi.fn(function AlertNotificationRouter() {
    return { dispatchById: vi.fn(), run: vi.fn() };
  }),
}));

vi.mock('../../src/modules/alerting/runtime/telemetry-outbox-relay.js', () => ({
  TelemetryOutboxRelay: vi.fn(function TelemetryOutboxRelay() {
    return { run: vi.fn() };
  }),
}));

vi.mock('../../src/modules/alerting/escalation/escalation.worker.js', () => ({
  SnapshotEscalationWorker: vi.fn(function SnapshotEscalationWorker() {
    return { run: vi.fn() };
  }),
}));

vi.mock('../../src/modules/alerting/runtime/notification-entitlement.service.js', () => ({
  NotificationEntitlementService: vi.fn(),
}));

vi.mock('../../src/modules/alerting/runtime/email-only-restricted-routing.js', () => ({
  EmailOnlyRestrictedRouting: vi.fn(),
  ProjectOwnerRepository: vi.fn(),
}));

vi.mock('../../src/modules/alerting/escalation.js', () => ({
  AlertEscalationSweep: vi.fn(function AlertEscalationSweep() {
    return { run: vi.fn() };
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

describe('alert-only worker topology', () => {
  beforeEach(() => {
    work.mockReset().mockResolvedValue(undefined);
    send.mockReset().mockResolvedValue(undefined);
    schedule.mockReset().mockResolvedValue(undefined);
    unschedule.mockReset().mockResolvedValue(undefined);
    createQueue.mockReset().mockResolvedValue(undefined);
  });

  it('registers every alert delivery consumer and skips retention cleanup', async () => {
    const { registerAlertingWorkers } = await import('../../src/modules/alerting/queue.js');
    const workers = await registerAlertingWorkers(
      logger() as never,
      { group: 'alert-delivery' },
      undefined,
      { query: vi.fn().mockResolvedValue({ rows: [] }) } as never,
    );

    try {
      const registeredQueues = work.mock.calls.map((call) => call[0] as string);
      expect(registeredQueues).toEqual(expect.arrayContaining([...ALERT_DELIVERY_WORKER_JOBS]));
      expect(registeredQueues).not.toContain(ALERT_JOBS.cleanup);
      expect(new Set(registeredQueues).size).toBe(registeredQueues.length);
      expect(schedule).toHaveBeenCalledWith(
        ALERT_JOBS.escalationSweep,
        '* * * * *',
        {},
        { singletonKey: 'alert-escalation-sweep' },
      );
      expect(schedule).not.toHaveBeenCalledWith(
        ALERT_JOBS.cleanup,
        expect.anything(),
        expect.anything(),
        expect.anything(),
      );
    } finally {
      await workers.stop();
    }
  });
});
