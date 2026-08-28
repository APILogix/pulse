import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
    pgbossCreateQueue: vi.fn(),
    pgbossSend: vi.fn(),
    pgbossWork: vi.fn(),
    pgbossOffWork: vi.fn(),
    processorProcess: vi.fn(),
    metrics: {
        setWorkerInFlight: vi.fn(),
        setOrgInFlight: vi.fn(),
        recordDeferred: vi.fn(),
        recordFairnessProcessed: vi.fn(),
        recordFairnessStarvationAdmission: vi.fn(),
        recordFailed: vi.fn(),
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
vi.mock('../../../lib/pgboss.js', () => ({
    pgboss: {
        createQueue: mocks.pgbossCreateQueue,
        send: mocks.pgbossSend,
        work: mocks.pgbossWork,
        offWork: mocks.pgbossOffWork,
    },
}));
vi.mock('./event-processor.js', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        EventProcessor: vi.fn(function EventProcessorMock() {
            this.process = mocks.processorProcess;
            this.start = vi.fn();
            this.stop = vi.fn();
        }),
    };
});
vi.mock('./usage-rollup.js', () => ({
    UsageRollup: vi.fn(function UsageRollupMock() {
        this.start = vi.fn();
        this.stop = vi.fn();
    }),
}));
vi.mock('./metrics-server.js', () => ({
    WorkerMetrics: vi.fn(function WorkerMetricsMock() {
        Object.assign(this, mocks.metrics);
        this.setWorkerCapacity = vi.fn();
        this.recordRetry = vi.fn();
        this.recordStage = vi.fn();
        this.recordDlqIntake = vi.fn();
    }),
    MetricsServer: vi.fn(function MetricsServerMock() {
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
function pool() {
    return {
        query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
        connect: vi.fn(),
    };
}
function payload(overrides = {}) {
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
        mocks.pgbossCreateQueue.mockResolvedValue(undefined);
        mocks.pgbossWork.mockResolvedValue(undefined);
        mocks.pgbossOffWork.mockResolvedValue(undefined);
    });
    it('allows a clean retry after queue provisioning fails', async () => {
        const { WorkerRegistry } = await import('./worker-registry.js');
        const registry = new WorkerRegistry(pool(), logger());
        const provisioningError = new Error('queue database unavailable');
        mocks.pgbossCreateQueue.mockRejectedValueOnce(provisioningError);
        await expect(registry.start()).rejects.toBe(provisioningError);
        expect(mocks.pgbossWork).not.toHaveBeenCalled();
        await expect(registry.start()).resolves.toBeUndefined();
        expect(mocks.pgbossCreateQueue.mock.calls[0]?.[0]).toBe('ingest.dlq-intake');
        expect(mocks.pgbossCreateQueue.mock.calls[1]?.[0]).toBe('ingest.dlq-intake');
        expect(mocks.pgbossWork).toHaveBeenCalledTimes(11);
    });
    it('retains failed offWork cleanup and blocks replacement registration until cleanup succeeds', async () => {
        const { WorkerRegistry } = await import('./worker-registry.js');
        const registry = new WorkerRegistry(pool(), logger());
        const registrationError = new Error('partial worker registration');
        const initialCleanupError = new Error('initial offWork failed');
        const retryCleanupError = new Error('retry offWork failed');
        mocks.pgbossWork.mockRejectedValueOnce(registrationError);
        mocks.pgbossOffWork
            .mockRejectedValueOnce(initialCleanupError)
            .mockRejectedValueOnce(retryCleanupError);
        await expect(registry.start()).rejects.toBe(registrationError);
        const provisionCallsAfterFailure = mocks.pgbossCreateQueue.mock.calls.length;
        expect(mocks.pgbossWork).toHaveBeenCalledTimes(1);
        expect(mocks.pgbossOffWork).toHaveBeenCalledTimes(1);
        await expect(registry.start()).rejects.toBe(retryCleanupError);
        expect(mocks.pgbossCreateQueue).toHaveBeenCalledTimes(provisionCallsAfterFailure);
        expect(mocks.pgbossWork).toHaveBeenCalledTimes(1);
        expect(mocks.pgbossOffWork).toHaveBeenCalledTimes(2);
        await expect(registry.start()).resolves.toBeUndefined();
        expect(mocks.pgbossOffWork).toHaveBeenCalledTimes(3);
        expect(mocks.pgbossWork).toHaveBeenCalledTimes(12);
        expect(mocks.pgbossOffWork.mock.invocationCallOrder[2]).toBeLessThan(mocks.pgbossCreateQueue.mock.invocationCallOrder[provisionCallsAfterFailure]);
    });
    it('defers an over-budget tenant job by re-enqueueing an aged copy', async () => {
        const { WorkerRegistry } = await import('./worker-registry.js');
        const registry = new WorkerRegistry(pool(), logger());
        const orgInFlight = registry;
        orgInFlight.inFlight.set('11111111-1111-4111-8111-111111111111', 2);
        mocks.pgbossSend.mockResolvedValueOnce('deferred-job-id');
        const output = await registry.runOne('ingest.request', 'request', payload());
        expect(output).toEqual({ deferred: true, deferCount: 1 });
        expect(mocks.processorProcess).not.toHaveBeenCalled();
        expect(mocks.pgbossSend).toHaveBeenCalledWith('ingest.request', expect.objectContaining({
            metadata: expect.objectContaining({ deferCount: 1 }),
        }), {
            startAfter: 5,
            priority: 275,
        });
        expect(mocks.metrics.recordDeferred).toHaveBeenCalledWith('ingest.request', 2);
        expect(mocks.metrics.recordFairnessProcessed).not.toHaveBeenCalled();
        expect(mocks.metrics.setWorkerInFlight).toHaveBeenLastCalledWith('ingest.request', 'request', 0);
        expect(orgInFlight.inFlight.get('11111111-1111-4111-8111-111111111111')).toBe(2);
    });
    it('admits an over-budget tenant after max defers and records starvation guard', async () => {
        const { WorkerRegistry } = await import('./worker-registry.js');
        const registry = new WorkerRegistry(pool(), logger());
        const orgInFlight = registry;
        orgInFlight.inFlight.set('11111111-1111-4111-8111-111111111111', 2);
        mocks.processorProcess.mockResolvedValueOnce(undefined);
        const output = await registry.runOne('ingest.request', 'request', payload({
            metadata: {
                ...payload().metadata,
                deferCount: 3,
            },
        }));
        expect(output).toEqual({ deferred: false, deferCount: 3 });
        expect(mocks.pgbossSend).not.toHaveBeenCalled();
        expect(mocks.metrics.recordFairnessStarvationAdmission).toHaveBeenCalledWith('ingest.request', 'request');
        expect(mocks.processorProcess).toHaveBeenCalledWith(expect.objectContaining({
            metadata: expect.objectContaining({ deferCount: 3 }),
        }), 'ingest.request', undefined);
        expect(mocks.metrics.recordFairnessProcessed).toHaveBeenCalledTimes(1);
        expect(mocks.metrics.setOrgInFlight).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111', 3);
        expect(mocks.metrics.setOrgInFlight).toHaveBeenLastCalledWith('11111111-1111-4111-8111-111111111111', 2);
        expect(orgInFlight.inFlight.get('11111111-1111-4111-8111-111111111111')).toBe(2);
    });
    it('releases org and worker in-flight gauges when processing fails', async () => {
        const { WorkerRegistry } = await import('./worker-registry.js');
        const registry = new WorkerRegistry(pool(), logger());
        const orgInFlight = registry;
        mocks.processorProcess.mockRejectedValueOnce(new Error('db unavailable'));
        await expect(registry.runOne('ingest.request', 'request', payload())).rejects.toThrow('db unavailable');
        expect(mocks.metrics.recordFairnessProcessed).not.toHaveBeenCalled();
        expect(mocks.metrics.setOrgInFlight).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111', 1);
        expect(mocks.metrics.setOrgInFlight).toHaveBeenLastCalledWith('11111111-1111-4111-8111-111111111111', 0);
        expect(mocks.metrics.setWorkerInFlight).toHaveBeenLastCalledWith('ingest.request', 'request', 0);
        expect(orgInFlight.inFlight.has('11111111-1111-4111-8111-111111111111')).toBe(false);
    });
    it('classifies Postgres lock timeout failures separately from connection failures', async () => {
        const { WorkerRegistry } = await import('./worker-registry.js');
        const registry = new WorkerRegistry(pool(), logger());
        const err = Object.assign(new Error('canceling statement due to lock timeout'), { code: '55P03' });
        mocks.processorProcess.mockRejectedValueOnce(err);
        await expect(registry.handleIngestBatch('ingest.request', 'request', [{
                id: 'job-1',
                data: payload(),
                retryCount: 0,
                createdOn: new Date(),
            }])).rejects.toThrow('lock timeout');
        expect(mocks.metrics.recordFailed).toHaveBeenCalledWith('ingest.request', 2, 'request', 'db_lock_timeout');
    });
    it('does not process or fairness-reenqueue a job already aborted by pg-boss', async () => {
        const { WorkerRegistry } = await import('./worker-registry.js');
        const registry = new WorkerRegistry(pool(), logger());
        const abort = new AbortController();
        abort.abort(new Error('handler execution exceeded 300s'));
        await expect(registry.runOne('ingest.request', 'request', payload(), abort.signal)).rejects.toMatchObject({
            code: 'INGESTION_JOB_ABORTED',
        });
        expect(mocks.processorProcess).not.toHaveBeenCalled();
        expect(mocks.pgbossSend).not.toHaveBeenCalled();
        expect(mocks.metrics.setWorkerInFlight).not.toHaveBeenCalled();
    });
    it('forwards the delivered pg-boss AbortSignal to EventProcessor', async () => {
        const { WorkerRegistry } = await import('./worker-registry.js');
        const registry = new WorkerRegistry(pool(), logger());
        const abort = new AbortController();
        mocks.processorProcess.mockResolvedValueOnce(undefined);
        const outcomes = await registry.handleIngestBatch('ingest.request', 'request', [{
                id: 'job-with-signal',
                data: payload(),
                signal: abort.signal,
                retryCount: 0,
                createdOn: new Date(),
            }]);
        expect(outcomes).toEqual([
            expect.objectContaining({ id: 'job-with-signal', status: 'completed' }),
        ]);
        expect(mocks.processorProcess).toHaveBeenCalledWith(expect.any(Object), 'ingest.request', abort.signal);
    });
    it('classifies Postgres statement timeout failures separately', async () => {
        const { WorkerRegistry } = await import('./worker-registry.js');
        const registry = new WorkerRegistry(pool(), logger());
        const err = Object.assign(new Error('canceling statement due to statement timeout'), { code: '57014' });
        mocks.processorProcess.mockRejectedValueOnce(err);
        await expect(registry.handleIngestBatch('ingest.request', 'request', [{
                id: 'job-1',
                data: payload(),
                retryCount: 0,
                createdOn: new Date(),
            }])).rejects.toThrow('statement timeout');
        expect(mocks.metrics.recordFailed).toHaveBeenCalledWith('ingest.request', 2, 'request', 'db_statement_timeout');
    });
});
//# sourceMappingURL=worker-registry.test.js.map