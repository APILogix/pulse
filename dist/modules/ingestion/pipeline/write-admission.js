/**
 * write-admission.ts — bounded FIFO admission control for ingest DB writes.
 *
 * WHY THIS EXISTS (measured problem, not a precaution)
 * ---------------------------------------------------
 * The ingestion worker registers one pg-boss worker per SDK event type:
 *
 *   SDK_EVENT_TYPES(10) x INGESTION_TYPE_WORKER_CONCURRENCY x INGESTION_TYPE_WORKER_BATCH_SIZE
 *
 * Every one of those job handlers calls `pool.connect()` on the telemetry pool
 * and holds that connection for the whole BEGIN..COMMIT. With the previous
 * defaults (10 x 8 x 4 = 320 concurrent handlers) against a telemetry pool of
 * `LOG_POOL_MAX` = 10, demand exceeded supply by 32x. The consequences were
 * all measurable in the `ingestion batch profile` log:
 *
 *   1. `dbConnectionWaitMs` dominated total processing time — handlers were
 *      queueing inside `pg`'s pool waiter list, not doing work.
 *   2. Waiters that exceeded `connectionTimeoutMillis` (30s) threw
 *      "timeout exceeded when trying to connect". `failureReason()` classifies
 *      that as `db_connection`, so the job FAILED, was retried (retryLimit 3,
 *      exponential backoff) and eventually dead-lettered — pure amplification
 *      of an overload condition into more load.
 *   3. Because `pg` pool waiters are not FIFO-fair across queues, a burst on
 *      one event type could starve every other type (head-of-line blocking).
 *
 * WHAT THIS DOES
 * --------------
 * A single process-wide semaphore bounds how many ingest transactions may be
 * in flight at once, sized from the telemetry pool so it is *structurally
 * impossible* to oversubscribe the pool. Jobs above the limit wait here — in
 * memory, FIFO, with no timeout — instead of racing on a pool acquire that
 * fails after 30 seconds.
 *
 * This is deliberately NOT "raise the pool size". Raising the pool without
 * bounding demand just moves the contention into PostgreSQL, where each
 * additional backend costs memory and CPU scheduling. Bounding demand to match
 * capacity is the change that makes P99 predictable.
 *
 * PROPERTIES
 * ----------
 * - FIFO: waiters are served in arrival order, so no job can be starved and
 *   latency is bounded by (queue position / permits) * per-job duration.
 * - No timeout: waiting is cheap and correct. Timing out here would recreate
 *   the exact failure mode we are removing. Overload is signalled upstream by
 *   the gateway's queue-depth backpressure, not by failing accepted work.
 * - Release-safe: `run()` releases in `finally`, so a throwing handler can
 *   never leak a permit and deadlock the tier.
 * - Observable: `stats()` exposes permits/in-flight/queued so saturation is
 *   visible in metrics rather than inferred from latency.
 */
import { IngestionJobAbortedError, throwIfIngestionAborted, } from './ingestion-abort.js';
export class WriteAdmissionController {
    permits;
    inFlight = 0;
    waiters = [];
    constructor(permits) {
        if (!Number.isFinite(permits) || permits < 1) {
            throw new Error(`WriteAdmissionController requires permits >= 1, received ${String(permits)}`);
        }
        this.permits = Math.trunc(permits);
    }
    /**
     * Run `fn` while holding one admission permit. Acquires FIFO, always
     * releases. The awaited duration before `fn` starts is returned to the caller
     * via `onAdmitted` so it can be recorded as `admissionWaitMs` separately from
     * real database time. An aborted waiter is removed synchronously and can
     * never consume a future permit.
     */
    async run(fn, onAdmitted, signal) {
        const startedAt = Date.now();
        let acquired = false;
        try {
            await this.acquire(signal);
            acquired = true;
            // Covers an abort delivered after acquire() resolved but before this
            // continuation ran. The finally block still releases the acquired slot.
            throwIfIngestionAborted(signal, 'write admission');
            onAdmitted?.(Date.now() - startedAt);
            return await fn();
        }
        finally {
            if (acquired)
                this.release();
        }
    }
    acquire(signal) {
        throwIfIngestionAborted(signal, 'write admission');
        if (this.inFlight < this.permits) {
            this.inFlight += 1;
            return Promise.resolve();
        }
        return new Promise((resolve, reject) => {
            const waiter = {
                state: 'queued',
                resolve,
                reject,
                ...(signal ? { signal } : {}),
            };
            if (signal) {
                waiter.onAbort = () => {
                    if (waiter.state !== 'queued')
                        return;
                    const index = this.waiters.indexOf(waiter);
                    if (index >= 0)
                        this.waiters.splice(index, 1);
                    waiter.state = 'aborted';
                    this.removeAbortListener(waiter);
                    reject(new IngestionJobAbortedError('write admission', signal.reason));
                };
                signal.addEventListener('abort', waiter.onAbort, { once: true });
            }
            this.waiters.push(waiter);
            // Abort dispatch is synchronous, but recheck defensively in case a
            // non-standard signal implementation changed state during registration.
            if (signal?.aborted)
                waiter.onAbort?.();
        });
    }
    release() {
        while (this.waiters.length > 0) {
            const next = this.waiters.shift();
            if (next.state !== 'queued')
                continue;
            if (next.signal?.aborted) {
                next.state = 'aborted';
                this.removeAbortListener(next);
                next.reject(new IngestionJobAbortedError('write admission', next.signal.reason));
                continue;
            }
            // Hand the permit straight to the next waiter: inFlight is unchanged, so
            // the count can never transiently exceed `permits`.
            next.state = 'admitted';
            this.removeAbortListener(next);
            next.resolve();
            return;
        }
        this.inFlight = Math.max(0, this.inFlight - 1);
    }
    removeAbortListener(waiter) {
        if (waiter.signal && waiter.onAbort) {
            waiter.signal.removeEventListener('abort', waiter.onAbort);
        }
    }
    stats() {
        return { permits: this.permits, inFlight: this.inFlight, queued: this.waiters.length };
    }
}
/**
 * Derive the safe permit count for a telemetry write pool.
 *
 * We reserve headroom so that pool capacity is never fully consumed by batch
 * transactions: the same pool still serves the health probe, the outbox reader
 * and any ad-hoc maintenance query. A pool with zero free connections turns
 * those into 30-second hangs.
 *
 * `configured` (INGESTION_WRITE_CONCURRENCY) is an upper bound the operator
 * asks for; the pool is the hard physical limit. We take the minimum, so
 * misconfiguration can under-use the pool but never oversubscribe it.
 */
export function resolveWritePermits(configured, poolMax) {
    // Both inputs are validated rather than trusted. `poolMax` is read off a live
    // `pg.Pool` (`pool.options.max`), which is untyped at runtime and absent when a
    // caller passes a stubbed pool, and `configured` comes from env that may be
    // partially stubbed in tests. A NaN reaching the constructor would throw and
    // take down the whole worker on boot, so degrade to a safe default instead.
    const safePoolMax = Number.isFinite(poolMax) && poolMax >= 1
        ? Math.trunc(poolMax)
        : DEFAULT_WRITE_PERMITS;
    const reserve = safePoolMax >= 8 ? 2 : 1;
    const poolCeiling = Math.max(1, safePoolMax - reserve);
    const requested = Number.isFinite(configured) && configured >= 1
        ? Math.trunc(configured)
        : poolCeiling;
    return Math.max(1, Math.min(requested, poolCeiling));
}
/**
 * Fallback ceiling when neither the pool nor the config reports a usable size.
 * Matches the historical `LOG_POOL_MAX` default of 10, so a stubbed or
 * misreporting pool behaves exactly as the pre-admission code did.
 */
const DEFAULT_WRITE_PERMITS = 10;
//# sourceMappingURL=write-admission.js.map