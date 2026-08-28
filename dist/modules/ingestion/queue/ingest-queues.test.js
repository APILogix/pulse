import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
    pgbossCreateQueue: vi.fn(),
    pgbossInsert: vi.fn(),
    pgbossSend: vi.fn(),
}));
vi.mock('../../../lib/pgboss.js', () => ({
    pgboss: {
        createQueue: mocks.pgbossCreateQueue,
        insert: mocks.pgbossInsert,
        send: mocks.pgbossSend,
    },
}));
import { ALL_INGEST_QUEUES, INGEST_DLQ_INTAKE_QUEUE, INGEST_USAGE_ROLLUP_QUEUE, enqueueIngestJobs, ingestQueueDepth, ingestQueueOptions, provisionIngestQueues, } from './ingest-queues.js';
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
    mocks.pgbossCreateQueue.mockReset();
    mocks.pgbossCreateQueue.mockResolvedValue(undefined);
    mocks.pgbossInsert.mockReset();
    mocks.pgbossSend.mockReset();
});
describe('ingestQueueOptions', () => {
    it('opts ingestion queues into pg-boss partitioning and listen/notify wakeups', () => {
        expect(ingestQueueOptions()).toMatchObject({
            partition: true,
            notify: true,
        });
    });
});
describe('queue provisioning', () => {
    it('creates the DLQ before source queues that reference it', async () => {
        await provisionIngestQueues();
        const names = mocks.pgbossCreateQueue.mock.calls.map((call) => call[0]);
        expect(names).toEqual([
            INGEST_DLQ_INTAKE_QUEUE,
            ...ALL_INGEST_QUEUES,
            INGEST_USAGE_ROLLUP_QUEUE,
        ]);
        for (const sourceQueue of ALL_INGEST_QUEUES) {
            expect(mocks.pgbossCreateQueue).toHaveBeenCalledWith(sourceQueue, expect.objectContaining({ deadLetter: INGEST_DLQ_INTAKE_QUEUE }));
        }
    });
    it('propagates unexpected createQueue failures and stops provisioning', async () => {
        const error = new Error('queue catalog unavailable');
        mocks.pgbossCreateQueue.mockRejectedValueOnce(error);
        await expect(provisionIngestQueues()).rejects.toBe(error);
        expect(mocks.pgbossCreateQueue).toHaveBeenCalledTimes(1);
        expect(mocks.pgbossCreateQueue).toHaveBeenCalledWith(INGEST_DLQ_INTAKE_QUEUE, expect.objectContaining({ partition: true, notify: true }));
    });
});
describe('enqueueIngestJobs', () => {
    it('reports bounded per-queue enqueue timings for bulk inserts', async () => {
        mocks.pgbossInsert.mockResolvedValueOnce(['job-1', 'job-2']);
        const result = await enqueueIngestJobs([
            job('ingest.request', 'request', 200),
            job('ingest.request', 'request', 201),
        ]);
        expect(result.enqueuedEvents).toBe(2);
        expect(result.jobIds).toEqual(['job-1', 'job-2']);
        expect(result.queues).toEqual([
            expect.objectContaining({
                queue: 'ingest.request',
                jobs: 2,
                events: 2,
                bulk: true,
                fallback: false,
            }),
        ]);
        expect(result.queues[0]?.durationMs).toEqual(expect.any(Number));
        expect(mocks.pgbossSend).not.toHaveBeenCalled();
    });
    it('reports per-queue bulk timing so one slow queue can be isolated', async () => {
        mocks.pgbossInsert
            .mockResolvedValueOnce(['request-1', 'request-2'])
            .mockResolvedValueOnce(['error-1']);
        const result = await enqueueIngestJobs([
            job('ingest.request', 'request', 200),
            job('ingest.error', 'error', 500),
            job('ingest.request', 'request', 201),
        ]);
        expect(result.enqueuedEvents).toBe(3);
        expect(result.jobIds).toEqual(['request-1', 'request-2', 'error-1']);
        expect(mocks.pgbossInsert).toHaveBeenCalledTimes(2);
        expect(mocks.pgbossInsert.mock.calls[0]?.[0]).toBe('ingest.request');
        expect(mocks.pgbossInsert.mock.calls[0]?.[1]).toHaveLength(2);
        expect(mocks.pgbossInsert.mock.calls[1]?.[0]).toBe('ingest.error');
        expect(mocks.pgbossInsert.mock.calls[1]?.[1]).toHaveLength(1);
        expect(result.queues).toEqual([
            expect.objectContaining({
                queue: 'ingest.request',
                jobs: 2,
                events: 2,
                bulk: true,
                fallback: false,
            }),
            expect.objectContaining({
                queue: 'ingest.error',
                jobs: 1,
                events: 1,
                bulk: true,
                fallback: false,
            }),
        ]);
        expect(result.queues.every((queue) => Number.isFinite(queue.durationMs))).toBe(true);
        expect(mocks.pgbossSend).not.toHaveBeenCalled();
    });
    it('reports fallback timing and counts when pg-boss bulk insert fails', async () => {
        mocks.pgbossInsert.mockRejectedValueOnce(new Error('bulk blocked'));
        mocks.pgbossSend
            .mockResolvedValueOnce('fallback-1')
            .mockResolvedValueOnce('fallback-2');
        const result = await enqueueIngestJobs([
            job('ingest.request', 'request', 200),
            job('ingest.request', 'request', 201),
        ]);
        expect(result.enqueuedEvents).toBe(2);
        expect(result.jobIds).toEqual(['fallback-1', 'fallback-2']);
        expect(mocks.pgbossInsert).toHaveBeenCalledTimes(1);
        expect(mocks.pgbossSend).toHaveBeenCalledTimes(2);
        expect(result.queues).toEqual([
            expect.objectContaining({
                queue: 'ingest.request',
                jobs: 2,
                events: 2,
                bulk: false,
                fallback: true,
            }),
        ]);
        expect(result.queues[0]?.durationMs).toEqual(expect.any(Number));
    });
});
describe('ingestQueueDepth', () => {
    it('separates total pending depth from runnable and deferred pending jobs', async () => {
        const pool = {
            query: vi
                .fn()
                .mockResolvedValueOnce({
                rows: [
                    {
                        name: 'ingest.error',
                        state: 'created',
                        n: 3,
                        ready: 2,
                        deferred: 1,
                        oldest_pending_age_ms: '12000',
                    },
                    {
                        name: 'ingest.trace',
                        state: 'retry',
                        n: 4,
                        ready: 1,
                        deferred: 3,
                        oldest_pending_age_ms: 5000,
                    },
                    {
                        name: 'ingest.span',
                        state: 'active',
                        n: 2,
                        ready: 0,
                        deferred: 0,
                        oldest_pending_age_ms: null,
                    },
                    {
                        name: 'ingest.log',
                        state: 'failed',
                        n: 1,
                        ready: 0,
                        deferred: 0,
                        oldest_pending_age_ms: null,
                    },
                ],
            })
                .mockResolvedValueOnce({
                rows: [
                    { queue: 'ingest.error', n: 2 },
                    { queue: 'ingest.trace', n: 1 },
                ],
            }),
        };
        const depth = await ingestQueueDepth(pool);
        expect(depth.pending).toBe(7);
        expect(depth.ready).toBe(3);
        expect(depth.deferred).toBe(4);
        expect(depth.active).toBe(2);
        expect(depth.failed).toBe(1);
        expect(depth.deadLettered).toBe(3);
        expect(depth.oldestPendingAgeMs).toBe(12000);
        expect(depth.perQueue[0]).toEqual({
            queue: 'ingest.error',
            state: 'created',
            count: 3,
            ready: 2,
            deferred: 1,
            oldestPendingAgeMs: 12000,
        });
        expect(depth.dlqPerQueue).toEqual([
            { queue: 'ingest.error', count: 2 },
            { queue: 'ingest.trace', count: 1 },
        ]);
        expect(pool.query).toHaveBeenCalledTimes(2);
    });
});
//# sourceMappingURL=ingest-queues.test.js.map