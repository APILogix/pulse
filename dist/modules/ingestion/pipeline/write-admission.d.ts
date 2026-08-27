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
export interface WriteAdmissionStats {
    /** Maximum concurrent ingest transactions allowed. */
    permits: number;
    /** Permits currently held. */
    inFlight: number;
    /** Handlers waiting for a permit. */
    queued: number;
}
export declare class WriteAdmissionController {
    private readonly permits;
    private inFlight;
    private readonly waiters;
    constructor(permits: number);
    /**
     * Run `fn` while holding one admission permit. Acquires FIFO, always
     * releases. The awaited duration before `fn` starts is returned to the caller
     * via `onAdmitted` so it can be recorded as `admissionWaitMs` separately from
     * real database time.
     */
    run<T>(fn: () => Promise<T>, onAdmitted?: (waitedMs: number) => void): Promise<T>;
    private acquire;
    private release;
    stats(): WriteAdmissionStats;
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
export declare function resolveWritePermits(configured: number | undefined, poolMax: number | undefined): number;
//# sourceMappingURL=write-admission.d.ts.map