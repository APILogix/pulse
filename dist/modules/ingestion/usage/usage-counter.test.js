import { describe, expect, it, vi } from 'vitest';
import { UsageCounter } from './usage-counter.js';
function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}
function logger() {
    return {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    };
}
function increment(counter, suffix, by = 1) {
    counter.increment(`22222222-2222-4222-8222-${suffix.padStart(12, '0')}`, '11111111-1111-4111-8111-111111111111', 'events', by, { eventType: 'request' });
}
function isSchema(sql) {
    return String(sql).includes('CREATE UNLOGGED TABLE IF NOT EXISTS usage_counter_staging');
}
function isInsert(sql) {
    return String(sql).includes('INSERT INTO usage_counter_staging');
}
describe('UsageCounter flush and shutdown correctness', () => {
    it('uses one authoritative flush while schema setup is still awaiting', async () => {
        const schema = deferred();
        const query = vi.fn((sql) => {
            if (isSchema(sql))
                return schema.promise;
            return Promise.resolve({ rows: [], rowCount: 1 });
        });
        const counter = new UsageCounter({ query }, logger(), {
            driveRollup: false,
            bufferLimit: 100,
        });
        increment(counter, '1', 2);
        const first = counter.flush();
        const second = counter.flush();
        expect(second).toBe(first);
        expect(query.mock.calls.filter(([sql]) => isSchema(sql))).toHaveLength(1);
        schema.resolve({ rows: [], rowCount: 0 });
        await Promise.all([first, second]);
        expect(query.mock.calls.filter(([sql]) => isInsert(sql))).toHaveLength(1);
    });
    it('performs a follow-up drain for counts added during an active flush', async () => {
        const firstInsert = deferred();
        let inserts = 0;
        const query = vi.fn((sql) => {
            if (isSchema(sql))
                return Promise.resolve({ rows: [], rowCount: 0 });
            if (isInsert(sql)) {
                inserts += 1;
                if (inserts === 1)
                    return firstInsert.promise;
                return Promise.resolve({ rows: [], rowCount: 1 });
            }
            return Promise.resolve({ rows: [], rowCount: 0 });
        });
        const counter = new UsageCounter({ query }, logger(), {
            driveRollup: false,
            bufferLimit: 100,
        });
        increment(counter, '1');
        const first = counter.flush();
        await vi.waitFor(() => expect(inserts).toBe(1));
        increment(counter, '2');
        const joined = counter.flush();
        firstInsert.resolve({ rows: [], rowCount: 1 });
        await Promise.all([first, joined]);
        expect(inserts).toBe(2);
    });
    it('merges a failed snapshot back exactly once and stop retries the combined count', async () => {
        const failure = new Error('primary unavailable');
        let insertAttempt = 0;
        const insertParams = [];
        const log = logger();
        const query = vi.fn((sql, params) => {
            if (isSchema(sql))
                return Promise.resolve({ rows: [], rowCount: 0 });
            if (isInsert(sql)) {
                insertAttempt += 1;
                insertParams.push(params ?? []);
                if (insertAttempt === 1)
                    return Promise.reject(failure);
                return Promise.resolve({ rows: [], rowCount: 1 });
            }
            return Promise.resolve({ rows: [], rowCount: 0 });
        });
        const counter = new UsageCounter({ query }, log, {
            driveRollup: false,
            bufferLimit: 100,
        });
        increment(counter, '1', 2);
        await expect(counter.flush()).rejects.toBe(failure);
        increment(counter, '1', 3);
        await expect(counter.stop()).resolves.toBeUndefined();
        expect(insertAttempt).toBe(2);
        // One six-parameter tuple; increment_by is the final parameter.
        expect(insertParams[1]?.[5]).toBe(5);
        expect(log.warn).toHaveBeenCalledWith(expect.objectContaining({
            err: failure,
            bufferedEntries: 1,
            bufferLimit: 100,
            overLimitBy: 0,
        }), 'UsageCounter staging flush failed; counts re-buffered');
    });
    it('stop awaits the active snapshot and every count accumulated behind it', async () => {
        const firstInsert = deferred();
        const secondInsert = deferred();
        let insertAttempt = 0;
        const query = vi.fn((sql) => {
            if (isSchema(sql))
                return Promise.resolve({ rows: [], rowCount: 0 });
            if (isInsert(sql)) {
                insertAttempt += 1;
                return insertAttempt === 1 ? firstInsert.promise : secondInsert.promise;
            }
            return Promise.resolve({ rows: [], rowCount: 0 });
        });
        const counter = new UsageCounter({ query }, logger(), {
            driveRollup: false,
            bufferLimit: 100,
        });
        increment(counter, '1');
        const active = counter.flush();
        await vi.waitFor(() => expect(insertAttempt).toBe(1));
        increment(counter, '2');
        let stopped = false;
        const stopping = counter.stop().then(() => {
            stopped = true;
        });
        firstInsert.resolve({ rows: [], rowCount: 1 });
        await vi.waitFor(() => expect(insertAttempt).toBe(2));
        expect(stopped).toBe(false);
        secondInsert.resolve({ rows: [], rowCount: 1 });
        await Promise.all([active, stopping]);
        expect(stopped).toBe(true);
        expect(insertAttempt).toBe(2);
        // A stopped counter never accepts a late post-drain increment.
        increment(counter, '3');
        await counter.flush();
        expect(insertAttempt).toBe(2);
    });
    it('propagates a failed final drain instead of logging false shutdown success', async () => {
        const failure = new Error('staging insert failed');
        const log = logger();
        const query = vi.fn((sql) => {
            if (isSchema(sql))
                return Promise.resolve({ rows: [], rowCount: 0 });
            if (isInsert(sql))
                return Promise.reject(failure);
            return Promise.resolve({ rows: [], rowCount: 0 });
        });
        const counter = new UsageCounter({ query }, log, {
            driveRollup: false,
            bufferLimit: 100,
        });
        increment(counter, '1');
        await expect(counter.stop()).rejects.toBe(failure);
        expect(log.info).not.toHaveBeenCalledWith('UsageCounter stopped (final flush complete)');
    });
});
//# sourceMappingURL=usage-counter.test.js.map