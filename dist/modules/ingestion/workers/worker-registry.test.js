import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
    pgbossSend: vi.fn(),
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
        send: mocks.pgbossSend,
        work: vi.fn(),
        offWork: vi.fn(),
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
        }), 'ingest.request');
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