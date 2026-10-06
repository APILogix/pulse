import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
    pgmqCreateQueue: vi.fn(),
    pgmqCreateQueues: vi.fn(),
    pgmqSendBatch: vi.fn(),
    pgmqSend: vi.fn(),
    pgmqMetricsAll: vi.fn(),
    pgmqFetchKnownQueues: vi.fn(),
}));
vi.mock('../../../lib/pgmq.js', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        pgmq: {
            createQueue: mocks.pgmqCreateQueue,
            createQueues: mocks.pgmqCreateQueues,
            sendBatch: mocks.pgmqSendBatch,
            send: mocks.pgmqSend,
            metricsAll: mocks.pgmqMetricsAll,
            fetchKnownQueues: mocks.pgmqFetchKnownQueues,
        },
    };
});
import { ALL_INGEST_QUEUES, INGEST_DLQ_INTAKE_QUEUE, INGEST_USAGE_ROLLUP_QUEUE, enqueueIngestJobs, ingestQueueDepth, provisionIngestQueues, } from './ingest-queues.js';
function job(queue, eventType = 'request', statusCode = 200) {
    return {
        queue,
        priority: 5,
        payload: {
            eventType,
            organizationId: 'org_1',
            projectId: 'project_1',
            apiKeyId: 'api_key_1',
            apiKeyName: 'test key',
            environment: 'production',
            metadata: { batchId: 'batch_1', receivedAt: new Date(0).toISOString() },
            events: [{ type: eventType, method: 'GET', url: '/', statusCode }],
        },
    };
}
beforeEach(() => {
    mocks.pgmqCreateQueue.mockReset();
    mocks.pgmqCreateQueue.mockResolvedValue(undefined);
    mocks.pgmqCreateQueues.mockReset();
    mocks.pgmqCreateQueues.mockResolvedValue(undefined);
    mocks.pgmqSendBatch.mockReset();
    mocks.pgmqSend.mockReset();
    mocks.pgmqMetricsAll.mockReset();
    mocks.pgmqMetricsAll.mockResolvedValue([]);
    mocks.pgmqFetchKnownQueues.mockReset();
    mocks.pgmqFetchKnownQueues.mockResolvedValue(new Set());
});
describe('queue provisioning', () => {
    it('creates the DLQ and all ingest queues using bounded concurrency', async () => {
        await provisionIngestQueues();
        expect(mocks.pgmqCreateQueues).toHaveBeenCalledWith([
            INGEST_DLQ_INTAKE_QUEUE,
            ...ALL_INGEST_QUEUES,
            INGEST_USAGE_ROLLUP_QUEUE,
        ], { concurrency: 4 });
    });
    it('propagates unexpected createQueues failures and stops provisioning', async () => {
        const error = new Error('queue catalog unavailable');
        mocks.pgmqCreateQueues.mockRejectedValueOnce(error);
        await expect(provisionIngestQueues()).rejects.toBe(error);
        expect(mocks.pgmqCreateQueues).toHaveBeenCalledTimes(1);
    });
});
describe('enqueueIngestJobs', () => {
    it('reports bounded per-queue enqueue timings for bulk sends', async () => {
        mocks.pgmqSendBatch.mockResolvedValueOnce(['job-1', 'job-2']);
        const result = await enqueueIngestJobs([
            job('ingest_request', 'request', 200),
            job('ingest_request', 'request', 201),
        ]);
        expect(result.enqueuedEvents).toBe(2);
        expect(result.jobIds).toEqual(['job-1', 'job-2']);
        expect(result.queues).toEqual([
            expect.objectContaining({
                queue: 'ingest_request',
                jobs: 2,
                events: 2,
                bulk: true,
                fallback: false,
                durationMs: expect.any(Number),
            }),
        ]);
    });
    it('reports per-queue bulk timing so one slow queue can be isolated', async () => {
        mocks.pgmqSendBatch.mockResolvedValueOnce(['request-1', 'request-2']);
        mocks.pgmqSendBatch.mockResolvedValueOnce(['error-1']);
        const result = await enqueueIngestJobs([
            job('ingest_request', 'request', 200),
            job('ingest_request', 'request', 201),
            job('ingest_error', 'error', 500),
        ]);
        expect(result.enqueuedEvents).toBe(3);
        expect(result.jobIds).toEqual(['request-1', 'request-2', 'error-1']);
        expect(mocks.pgmqSendBatch).toHaveBeenCalledTimes(2);
        expect(mocks.pgmqSendBatch.mock.calls[0]?.[0]).toBe('ingest_request');
        expect(mocks.pgmqSendBatch.mock.calls[1]?.[0]).toBe('ingest_error');
        expect(result.queues).toHaveLength(2);
    });
    it('reports fallback timing and counts when PGMQ sendBatch fails', async () => {
        mocks.pgmqSendBatch.mockRejectedValueOnce(new Error('bulk blocked'));
        mocks.pgmqSend.mockResolvedValueOnce('fallback-1');
        mocks.pgmqSend.mockResolvedValueOnce('fallback-2');
        const result = await enqueueIngestJobs([
            job('ingest_request', 'request', 200),
            job('ingest_request', 'request', 201),
        ]);
        expect(result.enqueuedEvents).toBe(2);
        expect(result.jobIds).toEqual(['fallback-1', 'fallback-2']);
        expect(mocks.pgmqSendBatch).toHaveBeenCalledTimes(1);
        expect(mocks.pgmqSend).toHaveBeenCalledTimes(2);
        expect(result.queues).toEqual([
            expect.objectContaining({
                queue: 'ingest_request',
                jobs: 2,
                events: 2,
                bulk: false,
                fallback: true,
                durationMs: expect.any(Number),
            }),
        ]);
    });
});
describe('ingestQueueDepth', () => {
    it('reads PGMQ queue depth metrics', async () => {
        mocks.pgmqMetricsAll.mockResolvedValueOnce([
            {
                queueName: 'ingest_request',
                queueLength: 7,
                queueVisibleLength: 3,
                oldestMsgAgeSec: 15,
                newestMsgAgeSec: 1,
                totalMessages: 100,
                scrapeTime: new Date(),
            },
            {
                queueName: 'ingest_error',
                queueLength: 2,
                queueVisibleLength: 2,
                oldestMsgAgeSec: 5,
                newestMsgAgeSec: 0,
                totalMessages: 50,
                scrapeTime: new Date(),
            },
        ]);
        const fakePool = {
            query: vi.fn().mockResolvedValue({
                rows: [{ queue: 'ingest_request', n: 1 }],
            }),
        };
        const depth = await ingestQueueDepth(fakePool);
        expect(depth.pending).toBe(9);
        expect(depth.ready).toBe(5);
        expect(depth.active).toBe(4);
        expect(depth.deadLettered).toBe(1);
        expect(depth.oldestPendingAgeMs).toBe(15000);
        expect(depth.perEventType).toBeDefined();
        const perType = depth.perEventType;
        expect(perType.request.status).toBe('inserting');
        expect(perType.request.pending).toBe(3);
        expect(perType.request.inserting).toBe(4);
        expect(perType.request.total).toBe(7);
        expect(perType.request.failed).toBe(1);
        expect(perType.error.status).toBe('pending');
        expect(perType.error.pending).toBe(2);
        expect(perType.error.inserting).toBe(0);
        expect(perType.error.total).toBe(2);
        expect(perType.span.status).toBe('idle');
        expect(perType.span.pending).toBe(0);
        expect(perType.span.inserting).toBe(0);
    });
});
//# sourceMappingURL=ingest-queues.test.js.map