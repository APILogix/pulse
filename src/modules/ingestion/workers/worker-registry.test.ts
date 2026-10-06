import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import type { IngestJobPayload } from '../queue/ingest-queues.js';

const mocks = vi.hoisted(() => ({
  pgmqCreateQueue: vi.fn(),
  pgmqSend: vi.fn(),
  pgmqReadWithPoll: vi.fn(),
  pgmqDelete: vi.fn(),
  pgmqFetchKnownQueues: vi.fn(),
  processorProcess: vi.fn(),
  metrics: {
    setWorkerInFlight: vi.fn(),
    setOrgInFlight: vi.fn(),
    recordDeferred: vi.fn(),
    recordFairnessProcessed: vi.fn(),
    recordFairnessStarvationAdmission: vi.fn(),
    recordFailed: vi.fn(),
    setWorkerCapacity: vi.fn(),
    recordRetry: vi.fn(),
    recordStage: vi.fn(),
    recordDlqIntake: vi.fn(),
  },
}));

vi.mock('../../../config/env.js', () => ({
  env: {
    INGESTION_FAIRNESS_MAX_DEFERS: 3,
    INGESTION_FAIRNESS_DEFER_DELAY_SECONDS: 5,
    INGESTION_TYPE_WORKER_CONCURRENCY: 1,
    INGESTION_TYPE_WORKER_BATCH_SIZE: 10,
    INGESTION_WORKER_METRICS_PORT: 9108,
    INGESTION_JOB_RETRY_LIMIT: 3,
    INGESTION_USAGE_FLUSH_MS: 60_000,
    INGESTION_USAGE_BUFFER_LIMIT: 1000,
  },
}));

vi.mock('../../../lib/pgmq.js', () => ({
  pgmq: {
    createQueue: mocks.pgmqCreateQueue,
    send: mocks.pgmqSend,
    readWithPoll: mocks.pgmqReadWithPoll,
    delete: mocks.pgmqDelete,
    fetchKnownQueues: mocks.pgmqFetchKnownQueues,
  },
  isPgmqQueueAlreadyProvisionedError: vi.fn().mockReturnValue(false),
}));

vi.mock('./event-processor.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./event-processor.js')>();
  return {
    ...actual,
    EventProcessor: vi.fn(function EventProcessorMock(this: Record<string, unknown>) {
      this.process = mocks.processorProcess;
      this.start = vi.fn();
      this.stop = vi.fn();
    }),
  };
});

vi.mock('./usage-rollup.js', () => ({
  UsageRollup: vi.fn(function UsageRollupMock(this: Record<string, unknown>) {
    this.start = vi.fn();
    this.stop = vi.fn();
  }),
}));

vi.mock('./metrics-server.js', () => ({
  WorkerMetrics: vi.fn(function WorkerMetricsMock(this: Record<string, unknown>) {
    Object.assign(this, mocks.metrics);
  }),
  MetricsServer: vi.fn(function MetricsServerMock(this: Record<string, unknown>) {
    this.start = vi.fn();
    this.stop = vi.fn();
  }),
}));

function logger() {
  return {
    child: vi.fn().mockReturnThis(),
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
  };
}

function pool(): Pool {
  return {
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    connect: vi.fn(),
  } as unknown as Pool;
}

function payload(overrides: Partial<IngestJobPayload> = {}): IngestJobPayload {
  return {
    organizationId: '11111111-1111-4111-8111-111111111111',
    projectId: '22222222-2222-4222-8222-222222222222',
    eventType: 'request',
    events: [{ type: 'request', requestId: 'req-1' }, { type: 'request', requestId: 'req-2' }],
    metadata: {
      batchId: 'batch-1',
      apiKeyId: '33333333-3333-4333-8333-333333333333',
      apiKeyName: 'test-key',
      planTier: 'free',
      receivedAt: new Date().toISOString(),
      environment: 'production',
      deferCount: 0,
    },
    ...overrides,
  };
}

describe('WorkerRegistry tenant fairness gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.pgmqCreateQueue.mockResolvedValue(undefined);
    mocks.pgmqSend.mockResolvedValue('100');
    mocks.pgmqReadWithPoll.mockResolvedValue([]);
    mocks.pgmqDelete.mockResolvedValue(true);
    mocks.pgmqFetchKnownQueues.mockResolvedValue(new Set());
  });

  it('allows a clean start and provisions PGMQ queues', async () => {
    const { WorkerRegistry } = await import('./worker-registry.js');
    const registry = new WorkerRegistry(pool(), logger() as never);

    await expect(registry.start()).resolves.toBeUndefined();
    expect(mocks.pgmqCreateQueue).toHaveBeenCalledWith('ingest_dlq');
    expect(mocks.pgmqCreateQueue).toHaveBeenCalledWith('ingest_request');

    await registry.stop();
  });

  it('defers an over-budget tenant job by re-enqueueing an aged copy', async () => {
    const { WorkerRegistry } = await import('./worker-registry.js');
    const registry = new WorkerRegistry(pool(), logger() as never);
    const orgInFlight = registry as unknown as { inFlight: Map<string, number> };
    orgInFlight.inFlight.set('11111111-1111-4111-8111-111111111111', 2);
    mocks.pgmqSend.mockResolvedValueOnce('deferred-job-id');

    const output = await (registry as unknown as {
      runOne: (queue: string, type: 'request', payload: IngestJobPayload) => Promise<Record<string, unknown>>;
    }).runOne('ingest_request', 'request', payload());

    expect(output).toEqual({ deferred: true, deferCount: 1 });
    expect(mocks.processorProcess).not.toHaveBeenCalled();
    expect(mocks.pgmqSend).toHaveBeenCalledWith(
      'ingest_request',
      expect.objectContaining({
        metadata: expect.objectContaining({ deferCount: 1 }),
      }),
      {
        delaySeconds: 5,
      },
    );
    expect(mocks.metrics.recordDeferred).toHaveBeenCalledWith('ingest_request', 2);
    expect(mocks.metrics.recordFairnessProcessed).not.toHaveBeenCalled();
    expect(mocks.metrics.setWorkerInFlight).toHaveBeenLastCalledWith('ingest_request', 'request', 0);
    expect(orgInFlight.inFlight.get('11111111-1111-4111-8111-111111111111')).toBe(2);
  });

  it('admits an over-budget tenant after max defers and records starvation guard', async () => {
    const { WorkerRegistry } = await import('./worker-registry.js');
    const registry = new WorkerRegistry(pool(), logger() as never);
    const orgInFlight = registry as unknown as { inFlight: Map<string, number> };
    orgInFlight.inFlight.set('11111111-1111-4111-8111-111111111111', 2);
    mocks.processorProcess.mockResolvedValueOnce(undefined);

    const output = await (registry as unknown as {
      runOne: (queue: string, type: 'request', payload: IngestJobPayload) => Promise<Record<string, unknown>>;
    }).runOne('ingest_request', 'request', payload({
      metadata: {
        ...payload().metadata,
        deferCount: 3,
      },
    }));

    expect(output).toEqual({ deferred: false, deferCount: 3 });
    expect(mocks.pgmqSend).not.toHaveBeenCalled();
    expect(mocks.metrics.recordFairnessStarvationAdmission).toHaveBeenCalledWith('ingest_request', 'request');
    expect(mocks.processorProcess).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({ deferCount: 3 }),
    }), 'ingest_request', undefined);
    expect(mocks.metrics.recordFairnessProcessed).toHaveBeenCalledTimes(1);
    expect(mocks.metrics.setOrgInFlight).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111', 3);
    expect(mocks.metrics.setOrgInFlight).toHaveBeenLastCalledWith('11111111-1111-4111-8111-111111111111', 2);
    expect(orgInFlight.inFlight.get('11111111-1111-4111-8111-111111111111')).toBe(2);
  });

  it('releases org and worker in-flight gauges when processing fails', async () => {
    const { WorkerRegistry } = await import('./worker-registry.js');
    const registry = new WorkerRegistry(pool(), logger() as never);
    const orgInFlight = registry as unknown as { inFlight: Map<string, number> };
    mocks.processorProcess.mockRejectedValueOnce(new Error('db unavailable'));

    await expect((registry as unknown as {
      runOne: (queue: string, type: 'request', payload: IngestJobPayload) => Promise<Record<string, unknown>>;
    }).runOne('ingest_request', 'request', payload())).rejects.toThrow('db unavailable');

    expect(mocks.metrics.recordFairnessProcessed).not.toHaveBeenCalled();
    expect(mocks.metrics.setOrgInFlight).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111', 1);
    expect(mocks.metrics.setOrgInFlight).toHaveBeenLastCalledWith('11111111-1111-4111-8111-111111111111', 0);
    expect(mocks.metrics.setWorkerInFlight).toHaveBeenLastCalledWith('ingest_request', 'request', 0);
    expect(orgInFlight.inFlight.has('11111111-1111-4111-8111-111111111111')).toBe(false);
  });

  it('does not process or fairness-reenqueue a job already aborted', async () => {
    const { WorkerRegistry } = await import('./worker-registry.js');
    const registry = new WorkerRegistry(pool(), logger() as never);
    const abort = new AbortController();
    abort.abort(new Error('handler execution exceeded 300s'));

    await expect((registry as unknown as {
      runOne: (
        queue: string,
        type: 'request',
        payload: IngestJobPayload,
        signal?: AbortSignal,
      ) => Promise<Record<string, unknown>>;
    }).runOne('ingest_request', 'request', payload(), abort.signal)).rejects.toMatchObject({
      code: 'INGESTION_JOB_ABORTED',
    });

    expect(mocks.processorProcess).not.toHaveBeenCalled();
    expect(mocks.pgmqSend).not.toHaveBeenCalled();
    expect(mocks.metrics.setWorkerInFlight).not.toHaveBeenCalled();
  });

  it('forwards AbortSignal to EventProcessor during job execution', async () => {
    const { WorkerRegistry } = await import('./worker-registry.js');
    const registry = new WorkerRegistry(pool(), logger() as never);
    const abort = new AbortController();
    mocks.processorProcess.mockResolvedValueOnce(undefined);

    await (registry as unknown as {
      handleSingleIngestJob: (queue: string, type: 'request', msg: any, signal?: AbortSignal) => Promise<void>;
    }).handleSingleIngestJob('ingest_request', 'request', {
      msgId: 'msg-1',
      readCt: 1,
      enqueuedAt: new Date(),
      vt: new Date(),
      message: payload(),
      headers: null,
    }, abort.signal);

    expect(mocks.processorProcess).toHaveBeenCalledWith(
      expect.any(Object),
      'ingest_request',
      abort.signal,
    );
  });
});
