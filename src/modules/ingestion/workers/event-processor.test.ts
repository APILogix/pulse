import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Pool, PoolClient } from 'pg';
import type { IngestJobPayload } from '../queue/ingest-queues.js';

const mocks = vi.hoisted(() => ({
  writerWriteBatchDetailedWithOutbox: vi.fn(),
  writerWriteBatchDetailedInTransaction: vi.fn(),
  writerAppendTelemetryOutbox: vi.fn(),
  usageIncrement: vi.fn(),
  usageStart: vi.fn(),
  usageStop: vi.fn(),
  pgbossSend: vi.fn(),
}));

vi.mock('../../../config/env.js', () => ({
  env: {
    INGESTION_USAGE_FLUSH_MS: 60_000,
    INGESTION_USAGE_BUFFER_LIMIT: 1000,
    INGESTION_LOG_DB_SYNCHRONOUS_COMMIT: 'on',
    INGESTION_LOG_DB_LOCK_TIMEOUT_MS: 2000,
    INGESTION_LOG_DB_STATEMENT_TIMEOUT_MS: 0,
    INGESTION_LOG_DB_IDLE_TX_TIMEOUT_MS: 30000,
  },
}));

vi.mock('../../../lib/pgboss.js', () => ({
  pgboss: {
    send: mocks.pgbossSend,
  },
}));

vi.mock('../usage/usage-counter.js', () => ({
  UsageCounter: vi.fn(function UsageCounterMock(this: Record<string, unknown>) {
    this.increment = mocks.usageIncrement;
    this.start = mocks.usageStart;
    this.stop = mocks.usageStop;
  }),
}));

vi.mock('../pipeline/telemetry-writer.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../pipeline/telemetry-writer.js')>();
  return {
    ...actual,
    TelemetryWriter: vi.fn(function TelemetryWriterMock(this: Record<string, unknown>) {
      this.writeBatchDetailedWithOutbox = mocks.writerWriteBatchDetailedWithOutbox;
      this.writeBatchDetailedInTransaction = mocks.writerWriteBatchDetailedInTransaction;
      this.appendTelemetryOutbox = mocks.writerAppendTelemetryOutbox;
    }),
  };
});

function clientWithQueries(): PoolClient & { query: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> } {
  return {
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    release: vi.fn(),
  } as unknown as PoolClient & { query: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> };
}

function poolWithClient(client: PoolClient): Pool {
  return {
    connect: vi.fn().mockResolvedValue(client),
  } as unknown as Pool;
}

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

function metrics() {
  return {
    recordStage: vi.fn(),
    recordDbQueries: vi.fn(),
    recordDbQueryDuration: vi.fn(),
    recordBatchShape: vi.fn(),
    recordDuplicates: vi.fn(),
    recordProcessed: vi.fn(),
    recordErrorDuplicate: vi.fn(),
    recordErrorLatencies: vi.fn(),
    recordErrorGroup: vi.fn(),
  };
}

function payload(events: unknown[], overrides: Partial<IngestJobPayload> = {}): IngestJobPayload {
  return {
    organizationId: '11111111-1111-4111-8111-111111111111',
    projectId: '22222222-2222-4222-8222-222222222222',
    eventType: 'request',
    events,
    metadata: {
      batchId: 'batch-1',
      apiKeyId: '33333333-3333-4333-8333-333333333333',
      apiKeyName: 'test-key',
      receivedAt: new Date(Date.now() - 100).toISOString(),
      environment: 'production',
      planTier: 'free',
      deferCount: 0,
    },
    ...overrides,
  };
}

function requestEvent(index: number): Record<string, unknown> {
  return {
    type: 'request',
    eventId: `44444444-4444-4444-8444-${String(index).padStart(12, '0')}`,
    requestId: `req-${index}`,
    timestamp: Date.now(),
    method: 'GET',
    url: '/unit',
    statusCode: 200,
    latency: 12,
  };
}

describe('EventProcessor failure and idempotency behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rolls back, releases the client, and does not bill usage when persistence fails', async () => {
    const { EventProcessor } = await import('./event-processor.js');
    const client = clientWithQueries();
    const pool = poolWithClient(client);
    const workerMetrics = metrics();
    const log = logger();
    const err = Object.assign(new Error('canceling statement due to lock timeout'), { code: '55P03' });
    mocks.writerWriteBatchDetailedInTransaction.mockRejectedValueOnce(err);

    const processor = new EventProcessor(pool, workerMetrics as never, log as never, pool);

    await expect(processor.process(payload([requestEvent(1)]), 'ingest.request')).rejects.toThrow('lock timeout');

    expect(client.query).toHaveBeenCalledWith('BEGIN');
    expect(client.query).toHaveBeenCalledWith(
      "SET LOCAL synchronous_commit = on; SET LOCAL lock_timeout = '2000ms'; SET LOCAL idle_in_transaction_session_timeout = '30000ms'",
    );
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.query).not.toHaveBeenCalledWith('COMMIT');
    expect(client.release).toHaveBeenCalledTimes(1);
    expect(mocks.usageIncrement).not.toHaveBeenCalled();
    expect(workerMetrics.recordProcessed).not.toHaveBeenCalled();
    expect(log.error).toHaveBeenCalledWith(
      expect.objectContaining({
        err,
        phase: 'ingestion_profile_failed',
        failureClass: 'db_lock_timeout',
        sqlState: '55P03',
        queue: 'ingest.request',
        eventType: 'request',
        batchId: 'batch-1',
        received: 1,
        validated: 1,
        rejected: 0,
        dbQueries: expect.any(Number),
        dbQueryMs: expect.any(Number),
        rollbackMs: expect.any(Number),
        totalProcessingMs: expect.any(Number),
      }),
      'ingestion batch transaction failed',
    );
  });

  it('treats duplicate deliveries as processed but does not bill skipped inserts', async () => {
    const { EventProcessor } = await import('./event-processor.js');
    const client = clientWithQueries();
    const pool = poolWithClient(client);
    const workerMetrics = metrics();
    mocks.writerWriteBatchDetailedInTransaction.mockResolvedValueOnce({
      totalReceived: 2,
      totalInserted: 0,
      perType: { request: { received: 2, inserted: 0, durationMs: 17 } },
      insertedErrors: [],
    });

    const processor = new EventProcessor(pool, workerMetrics as never, logger() as never, pool);

    const result = await processor.process(payload([requestEvent(1), requestEvent(1)]), 'ingest.request');

    expect(client.query).toHaveBeenCalledWith(
      "SET LOCAL synchronous_commit = on; SET LOCAL lock_timeout = '2000ms'; SET LOCAL idle_in_transaction_session_timeout = '30000ms'",
    );
    expect(client.query).toHaveBeenCalledWith('COMMIT');
    expect(mocks.usageIncrement).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      received: 2,
      inserted: 0,
      duplicates: 2,
      outboxInserted: 0,
      perType: { request: { received: 2, inserted: 0, durationMs: 17 } },
    });
    expect(workerMetrics.recordDuplicates).toHaveBeenCalledWith('ingest.request', 'request', 2);
    expect(workerMetrics.recordStage).toHaveBeenCalledWith('perType.request.durationMs', 'request', 17);
    expect(workerMetrics.recordProcessed).toHaveBeenCalledWith(
      'ingest.request',
      'request',
      2,
      0,
      0,
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
    );
  });

  it('routes validation rejects to DLQ and bills only rows confirmed inserted', async () => {
    const { EventProcessor } = await import('./event-processor.js');
    const client = clientWithQueries();
    const pool = poolWithClient(client);
    const workerMetrics = metrics();
    mocks.pgbossSend.mockResolvedValueOnce('dlq-job-id');
    mocks.writerWriteBatchDetailedInTransaction.mockResolvedValueOnce({
      totalReceived: 1,
      totalInserted: 1,
      perType: { request: { received: 1, inserted: 1, durationMs: 19 } },
      insertedErrors: [],
    });
    mocks.writerAppendTelemetryOutbox.mockResolvedValueOnce(0);

    const processor = new EventProcessor(pool, workerMetrics as never, logger() as never, pool);

    const result = await processor.process(payload([requestEvent(1), { type: 'request', timestamp: 'not-a-date' }]), 'ingest.request');

    expect(mocks.pgbossSend).toHaveBeenCalledWith(
      'ingest.dlq-intake',
      expect.objectContaining({
        sourceQueue: 'ingest.request',
        eventType: 'request',
        payload: expect.arrayContaining([
          expect.objectContaining({
            detail: expect.stringContaining('timestamp'),
          }),
        ]),
      }),
      {},
    );
    expect(mocks.usageIncrement).toHaveBeenCalledWith(
      '22222222-2222-4222-8222-222222222222',
      '11111111-1111-4111-8111-111111111111',
      'billing:events:request',
      1,
    );
    expect(result).toMatchObject({
      received: 2,
      validated: 1,
      rejected: 1,
      inserted: 1,
      outboxInserted: 0,
    });
    expect(workerMetrics.recordStage).toHaveBeenCalledWith('perType.request.durationMs', 'request', 19);
    expect(workerMetrics.recordProcessed).toHaveBeenCalledWith(
      'ingest.request',
      'request',
      2,
      1,
      1,
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
    );
  });
});
