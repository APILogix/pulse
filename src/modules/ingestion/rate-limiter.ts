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

interface Bucket {
  /** UNIX seconds bucket the secCount is for. */
  secWindow: number;
  /** UNIX minutes bucket the minCount is for. */
  minWindow: number;
  secCount: number;
  minCount: number;
  /** Last touch (ms). Used by the sweeper to drop idle buckets. */
  lastTouchedMs: number;
}

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

export class IngestionRateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private sweepTimer: NodeJS.Timeout | null = null;

  constructor(opts: RateLimiterOptions) {
    this.ttlMs = opts.ttlMs;
    this.maxEntries = opts.maxEntries ?? 100_000;

    // Periodic sweep prevents unbounded growth. unref() so this timer never
    // holds the process alive.
    this.sweepTimer = setInterval(() => this.sweep(), opts.sweepIntervalMs);
    this.sweepTimer.unref?.();
  }

  /**
   * Atomically check the bucket and (if allowed) increment it. The decision
   * and the increment cannot be split by another task in this runtime.
   */
  tryConsume(
    key: string,
    perSecond: number,
    perMinute: number,
    weight = 1,
  ): RateLimitDecision {
    const units = Math.max(1, Math.trunc(weight));
    const now = Date.now();
    const sec = Math.floor(now / 1000);
    const min = Math.floor(now / 60_000);

    let bucket = this.buckets.get(key);
    if (!bucket) {
      // Defend against unbounded growth before the next sweep.
      if (this.buckets.size >= this.maxEntries) {
        this.evictOldest();
      }
      bucket = {
        secWindow: sec,
        minWindow: min,
        secCount: 0,
        minCount: 0,
        lastTouchedMs: now,
      };
      this.buckets.set(key, bucket);
    }

    if (bucket.secWindow !== sec) {
      bucket.secWindow = sec;
      bucket.secCount = 0;
    }
    if (bucket.minWindow !== min) {
      bucket.minWindow = min;
      bucket.minCount = 0;
    }

    bucket.lastTouchedMs = now;

    if (bucket.secCount + units > perSecond) {
      return {
        allowed: false,
        reason: 'per_second',
        perSecondRemaining: 0,
        perMinuteRemaining: Math.max(0, perMinute - bucket.minCount),
      };
    }
    if (bucket.minCount + units > perMinute) {
      return {
        allowed: false,
        reason: 'per_minute',
        perSecondRemaining: Math.max(0, perSecond - bucket.secCount),
        perMinuteRemaining: 0,
      };
    }

    bucket.secCount += units;
    bucket.minCount += units;
    return {
      allowed: true,
      perSecondRemaining: Math.max(0, perSecond - bucket.secCount),
      perMinuteRemaining: Math.max(0, perMinute - bucket.minCount),
    };
  }

  /** Drop a single bucket — used when a tenant is paused/deleted. */
  evict(key: string): void {
    this.buckets.delete(key);
  }

  /** Drop all buckets — used at shutdown. */
  clear(): void {
    this.buckets.clear();
  }

  /** Stop the sweeper and release the timer reference. */
  dispose(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
    this.buckets.clear();
  }

  /** Number of tracked buckets — exposed for observability. */
  size(): number {
    return this.buckets.size;
  }

  /**
   * Drop buckets idle longer than ttlMs. O(n) but n is bounded by
   * `maxEntries` and only runs on `sweepIntervalMs`, which is far slower than
   * the request path.
   */
  private sweep(): void {
    const cutoff = Date.now() - this.ttlMs;
    for (const [key, bucket] of this.buckets) {
      if (bucket.lastTouchedMs < cutoff) {
        this.buckets.delete(key);
      }
    }
  }

  /**
   * When the max-entry cap is reached, drop the single least-recently-touched
   * bucket to make room. This is a defense, not the primary cleanup path.
   */
  private evictOldest(): void {
    let oldestKey: string | null = null;
    let oldestTs = Number.POSITIVE_INFINITY;
    for (const [key, bucket] of this.buckets) {
      if (bucket.lastTouchedMs < oldestTs) {
        oldestTs = bucket.lastTouchedMs;
        oldestKey = key;
      }
    }
    if (oldestKey !== null) {
      this.buckets.delete(oldestKey);
    }
  }
}
