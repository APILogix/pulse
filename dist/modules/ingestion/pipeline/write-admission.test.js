/**
 * write-admission.test.ts
 *
 * The admission controller is the ceiling that makes ingest DB concurrency
 * predictable. A bug here does not merely degrade throughput — it deadlocks the
 * entire ingestion tier, because a leaked permit is unrecoverable without a
 * process restart. So the invariants are covered directly rather than inferred
 * from integration behaviour.
 *
 * Invariants under test:
 *   1. Concurrency never exceeds `permits`.
 *   2. Permits are released on the failure path (no leak on throw).
 *   3. Waiters are served FIFO (no starvation).
 *   4. `resolveWritePermits` can never oversubscribe the pool, and never yields
 *      NaN/0 for malformed input.
 *
 * Deliberately timer-free: every wait below is a microtask flush or an
 * explicitly-controlled deferred, so the tests are deterministic and never race
 * a real clock.
 */
import { describe, expect, it } from 'vitest';
import { WriteAdmissionController, resolveWritePermits } from './write-admission.js';
/** Yield the microtask queue enough times for queued continuations to settle. */
async function flush(times = 8) {
    for (let i = 0; i < times; i += 1)
        await Promise.resolve();
}
/** A promise plus its resolver, for holding permits open on demand. */
function deferred() {
    let resolve;
    const promise = new Promise((res) => {
        resolve = res;
    });
    return { promise, resolve };
}
describe('WriteAdmissionController', () => {
    it('never allows more than `permits` concurrent runs', async () => {
        const controller = new WriteAdmissionController(3);
        let concurrent = 0;
        let peak = 0;
        await Promise.all(Array.from({ length: 25 }, () => controller.run(async () => {
            concurrent += 1;
            peak = Math.max(peak, concurrent);
            // Yield so other tasks get a chance to run; if the semaphore were
            // broken, `concurrent` would climb past 3 here.
            await flush();
            concurrent -= 1;
        })));
        expect(peak).toBe(3);
        expect(concurrent).toBe(0);
        // Fully drained: no permit retained, no waiter orphaned.
        expect(controller.stats()).toEqual({ permits: 3, inFlight: 0, queued: 0 });
    });
    it('releases the permit when the task throws, so a failing batch cannot wedge the tier', async () => {
        const controller = new WriteAdmissionController(1);
        await expect(controller.run(async () => {
            throw new Error('insert failed');
        })).rejects.toThrow('insert failed');
        // If the failure path leaked the sole permit, this would never resolve.
        await expect(controller.run(async () => 'recovered')).resolves.toBe('recovered');
        expect(controller.stats().inFlight).toBe(0);
    });
    it('serves waiters FIFO so no job is starved', async () => {
        const controller = new WriteAdmissionController(1);
        const order = [];
        const gate = deferred();
        // Occupy the only permit.
        const first = controller.run(async () => {
            await gate.promise;
        });
        await flush();
        // Queue five contenders behind it.
        const contenders = [1, 2, 3, 4, 5].map((n) => controller.run(async () => {
            order.push(n);
        }));
        expect(controller.stats().queued).toBe(5);
        gate.resolve();
        await Promise.all([first, ...contenders]);
        expect(order).toEqual([1, 2, 3, 4, 5]);
    });
    it('reports in-flight and queued depth while saturated', async () => {
        const controller = new WriteAdmissionController(2);
        const gate = deferred();
        const tasks = Array.from({ length: 5 }, () => controller.run(async () => {
            await gate.promise;
        }));
        await flush();
        expect(controller.stats()).toEqual({ permits: 2, inFlight: 2, queued: 3 });
        gate.resolve();
        await Promise.all(tasks);
        expect(controller.stats()).toEqual({ permits: 2, inFlight: 0, queued: 0 });
    });
    it('reports the admission wait to the caller so it can be measured separately from DB time', async () => {
        const controller = new WriteAdmissionController(1);
        const gate = deferred();
        const waits = [];
        const first = controller.run(async () => { await gate.promise; }, (ms) => waits.push(ms));
        await flush();
        const second = controller.run(async () => undefined, (ms) => waits.push(ms));
        gate.resolve();
        await Promise.all([first, second]);
        // Both callbacks fired exactly once, in admission order.
        expect(waits).toHaveLength(2);
        expect(waits[0]).toBeGreaterThanOrEqual(0);
        expect(waits[1]).toBeGreaterThanOrEqual(0);
    });
    it('rejects an already-aborted job before acquiring a permit', async () => {
        const controller = new WriteAdmissionController(1);
        const abort = new AbortController();
        const fn = async () => 'should not run';
        abort.abort(new Error('pg-boss expiry'));
        await expect(controller.run(fn, undefined, abort.signal)).rejects.toMatchObject({
            name: 'AbortError',
            code: 'INGESTION_JOB_ABORTED',
        });
        expect(controller.stats()).toEqual({ permits: 1, inFlight: 0, queued: 0 });
    });
    it('removes an aborted FIFO waiter without consuming or leaking the permit', async () => {
        const controller = new WriteAdmissionController(1);
        const gate = deferred();
        const holder = controller.run(async () => gate.promise);
        await flush();
        const abort = new AbortController();
        const queuedFn = async () => 'should not run';
        const queued = controller.run(queuedFn, undefined, abort.signal);
        await flush();
        expect(controller.stats()).toEqual({ permits: 1, inFlight: 1, queued: 1 });
        abort.abort(new Error('handler expired'));
        await expect(queued).rejects.toMatchObject({ code: 'INGESTION_JOB_ABORTED' });
        expect(controller.stats()).toEqual({ permits: 1, inFlight: 1, queued: 0 });
        gate.resolve();
        await holder;
        await expect(controller.run(async () => 'next')).resolves.toBe('next');
        expect(controller.stats()).toEqual({ permits: 1, inFlight: 0, queued: 0 });
    });
    it('rejects a nonsensical permit count instead of silently allowing unbounded writes', () => {
        expect(() => new WriteAdmissionController(0)).toThrow(/permits >= 1/);
        expect(() => new WriteAdmissionController(Number.NaN)).toThrow(/permits >= 1/);
    });
});
describe('resolveWritePermits', () => {
    it('reserves pool headroom so batch writes never consume the last connection', () => {
        // pool 20 - 2 reserved = 18 ceiling; a request for 16 fits under it.
        expect(resolveWritePermits(16, 20)).toBe(16);
        // A small pool reserves 1 instead of 2.
        expect(resolveWritePermits(16, 4)).toBe(3);
    });
    it('clamps a request that would oversubscribe the pool', () => {
        // The pool is the hard physical limit: asking for 100 permits on a pool of
        // 10 must not produce 100 handlers fighting over 10 connections.
        expect(resolveWritePermits(100, 10)).toBe(8);
    });
    it('degrades safely for malformed input rather than returning NaN', () => {
        // `pool.options.max` is untyped at runtime and absent for stubbed pools.
        // Returning NaN here would throw in the constructor and fail worker boot.
        expect(resolveWritePermits(undefined, undefined)).toBe(8);
        expect(resolveWritePermits(Number.NaN, Number.NaN)).toBe(8);
        expect(resolveWritePermits(0, 10)).toBe(8);
        expect(resolveWritePermits(16, 1)).toBe(1);
    });
    it('always returns at least 1 so ingestion can never be fully blocked', () => {
        for (const poolMax of [1, 2, 3, 8, 10, 20, 200]) {
            expect(resolveWritePermits(1, poolMax)).toBeGreaterThanOrEqual(1);
        }
    });
});
//# sourceMappingURL=write-admission.test.js.map