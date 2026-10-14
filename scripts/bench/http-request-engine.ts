/**
 * Core HTTP request engine shared by every benchmark mode.
 *
 * Exercises the REAL ingestion path: real `POST /api/v1/<type>` request with
 * a real API key (X-API-Key header), through the real Fastify gateway, AJV
 * validation, IngestionService.processIngest(), pg-boss enqueue, and back to
 * a real HTTP 202/4xx/5xx response. This module never talks to the database
 * or a worker process directly — that is the metrics collector's job.
 *
 * Rate control is implemented as a token-bucket style scheduler: at a target
 * rate of R events/sec split into batches of size B, the loop fires
 * ceil(R/B) batch requests per second, sleeping the remainder of the mean
 * inter-request wait between each. This is intentionally simple (no external
 * scheduler dependency) and its own overhead is measured (`schedulerDriftMs`)
 * so a report can distinguish "the target didn't keep up" from "the
 * generator itself couldn't fire fast enough."
 */
import { performance } from 'perf_hooks';
import { buildBatch, DuplicateTracker, type ProfileSpec, type SdkEventType, pickType } from './workload-profiles.js';

export interface HttpTarget {
  baseUrl: string;
  apiKey: string;
  /** Typed endpoint path, e.g. /v1/logs. Empty string uses the mixed /v1/ingest endpoint. */
  requestTimeoutMs: number;
}

export interface RequestOutcome {
  atMs: number;
  type: SdkEventType;
  batchSize: number;
  offered: number;
  accepted: number;
  rejected: number;
  httpStatus: number | null;
  latencyMs: number;
  error: string | null;
  duplicatesSent: number;
}

export interface FireBatchOptions {
  target: HttpTarget;
  type: SdkEventType;
  events: Record<string, unknown>[];
  duplicatesSent: number;
}

const TYPE_TO_PATH: Record<SdkEventType, string> = {
  error: '/v1/errors',
  request: '/v1/requests',
  trace: '/v1/traces',
  span: '/v1/spans',
  metric: '/v1/metrics',
  log: '/v1/logs',
  profile: '/v1/profiles',
  message: '/v1/events',
  cron_checkin: '/v1/checkins',
  replay: '/v1/replays',
};

export async function fireBatch(opts: FireBatchOptions): Promise<RequestOutcome> {
  const atMs = Date.now();
  const start = performance.now();
  const path = TYPE_TO_PATH[opts.type];
  const url = `${opts.target.baseUrl.replace(/\/+$/, '')}/api${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.target.requestTimeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': opts.target.apiKey,
      },
      body: JSON.stringify({ events: opts.events }),
    });
    const latencyMs = performance.now() - start;
    let accepted = 0;
    let rejected = 0;
    try {
      const body = (await res.json()) as { accepted?: number; rejected?: number };
      accepted = typeof body.accepted === 'number' ? body.accepted : 0;
      rejected = typeof body.rejected === 'number' ? body.rejected : 0;
    } catch {
      // Non-JSON response (e.g. 5xx from a proxy) — treat as fully rejected.
      rejected = opts.events.length;
    }
    return {
      atMs,
      type: opts.type,
      batchSize: opts.events.length,
      offered: opts.events.length,
      accepted,
      rejected,
      httpStatus: res.status,
      latencyMs,
      error: res.ok ? null : `HTTP ${res.status}`,
      duplicatesSent: opts.duplicatesSent,
    };
  } catch (err) {
    const latencyMs = performance.now() - start;
    return {
      atMs,
      type: opts.type,
      batchSize: opts.events.length,
      offered: opts.events.length,
      accepted: 0,
      rejected: opts.events.length,
      httpStatus: null,
      latencyMs,
      error: err instanceof Error ? err.message : String(err),
      duplicatesSent: opts.duplicatesSent,
    };
  } finally {
    clearTimeout(timer);
  }
}

export interface DriverOptions {
  target: HttpTarget;
  profile: ProfileSpec;
  /** Target offered events per second. */
  ratePerSecond: number;
  /** Events per HTTP batch (bounded by INGESTION_MAX_BATCH_SIZE=1000 upstream, not enforced here). */
  batchSize: number;
  durationMs: number;
  /** Called on every completed request; used to feed live stop-condition checks in ramp mode. */
  onOutcome?: (outcome: RequestOutcome) => void;
  /** Max concurrent in-flight HTTP requests, to avoid an unbounded fan-out if the target stalls. */
  maxConcurrency: number;
  duplicateTracker: DuplicateTracker;
}

export interface DriverResult {
  outcomes: RequestOutcome[];
  offeredEvents: number;
  acceptedEvents: number;
  rejectedEvents: number;
  duplicatesSent: number;
  wallMs: number;
  schedulerDriftMs: number;
}

/**
 * Run the request-firing loop for `durationMs` at `ratePerSecond`, calling
 * `onOutcome` for every completed batch so a caller (e.g. the ramp
 * controller) can react to live results without waiting for the whole
 * window to finish.
 */
export async function runFixedRate(opts: DriverOptions): Promise<DriverResult> {
  const outcomes: RequestOutcome[] = [];
  const startedAt = performance.now();
  const batchesPerSecond = Math.max(1, Math.ceil(opts.ratePerSecond / opts.batchSize));
  const intervalMs = 1000 / batchesPerSecond;
  let inFlight = 0;
  let offeredEvents = 0;
  let acceptedEvents = 0;
  let rejectedEvents = 0;
  let duplicatesSent = 0;
  let nextFireAt = startedAt;
  let scheduledDriftMs = 0;

  const inFlightPromises = new Set<Promise<void>>();

  while (performance.now() - startedAt < opts.durationMs) {
    const now = performance.now();
    if (now < nextFireAt) {
      await sleep(nextFireAt - now);
    }
    const actualNow = performance.now();
    scheduledDriftMs += Math.max(0, actualNow - nextFireAt);
    nextFireAt += intervalMs;

    if (inFlight >= opts.maxConcurrency) {
      // Backpressure from the generator side itself: wait for the oldest
      // in-flight request rather than growing an unbounded queue of promises.
      await Promise.race(inFlightPromises);
      continue;
    }

    const type = pickType(opts.profile);
    const { events, duplicateCount } = buildBatch(type, opts.batchSize, opts.profile, opts.duplicateTracker);
    inFlight += 1;
    const task = fireBatch({ target: opts.target, type, events, duplicatesSent: duplicateCount }).then((outcome) => {
      inFlight -= 1;
      outcomes.push(outcome);
      offeredEvents += outcome.offered;
      acceptedEvents += outcome.accepted;
      rejectedEvents += outcome.rejected;
      duplicatesSent += outcome.duplicatesSent;
      opts.onOutcome?.(outcome);
    });
    const wrapped = task.finally(() => inFlightPromises.delete(wrapped));
    inFlightPromises.add(wrapped);
  }

  await Promise.all(inFlightPromises);
  const wallMs = performance.now() - startedAt;

  return {
    outcomes,
    offeredEvents,
    acceptedEvents,
    rejectedEvents,
    duplicatesSent,
    wallMs,
    schedulerDriftMs: scheduledDriftMs,
  };
}

function sleep(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

// ── Quantile helpers ─────────────────────────────────────────────────────────

export interface Quantiles {
  count: number;
  min: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  mean: number;
}

export function quantiles(values: number[]): Quantiles {
  if (values.length === 0) {
    return { count: 0, min: 0, p50: 0, p95: 0, p99: 0, max: 0, mean: 0 };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const pick = (q: number): number => {
    const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
    return sorted[idx] ?? 0;
  };
  const sum = sorted.reduce((total, v) => total + v, 0);
  return {
    count: sorted.length,
    min: sorted[0] ?? 0,
    p50: pick(0.5),
    p95: pick(0.95),
    p99: pick(0.99),
    max: sorted[sorted.length - 1] ?? 0,
    mean: sum / sorted.length,
  };
}
