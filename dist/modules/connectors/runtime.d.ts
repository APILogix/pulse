/**
 * In-process runtime guards for connector delivery: a sliding-window rate
 * limiter and a circuit breaker, both keyed per connector id.
 *
 * These are intentionally in-process (no Redis) to match the project's
 * Redis-light posture for control-plane concerns. In a multi-process
 * deployment each process enforces its own share; for strict global limits a
 * shared store would be required (documented tradeoff).
 */
export interface RateCheck {
    allowed: boolean;
    retryAfterMs: number;
}
/**
 * Allow at most `limit` events per `windowSeconds` for a given key.
 * Returns whether the call is allowed and, if not, how long until the oldest
 * event ages out of the window.
 */
export declare function checkRateLimit(key: string, limit: number, windowSeconds: number): RateCheck;
/** Periodically evict empty windows so the map does not grow unbounded. */
export declare function sweepRateLimiter(): void;
type CircuitState = 'closed' | 'open' | 'half_open';
export interface CircuitBreakerOptions {
    failureThreshold: number;
    resetTimeoutMs: number;
}
/**
 * Returns true if a call is permitted. When the circuit is open but the reset
 * timeout has elapsed, it transitions to half-open and permits a single trial.
 */
export declare function circuitAllows(key: string, opts?: Partial<CircuitBreakerOptions>): boolean;
export declare function recordCircuitSuccess(key: string): void;
export declare function recordCircuitFailure(key: string, opts?: Partial<CircuitBreakerOptions>): void;
export declare function getCircuitState(key: string): CircuitState;
/** Compute exponential backoff with full jitter. */
export declare function computeBackoffMs(attempt: number, baseMs: number, multiplier: number, capMs?: number): number;
export {};
//# sourceMappingURL=runtime.d.ts.map