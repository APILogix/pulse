/**
 * In-process runtime guards for connector delivery: a sliding-window rate
 * limiter and a circuit breaker, both keyed per connector id.
 *
 * These are intentionally in-process (no Redis) to match the project's
 * Redis-light posture for control-plane concerns. In a multi-process
 * deployment each process enforces its own share; for strict global limits a
 * shared store would be required (documented tradeoff).
 */

// ── Sliding-window rate limiter ────────────────────────────────────────────
interface Window {
  timestamps: number[];
}

const windows = new Map<string, Window>();

export interface RateCheck {
  allowed: boolean;
  retryAfterMs: number;
}

/**
 * Allow at most `limit` events per `windowSeconds` for a given key.
 * Returns whether the call is allowed and, if not, how long until the oldest
 * event ages out of the window.
 */
export function checkRateLimit(key: string, limit: number, windowSeconds: number): RateCheck {
  const now = Date.now();
  const windowMs = windowSeconds * 1000;
  let w = windows.get(key);
  if (!w) {
    w = { timestamps: [] };
    windows.set(key, w);
  }
  // Drop timestamps outside the window.
  const cutoff = now - windowMs;
  w.timestamps = w.timestamps.filter((t) => t > cutoff);

  if (w.timestamps.length >= limit) {
    const oldest = w.timestamps[0]!;
    return { allowed: false, retryAfterMs: Math.max(0, oldest + windowMs - now) };
  }
  w.timestamps.push(now);
  return { allowed: true, retryAfterMs: 0 };
}

/** Periodically evict empty windows so the map does not grow unbounded. */
export function sweepRateLimiter(): void {
  const now = Date.now();
  for (const [key, w] of windows) {
    if (w.timestamps.length === 0 || w.timestamps[w.timestamps.length - 1]! < now - 3_600_000) {
      windows.delete(key);
    }
  }
}

// ── Circuit breaker ─────────────────────────────────────────────────────────
type CircuitState = 'closed' | 'open' | 'half_open';

interface Circuit {
  state: CircuitState;
  failures: number;
  openedAt: number;
}

export interface CircuitBreakerOptions {
  failureThreshold: number;
  resetTimeoutMs: number;
}

const circuits = new Map<string, Circuit>();

const DEFAULTS: CircuitBreakerOptions = { failureThreshold: 5, resetTimeoutMs: 30_000 };

function getCircuit(key: string): Circuit {
  let c = circuits.get(key);
  if (!c) {
    c = { state: 'closed', failures: 0, openedAt: 0 };
    circuits.set(key, c);
  }
  return c;
}

/**
 * Returns true if a call is permitted. When the circuit is open but the reset
 * timeout has elapsed, it transitions to half-open and permits a single trial.
 */
export function circuitAllows(key: string, opts: Partial<CircuitBreakerOptions> = {}): boolean {
  const { resetTimeoutMs } = { ...DEFAULTS, ...opts };
  const c = getCircuit(key);
  if (c.state === 'open') {
    if (Date.now() - c.openedAt >= resetTimeoutMs) {
      c.state = 'half_open';
      return true;
    }
    return false;
  }
  return true;
}

export function recordCircuitSuccess(key: string): void {
  const c = getCircuit(key);
  c.failures = 0;
  c.state = 'closed';
  c.openedAt = 0;
}

export function recordCircuitFailure(key: string, opts: Partial<CircuitBreakerOptions> = {}): void {
  const { failureThreshold } = { ...DEFAULTS, ...opts };
  const c = getCircuit(key);
  c.failures += 1;
  if (c.state === 'half_open' || c.failures >= failureThreshold) {
    c.state = 'open';
    c.openedAt = Date.now();
  }
}

export function getCircuitState(key: string): CircuitState {
  return circuits.get(key)?.state ?? 'closed';
}

/** Compute exponential backoff with full jitter. */
export function computeBackoffMs(
  attempt: number,
  baseMs: number,
  multiplier: number,
  capMs = 300_000,
): number {
  const exp = Math.min(capMs, baseMs * Math.pow(multiplier, Math.max(0, attempt)));
  // Full jitter: random between 0 and exp, floored at a small minimum.
  return Math.max(250, Math.floor(Math.random() * exp));
}
