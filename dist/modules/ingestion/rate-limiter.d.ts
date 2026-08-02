/**
 * In-process token-bucket rate limiter for ingestion.
 *
 * Why this exists:
 *   The ingestion service is the hottest path in the app. Hitting Redis or
 *   Postgres on every event is too expensive, so we bound enqueue volume
 *   per-project with a process-local limiter. The platform-level limit is the
 *   sum across PM2 cluster workers; that is fine for the "shed obvious abuse"
 *   tier this code is responsible for. Hard, exact tenant limits belong in
 *   billing/usage and are enforced separately.
 *
 * Design properties:
 *   - Atomic check-and-increment: one synchronous call returns the decision
 *     AND advances the counters, so two concurrent requests can never both
 *     pass when only one slot remains.
 *   - Bounded memory: stale buckets (no traffic for `ttlMs`) are pruned by a
 *     periodic sweep. Without this, the Map grows for the lifetime of the
 *     process and becomes a memory leak in any system with churning tenants.
 *   - Bounded entry count: a hard cap protects against pathological cases
 *     (e.g. an attacker creating many keys); when the cap is reached the
 *     oldest-touched buckets are evicted before insert.
 *
 * Concurrency note:
 *   Node.js runs one event-loop task at a time, so the read-then-write inside
 *   `tryConsume` is atomic for our purposes — there is no JS preemption point
 *   between the comparison and the increment. The race condition the previous
 *   implementation had came from spreading the read/check/increment across
 *   awaited boundaries; this version keeps everything synchronous.
 */
export interface RateLimiterOptions {
    /** Bucket idle TTL before sweeper drops it. */
    ttlMs: number;
    /** How often the sweeper runs. */
    sweepIntervalMs: number;
    /** Hard cap on the number of buckets retained. Defends against key churn. */
    maxEntries?: number;
}
export interface RateLimitDecision {
    allowed: boolean;
    /** Reason a request was rejected, if any. */
    reason?: 'per_second' | 'per_minute';
    /** Remaining requests in the current 1s window after this call. */
    perSecondRemaining: number;
    /** Remaining requests in the current 1m window after this call. */
    perMinuteRemaining: number;
}
export declare class IngestionRateLimiter {
    private readonly buckets;
    private readonly ttlMs;
    private readonly maxEntries;
    private sweepTimer;
    constructor(opts: RateLimiterOptions);
    /**
     * Atomically check the bucket and (if allowed) increment it. The decision
     * and the increment cannot be split by another task in this runtime.
     */
    tryConsume(key: string, perSecond: number, perMinute: number, weight?: number): RateLimitDecision;
    /** Drop a single bucket — used when a tenant is paused/deleted. */
    evict(key: string): void;
    /** Drop all buckets — used at shutdown. */
    clear(): void;
    /** Stop the sweeper and release the timer reference. */
    dispose(): void;
    /** Number of tracked buckets — exposed for observability. */
    size(): number;
    /**
     * Drop buckets idle longer than ttlMs. O(n) but n is bounded by
     * `maxEntries` and only runs on `sweepIntervalMs`, which is far slower than
     * the request path.
     */
    private sweep;
    /**
     * When the max-entry cap is reached, drop the single least-recently-touched
     * bucket to make room. This is a defense, not the primary cleanup path.
     */
    private evictOldest;
}
//# sourceMappingURL=rate-limiter.d.ts.map