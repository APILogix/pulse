import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgQueue } from './pg-queue.js';
vi.mock('../../../config/logger.js', () => ({
    logger: {
        child: vi.fn(() => ({
            warn: vi.fn(),
            error: vi.fn(),
            info: vi.fn(),
            debug: vi.fn(),
        })),
    },
}));
function client() {
    return {
        query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
        release: vi.fn(),
    };
}
function poolWith(clientOrQuery) {
    if (typeof clientOrQuery === 'function') {
        return {
            query: clientOrQuery,
            connect: vi.fn(),
        };
    }
    return {
        connect: vi.fn().mockResolvedValue(clientOrQuery),
        query: vi.fn(),
    };
}
function job(overrides = {}) {
    return {
        id: 'job-1',
        queue: 'ingestion',
        jobType: 'request',
        priority: 50,
        orgId: 'org-1',
        projectId: 'proj-1',
        payload: { events: [{ eventId: 'evt-1' }] },
        attempts: 1,
        maxAttempts: 3,
        dedupeKey: 'dedupe-1',
        ...overrides,
    };
}
describe('PgQueue failure and replay behavior', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });
    it('reschedules retryable failures with bounded exponential backoff', async () => {
        vi.spyOn(Math, 'random').mockReturnValue(0);
        const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 1 });
        const queue = new PgQueue(poolWith(query), { baseBackoffMs: 1000, maxBackoffMs: 5000 });
        const outcome = await queue.fail(job({ attempts: 2, maxAttempts: 3 }), 'temporary db timeout', 'ETIMEDOUT');
        expect(outcome).toBe('retried');
        expect(query).toHaveBeenCalledTimes(1);
        expect(query.mock.calls[0]?.[0]).toContain('SET state =');
        expect(query.mock.calls[0]?.[0]).toContain("state = 'pending'");
        expect(query.mock.calls[0]?.[1]).toEqual(['job-1', 2000, 'temporary db timeout', 'ETIMEDOUT']);
    });
    it('moves exhausted failures to dead letter in one transaction', async () => {
        const db = client();
        const queue = new PgQueue(poolWith(db));
        const outcome = await queue.fail(job({ attempts: 3, maxAttempts: 3 }), 'permanent validation failure', 'VALIDATION');
        expect(outcome).toBe('dead-lettered');
        expect(db.query).toHaveBeenNthCalledWith(1, 'BEGIN');
        expect(db.query.mock.calls[1]?.[0]).toContain('INSERT INTO ingestion_dead_letter_jobs');
        expect(db.query.mock.calls[2]?.[0]).toContain("SET state = 'failed'");
        expect(db.query).toHaveBeenLastCalledWith('COMMIT');
        expect(db.release).toHaveBeenCalledTimes(1);
    });
    it('rolls back and releases the client if dead-letter persistence fails', async () => {
        const db = client();
        db.query
            .mockResolvedValueOnce({ rows: [], rowCount: 0 })
            .mockRejectedValueOnce(new Error('dlq insert failed'))
            .mockResolvedValueOnce({ rows: [], rowCount: 0 });
        const queue = new PgQueue(poolWith(db));
        await expect(queue.fail(job({ attempts: 3, maxAttempts: 3 }), 'fatal', 'ERR')).rejects.toThrow('dlq insert failed');
        expect(db.query).toHaveBeenCalledWith('BEGIN');
        expect(db.query).toHaveBeenCalledWith('ROLLBACK');
        expect(db.query).not.toHaveBeenCalledWith('COMMIT');
        expect(db.release).toHaveBeenCalledTimes(1);
    });
    it('replays a dead-letter row atomically and marks it replayed', async () => {
        const db = client();
        db.query
            .mockResolvedValueOnce({ rows: [], rowCount: 0 })
            .mockResolvedValueOnce({
            rows: [{
                    queue: 'ingestion',
                    job_type: 'request',
                    org_id: 'org-1',
                    project_id: 'proj-1',
                    payload: { events: [] },
                    dedupe_key: 'dedupe-1',
                }],
            rowCount: 1,
        })
            .mockResolvedValueOnce({ rows: [{ id: 'replayed-job-1' }], rowCount: 1 })
            .mockResolvedValueOnce({ rows: [], rowCount: 1 })
            .mockResolvedValueOnce({ rows: [], rowCount: 0 });
        const queue = new PgQueue(poolWith(db));
        const replayedJobId = await queue.replayDeadLetter('dlq-1', 'operator-1');
        expect(replayedJobId).toBe('replayed-job-1');
        expect(db.query).toHaveBeenNthCalledWith(1, 'BEGIN');
        expect(db.query.mock.calls[1]?.[0]).toContain('FOR UPDATE');
        expect(db.query.mock.calls[2]?.[0]).toContain('INSERT INTO ingestion_jobs');
        expect(db.query.mock.calls[3]?.[0]).toContain('replayed_at = NOW()');
        expect(db.query).toHaveBeenLastCalledWith('COMMIT');
        expect(db.release).toHaveBeenCalledTimes(1);
    });
    it('returns null and rolls back when replay target is missing or already replayed', async () => {
        const db = client();
        db.query
            .mockResolvedValueOnce({ rows: [], rowCount: 0 })
            .mockResolvedValueOnce({ rows: [], rowCount: 0 })
            .mockResolvedValueOnce({ rows: [], rowCount: 0 });
        const queue = new PgQueue(poolWith(db));
        const replayedJobId = await queue.replayDeadLetter('missing-dlq', 'operator-1');
        expect(replayedJobId).toBeNull();
        expect(db.query).toHaveBeenCalledWith('BEGIN');
        expect(db.query).toHaveBeenCalledWith('ROLLBACK');
        expect(db.query).not.toHaveBeenCalledWith('COMMIT');
        expect(db.release).toHaveBeenCalledTimes(1);
    });
});
//# sourceMappingURL=pg-queue.test.js.map