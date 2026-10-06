import { beforeEach, describe, expect, it, vi } from 'vitest';
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
        INGESTION_LOG_DB_IDLE_TX_TIMEOUT_MS: 0,
    },
}));
vi.mock('../../../lib/pgboss.js', () => ({
    pgboss: {
        send: mocks.pgbossSend,
    },
}));
vi.mock('../../../lib/pgmq.js', () => ({
    pgmq: {
        send: mocks.pgbossSend,
        createQueue: vi.fn().mockResolvedValue(undefined),
    },
}));
vi.mock('../usage/usage-counter.js', () => ({
    UsageCounter: vi.fn(function UsageCounterMock() {
        this.increment = mocks.usageIncrement;
        this.start = mocks.usageStart;
        this.stop = mocks.usageStop;
    }),
}));
vi.mock('../pipeline/telemetry-writer.js', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        TelemetryWriter: vi.fn(function TelemetryWriterMock() {
            this.writeBatchDetailedWithOutbox = mocks.writerWriteBatchDetailedWithOutbox;
            this.writeBatchDetailedInTransaction = mocks.writerWriteBatchDetailedInTransaction;
            this.appendTelemetryOutbox = mocks.writerAppendTelemetryOutbox;
        }),
    };
});
function clientWithQueries() {
    return {
        query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
        release: vi.fn(),
        processID: 4242,
    };
}
function poolWithClient(client) {
    return {
        connect: vi.fn().mockResolvedValue(client),
        query: vi.fn().mockResolvedValue({ rows: [{ cancelled: true }], rowCount: 1 }),
    };
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
function payload(events, overrides = {}) {
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
function requestEvent(index) {
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
function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}
describe('EventProcessor failure and idempotency behavior', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });
    it('passes canonical confirmed error records to grouping in the writer transaction', async () => {
        const { EventProcessor } = await import('./event-processor.js');
        const { ErrorIngestionService } = await import('../../errors/services/error-ingestion.service.js');
        const ingest = vi.spyOn(ErrorIngestionService.prototype, 'ingestBatch').mockResolvedValue({ inserted: 1, domainEvents: [] });
        try {
            const client = clientWithQueries();
            const pool = poolWithClient(client);
            const event = { type: 'error', eventId: '44444444-4444-4444-8444-000000000001', timestamp: Date.now(), message: 'boom', name: 'TypeError', severity: 'error' };
            const job = payload([event], { eventType: 'error' });
            mocks.writerWriteBatchDetailedInTransaction.mockResolvedValueOnce({
                totalReceived: 1, totalInserted: 1, perType: { error: { received: 1, inserted: 1, durationMs: 1 } },
                insertedErrors: [{ projectId: job.projectId, orgId: job.organizationId, environment: job.metadata.environment, event }],
            });
            mocks.writerAppendTelemetryOutbox.mockResolvedValueOnce(1);
            const processor = new EventProcessor(pool, metrics(), logger(), pool);
            await processor.process(job, 'ingest.error');
            expect(ingest).toHaveBeenCalledWith(client, [expect.objectContaining({
                    groupParams: expect.objectContaining({ projectId: job.projectId, eventId: event.eventId, severity: 'error', occurredAt: expect.any(Date) }),
                    eventRecord: expect.objectContaining({ event_id: event.eventId, error_name: 'TypeError', message: 'boom', payload: event }),
                })], true);
            expect(client.query).toHaveBeenCalledWith('COMMIT');
        }
        finally {
            ingest.mockRestore();
        }
    });
    it('rolls back, releases the client, and does not bill usage when persistence fails', async () => {
        const { EventProcessor } = await import('./event-processor.js');
        const client = clientWithQueries();
        const pool = poolWithClient(client);
        const workerMetrics = metrics();
        const log = logger();
        const err = Object.assign(new Error('canceling statement due to lock timeout'), { code: '55P03' });
        mocks.writerWriteBatchDetailedInTransaction.mockRejectedValueOnce(err);
        const processor = new EventProcessor(pool, workerMetrics, log, pool);
        await expect(processor.process(payload([requestEvent(1)]), 'ingest.request')).rejects.toThrow('lock timeout');
        expect(client.query).toHaveBeenCalledWith('BEGIN');
        expect(client.query).toHaveBeenCalledWith("SET LOCAL synchronous_commit = on; SET LOCAL lock_timeout = '2000ms'");
        expect(client.query).toHaveBeenCalledWith('ROLLBACK');
        expect(client.query).not.toHaveBeenCalledWith('COMMIT');
        expect(client.release).toHaveBeenCalledTimes(1);
        expect(mocks.usageIncrement).not.toHaveBeenCalled();
        expect(workerMetrics.recordProcessed).not.toHaveBeenCalled();
        expect(log.error).toHaveBeenCalledWith(expect.objectContaining({
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
        }), 'ingestion batch transaction failed');
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
        const processor = new EventProcessor(pool, workerMetrics, logger(), pool);
        const result = await processor.process(payload([requestEvent(1), requestEvent(1)]), 'ingest.request');
        expect(client.query).toHaveBeenCalledWith("SET LOCAL synchronous_commit = on; SET LOCAL lock_timeout = '2000ms'");
        expect(client.query).toHaveBeenCalledWith('COMMIT');
        expect(mocks.usageIncrement).not.toHaveBeenCalled();
        expect(mocks.writerAppendTelemetryOutbox).not.toHaveBeenCalled();
        expect(result).toMatchObject({
            received: 2,
            inserted: 0,
            duplicates: 2,
            outboxInserted: 0,
            perType: { request: { received: 2, inserted: 0, durationMs: 17 } },
        });
        expect(workerMetrics.recordDuplicates).toHaveBeenCalledWith('ingest.request', 'request', 2);
        expect(workerMetrics.recordStage).toHaveBeenCalledWith('perType.request.durationMs', 'request', 17);
        expect(workerMetrics.recordProcessed).toHaveBeenCalledWith('ingest.request', 'request', 2, 0, 0, expect.any(Number), expect.any(Number), expect.any(Number));
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
        const processor = new EventProcessor(pool, workerMetrics, logger(), pool);
        const result = await processor.process(payload([requestEvent(1), { type: 'request', timestamp: 'not-a-date' }]), 'ingest.request');
        expect(mocks.pgbossSend).toHaveBeenCalledWith('ingest_dlq', expect.objectContaining({
            sourceQueue: 'ingest.request',
            eventType: 'request',
            payload: expect.arrayContaining([
                expect.objectContaining({
                    detail: expect.stringContaining('timestamp'),
                }),
            ]),
        }));
        expect(mocks.usageIncrement).toHaveBeenCalledWith('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111', 'billing:events:request', 1);
        expect(result).toMatchObject({
            received: 2,
            validated: 1,
            rejected: 1,
            inserted: 1,
            outboxInserted: 0,
        });
        expect(workerMetrics.recordStage).toHaveBeenCalledWith('perType.request.durationMs', 'request', 19);
        expect(workerMetrics.recordProcessed).toHaveBeenCalledWith('ingest.request', 'request', 2, 1, 1, expect.any(Number), expect.any(Number), expect.any(Number));
    });
    it('uses metadata.receivedAt as the retry-stable timestamp and identity clock', async () => {
        const { EventProcessor } = await import('./event-processor.js');
        const client = clientWithQueries();
        const pool = poolWithClient(client);
        const workerMetrics = metrics();
        const receivedAt = '2026-08-24T00:00:00.000Z';
        const receivedAtMs = Date.parse(receivedAt);
        const job = payload([{
                type: 'request',
                requestId: 'stable-request',
                timestamp: '2035-01-01T00:00:00.000Z',
                method: 'GET',
                url: '/stable',
                statusCode: 200,
                latency: 12,
            }], {
            metadata: {
                ...payload([]).metadata,
                receivedAt,
            },
        });
        mocks.writerWriteBatchDetailedInTransaction.mockResolvedValue({
            totalReceived: 1,
            totalInserted: 0,
            perType: { request: { received: 1, inserted: 0, durationMs: 1 } },
            insertedErrors: [],
        });
        const processor = new EventProcessor(pool, workerMetrics, logger(), pool);
        await processor.process(job, 'ingest.request');
        await processor.process(job, 'ingest.request');
        const first = mocks.writerWriteBatchDetailedInTransaction.mock.calls[0]?.[1]?.[0];
        const second = mocks.writerWriteBatchDetailedInTransaction.mock.calls[1]?.[1]?.[0];
        expect(first.occurredAtMs).toBe(receivedAtMs);
        expect(first.event.timestamp).toBe(receivedAtMs);
        expect(second.occurredAtMs).toBe(receivedAtMs);
        expect(second.event.eventId).toBe(first.event.eventId);
    });
    it('rejects a missing or malformed durable receipt clock before pool checkout', async () => {
        const { EventProcessor } = await import('./event-processor.js');
        const client = clientWithQueries();
        const pool = poolWithClient(client);
        const processor = new EventProcessor(pool, metrics(), logger(), pool);
        const invalid = payload([requestEvent(1)], {
            metadata: { ...payload([]).metadata, receivedAt: 'not-a-timestamp' },
        });
        await expect(processor.process(invalid, 'ingest.request')).rejects.toThrow('INVALID_RECEIVED_AT');
        expect(pool.connect).not.toHaveBeenCalled();
        expect(mocks.pgbossSend).not.toHaveBeenCalled();
    });
    it('rejects an already-aborted pg-boss job before any side effect', async () => {
        const { EventProcessor } = await import('./event-processor.js');
        const client = clientWithQueries();
        const pool = poolWithClient(client);
        const processor = new EventProcessor(pool, metrics(), logger(), pool);
        const abort = new AbortController();
        abort.abort(new Error('handler expired'));
        await expect(processor.process(payload([requestEvent(1)]), 'ingest.request', abort.signal)).rejects.toMatchObject({ code: 'INGESTION_JOB_ABORTED' });
        expect(pool.connect).not.toHaveBeenCalled();
        expect(mocks.pgbossSend).not.toHaveBeenCalled();
        expect(mocks.writerWriteBatchDetailedInTransaction).not.toHaveBeenCalled();
    });
    it('removes an expired job from write admission without checking out a connection', async () => {
        const { EventProcessor } = await import('./event-processor.js');
        const { WriteAdmissionController } = await import('../pipeline/write-admission.js');
        const client = clientWithQueries();
        const pool = poolWithClient(client);
        const admission = new WriteAdmissionController(1);
        const gate = deferred();
        const holder = admission.run(async () => gate.promise);
        await vi.waitFor(() => expect(admission.stats().inFlight).toBe(1));
        const processor = new EventProcessor(pool, metrics(), logger(), pool, admission);
        const abort = new AbortController();
        const processing = processor.process(payload([requestEvent(1)]), 'ingest.request', abort.signal);
        await vi.waitFor(() => expect(admission.stats().queued).toBe(1));
        abort.abort(new Error('handler expired while queued'));
        await expect(processing).rejects.toMatchObject({ code: 'INGESTION_JOB_ABORTED' });
        expect(pool.connect).not.toHaveBeenCalled();
        expect(admission.stats()).toEqual({ permits: 1, inFlight: 1, queued: 0 });
        gate.resolve(undefined);
        await holder;
        expect(admission.stats()).toEqual({ permits: 1, inFlight: 0, queued: 0 });
    });
    it('releases a pool checkout that arrives after connection-wait cancellation', async () => {
        const { EventProcessor } = await import('./event-processor.js');
        const client = clientWithQueries();
        const pool = poolWithClient(client);
        const checkout = deferred();
        pool.connect.mockReturnValueOnce(checkout.promise);
        const processor = new EventProcessor(pool, metrics(), logger(), pool);
        const abort = new AbortController();
        const processing = processor.process(payload([requestEvent(1)]), 'ingest.request', abort.signal);
        await vi.waitFor(() => expect(pool.connect).toHaveBeenCalledTimes(1));
        abort.abort(new Error('expired during pool checkout'));
        await expect(processing).rejects.toMatchObject({ code: 'INGESTION_JOB_ABORTED' });
        checkout.resolve(client);
        await vi.waitFor(() => expect(client.release).toHaveBeenCalledTimes(1));
        expect(mocks.writerWriteBatchDetailedInTransaction).not.toHaveBeenCalled();
    });
    it('cancels the active backend, rolls back, and releases its client when expiry fires mid-transaction', async () => {
        const { EventProcessor } = await import('./event-processor.js');
        const client = clientWithQueries();
        const pool = poolWithClient(client);
        const activeInsert = deferred();
        const cancelled = Object.assign(new Error('canceling statement due to user request'), { code: '57014' });
        const querySpy = client.query;
        querySpy.mockImplementation((sql) => {
            if (sql === 'INSERT INTO cancellation_probe DEFAULT VALUES')
                return activeInsert.promise;
            return Promise.resolve({ rows: [], rowCount: 0 });
        });
        pool.query.mockImplementation(async (sql, values) => {
            if (sql.includes('pg_cancel_backend'))
                activeInsert.reject(cancelled);
            return { rows: [{ cancelled: true }], rowCount: 1, values };
        });
        mocks.writerWriteBatchDetailedInTransaction.mockImplementationOnce(async (db) => {
            await db.query('INSERT INTO cancellation_probe DEFAULT VALUES');
            return {
                totalReceived: 1,
                totalInserted: 1,
                perType: { request: { received: 1, inserted: 1, durationMs: 1 } },
                insertedErrors: [],
            };
        });
        const log = logger();
        const processor = new EventProcessor(pool, metrics(), log, pool);
        const abort = new AbortController();
        const processing = processor.process(payload([requestEvent(1)]), 'ingest.request', abort.signal);
        await vi.waitFor(() => {
            expect(querySpy).toHaveBeenCalledWith('INSERT INTO cancellation_probe DEFAULT VALUES');
        });
        abort.abort(new Error('handler execution exceeded 300s'));
        await expect(processing).rejects.toMatchObject({
            name: 'AbortError',
            code: 'INGESTION_JOB_ABORTED',
        });
        expect(pool.query).toHaveBeenCalledWith('SELECT pg_cancel_backend($1)::boolean AS cancelled', [4242]);
        expect(querySpy).toHaveBeenCalledWith('ROLLBACK');
        expect(querySpy).not.toHaveBeenCalledWith('COMMIT');
        expect(client.release).toHaveBeenCalledTimes(1);
        expect(mocks.usageIncrement).not.toHaveBeenCalled();
        expect(log.error).toHaveBeenCalledWith(expect.objectContaining({
            failureClass: 'job_aborted',
            sqlState: '57014',
        }), 'ingestion batch transaction failed');
    });
    it('accounts committed inserts when expiry races but COMMIT reports success', async () => {
        const { EventProcessor } = await import('./event-processor.js');
        const client = clientWithQueries();
        const pool = poolWithClient(client);
        const abort = new AbortController();
        client.query.mockImplementation((sql) => {
            if (sql === 'COMMIT')
                abort.abort(new Error('expiry raced with commit completion'));
            return Promise.resolve({ rows: [], rowCount: 0 });
        });
        mocks.writerWriteBatchDetailedInTransaction.mockResolvedValueOnce({
            totalReceived: 1,
            totalInserted: 1,
            perType: { request: { received: 1, inserted: 1, durationMs: 1 } },
            insertedErrors: [],
        });
        mocks.writerAppendTelemetryOutbox.mockResolvedValueOnce(1);
        const processor = new EventProcessor(pool, metrics(), logger(), pool);
        await expect(processor.process(payload([requestEvent(1)]), 'ingest.request', abort.signal)).resolves.toMatchObject({ inserted: 1, outboxInserted: 1 });
        expect(mocks.usageIncrement).toHaveBeenCalledWith('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111', 'billing:events:request', 1);
        expect(client.release).toHaveBeenCalledTimes(1);
    });
    it('routes an actual-node oversized trace to validation DLQ before pool checkout', async () => {
        const { EventProcessor } = await import('./event-processor.js');
        const client = clientWithQueries();
        const pool = poolWithClient(client);
        const processor = new EventProcessor(pool, metrics(), logger(), pool);
        const children = Array.from({ length: 10_000 }, (_, index) => ({
            id: `child-${index}`,
            name: `child ${index}`,
        }));
        mocks.pgbossSend.mockResolvedValueOnce('dlq-trace');
        const job = payload([{
                type: 'trace',
                traceId: 'oversized-trace',
                spanCount: 1,
                rootSpan: { id: 'root', name: 'root', children },
            }], { eventType: 'trace' });
        const result = await processor.process(job, 'ingest.trace');
        expect(result).toMatchObject({ received: 1, validated: 0, rejected: 1, inserted: 0 });
        expect(pool.connect).not.toHaveBeenCalled();
        expect(mocks.pgbossSend).toHaveBeenCalledWith('ingest_dlq', expect.objectContaining({
            sourceQueue: 'ingest.trace',
            payload: [expect.objectContaining({ detail: expect.stringContaining('maximum node count 10000') })],
        }));
    });
});
//# sourceMappingURL=event-processor.test.js.map