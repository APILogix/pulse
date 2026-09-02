import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ALERT_JOBS } from '../../src/modules/alerting/queue-names.js';

const { createQueue, schedule, send, unschedule, work } = vi.hoisted(() => ({
  createQueue: vi.fn(),
  schedule: vi.fn(),
  send: vi.fn(),
  unschedule: vi.fn(),
  work: vi.fn(),
}));

const { buildAnalyticsWorkers, trackedOrganizations } = vi.hoisted(() => ({
  buildAnalyticsWorkers: vi.fn(),
  trackedOrganizations: vi.fn(),
}));

vi.mock('../../src/lib/pgboss.js', () => ({
  pgboss: { createQueue, schedule, send, unschedule, work },
}));

vi.mock('../../src/config/env.js', () => ({
  env: {
    ANALYTICS_WORKER_CONCURRENCY: 4,
  },
}));

vi.mock('../../src/modules/analytics-engine/registry.js', () => ({
  resolveAnalyticsConfig: vi.fn(() => ({
    batchMaxRows: 1000,
    maxWindowSpanMinutes: 15,
    lateEventGraceSeconds: 60,
    statementTimeoutMs: 5000,
    entityTopK: 20,
    apdexThresholdMs: 300,
    sessionIdleMinutes: 30,
    freshnessStaleSeconds: 120,
    retentionEnabled: true,
  })),
  buildAnalyticsWorkers,
}));

vi.mock('../../src/modules/analytics-engine/workers/compaction.worker.js', () => ({
  runCompaction: vi.fn(),
}));

vi.mock('../../src/modules/analytics-engine/workers/maintenance.worker.js', () => ({
  ensurePartitions: vi.fn(),
  runRetention: vi.fn(),
}));

function logger() {
  return {
    child: vi.fn().mockReturnThis(),
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  };
}

describe('analytics engine queue registration', () => {
  beforeEach(() => {
    createQueue.mockReset().mockResolvedValue(undefined);
    schedule.mockReset().mockResolvedValue(undefined);
    send.mockReset().mockResolvedValue(undefined);
    unschedule.mockReset().mockResolvedValue(undefined);
    work.mockReset().mockResolvedValue(undefined);
    trackedOrganizations.mockReset().mockResolvedValue([]);
    buildAnalyticsWorkers.mockReset().mockReturnValue({
      workers: [
        {
          id: 'analytics.requests',
          queue: 'analytics.requests',
          tier: 'live',
          windowSize: '1m',
          sourceTables: ['events_requests'],
          outputTables: ['request_metrics_1m'],
          concurrency: 1,
          retryLimit: 2,
          retryBackoffSeconds: 5,
          lateGraceSeconds: 60,
          maxSpanMinutes: 15,
          description: 'request rollups',
          run: vi.fn(),
        },
      ],
      watermarks: {
        trackedOrganizations,
        recordRun: vi.fn(),
        recordFailure: vi.fn(),
      },
    });
  });

  it('creates alert evaluation queues used by analytics fan-out', async () => {
    const { registerAnalyticsEngineWorkers } = await import('../../src/modules/analytics-engine/queue.js');
    const runtime = await registerAnalyticsEngineWorkers(
      { query: vi.fn().mockResolvedValue({ rows: [] }) } as never,
      logger() as never,
    );

    try {
      const createdQueues = createQueue.mock.calls.map((call) => call[0]);
      expect(createdQueues).toEqual(expect.arrayContaining([
        ALERT_JOBS.evaluateWindow,
        ALERT_JOBS.evaluateOperational,
        ALERT_JOBS.evaluateAi,
      ]));
    } finally {
      await runtime.stop();
    }
  });
});
