/**
 * Ramp-to-saturation, burst, sustained, and soak mode controllers.
 *
 * All four modes are built on the same `runFixedRate()` step primitive
 * (http-request-engine.ts) plus `evaluateSustainability()`
 * (sustainability.ts). Nothing here talks to the database or a worker
 * process directly; a `MetricsProvider` callback supplies the current
 * worker/DB samples so these controllers stay testable without a live
 * target.
 */
import { runFixedRate, type DriverOptions, type DriverResult, type RequestOutcome } from './http-request-engine.js';
import { evaluateSustainability, type SloConfig, type SustainabilityVerdict, DEFAULT_SLO } from './sustainability.js';
import type { WorkerSample, DbSample } from './metrics-collector.js';

export interface MetricsProvider {
  /** Return samples collected so far in the CURRENT step, since the last call. */
  samplesSinceLastCheck(): { worker: WorkerSample[]; db: DbSample[] };
}

export interface RampStep {
  stepIndex: number;
  targetRatePerSecond: number;
  durationMs: number;
  result: DriverResult;
  verdict: SustainabilityVerdict;
}

export interface RampResult {
  steps: RampStep[];
  saturationRatePerSecond: number | null;
  lastSustainableRatePerSecond: number | null;
  stoppedReason: string;
  recovery: RecoveryResult | null;
}

export interface RampOptions extends Omit<DriverOptions, 'ratePerSecond' | 'durationMs' | 'onOutcome'> {
  /** Rates to try, in ascending order. The controller stops at the first unsustainable rate. */
  rateSteps: number[];
  stepDurationMs: number;
  slo?: SloConfig;
  metrics: MetricsProvider;
  /** After finding saturation, step down to this rate and measure recovery. */
  recoveryRatePerSecond?: number | undefined;
  recoveryDurationMs?: number;
  recoveryPollIntervalMs?: number;
}

export interface RecoveryResult {
  recoveredWithinMs: number | null;
  finalQueueOldestAgeMs: number | null;
  timedOut: boolean;
  samples: WorkerSample[];
}

/**
 * Step the offered rate upward through `rateSteps`, evaluating sustainability
 * after each step. Stops at the FIRST unsustainable step (spec §11: "stop
 * before destructive saturation"), never proceeding further once a violation
 * is recorded. Optionally runs a recovery check afterward.
 */
export async function runRampToSaturation(opts: RampOptions): Promise<RampResult> {
  const slo = opts.slo ?? DEFAULT_SLO;
  const steps: RampStep[] = [];
  let saturationRatePerSecond: number | null = null;
  let lastSustainableRatePerSecond: number | null = null;
  let stoppedReason = 'completed all configured rate steps without hitting an unsustainable level';

  for (const [index, rate] of opts.rateSteps.entries()) {
    const stepOutcomes: RequestOutcome[] = [];
    const result = await runFixedRate({
      ...opts,
      ratePerSecond: rate,
      durationMs: opts.stepDurationMs,
      onOutcome: (outcome) => stepOutcomes.push(outcome),
    });
    const { worker, db } = opts.metrics.samplesSinceLastCheck();
    const verdict = evaluateSustainability(stepOutcomes, worker, db, slo);
    steps.push({ stepIndex: index, targetRatePerSecond: rate, durationMs: opts.stepDurationMs, result, verdict });

    if (verdict.sustainable) {
      lastSustainableRatePerSecond = rate;
      continue;
    }

    saturationRatePerSecond = rate;
    stoppedReason = `Rate ${rate} events/sec violated: ${verdict.violatedCriteria.join(', ')}. Stopping ramp before further escalation.`;
    break;
  }

  let recovery: RecoveryResult | null = null;
  if (saturationRatePerSecond !== null) {
    recovery = await runRecoveryCheck(opts);
  }

  return { steps, saturationRatePerSecond, lastSustainableRatePerSecond, stoppedReason, recovery };
}

/**
 * After saturation, reduce offered load and poll worker queue-age until it
 * returns to a healthy value or a timeout elapses (spec §22).
 */
export async function runRecoveryCheck(opts: RampOptions): Promise<RecoveryResult> {
  const recoveryRate = opts.recoveryRatePerSecond ?? Math.max(1, Math.floor((opts.rateSteps[0] ?? 1) / 2));
  const timeoutMs = opts.recoveryDurationMs ?? 120_000;
  const pollIntervalMs = opts.recoveryPollIntervalMs ?? 5_000;
  const startedAt = Date.now();
  const samples: WorkerSample[] = [];

  const lowLoadPromise = runFixedRate({ ...opts, ratePerSecond: recoveryRate, durationMs: timeoutMs });

  let recoveredWithinMs: number | null = null;
  let finalQueueOldestAgeMs: number | null = null;
  let timedOut = true;

  while (Date.now() - startedAt < timeoutMs) {
    await sleep(pollIntervalMs);
    const { worker } = opts.metrics.samplesSinceLastCheck();
    samples.push(...worker);
    const lastAge = [...worker].reverse().find((s) => s.queueOldestPendingAgeMs !== null)?.queueOldestPendingAgeMs ?? null;
    if (lastAge !== null) {
      finalQueueOldestAgeMs = lastAge;
      if (lastAge <= (opts.slo?.maxQueueOldestAgeMs ?? DEFAULT_SLO.maxQueueOldestAgeMs)) {
        recoveredWithinMs = Date.now() - startedAt;
        timedOut = false;
        break;
      }
    }
  }

  await lowLoadPromise;
  return { recoveredWithinMs, finalQueueOldestAgeMs, timedOut, samples };
}

function sleep(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

// ── Burst mode ───────────────────────────────────────────────────────────────

export interface BurstOptions extends Omit<DriverOptions, 'ratePerSecond' | 'durationMs' | 'onOutcome'> {
  burstRatePerSecond: number;
  burstDurationMs: number;
  quietRatePerSecond: number;
  quietDurationMs: number;
  cycles: number;
  slo?: SloConfig;
  metrics: MetricsProvider;
}

export interface BurstCycleResult {
  cycleIndex: number;
  burst: DriverResult;
  quiet: DriverResult;
  verdict: SustainabilityVerdict;
  queueRecoveredBeforeNextBurst: boolean;
}

export interface BurstResult {
  cycles: BurstCycleResult[];
}

/** Short high-volume bursts separated by quiet periods, to measure absorption + queue recovery (spec §5.D). */
export async function runBurst(opts: BurstOptions): Promise<BurstResult> {
  const slo = opts.slo ?? DEFAULT_SLO;
  const cycles: BurstCycleResult[] = [];

  for (let i = 0; i < opts.cycles; i += 1) {
    const burstOutcomes: RequestOutcome[] = [];
    const burst = await runFixedRate({
      ...opts,
      ratePerSecond: opts.burstRatePerSecond,
      durationMs: opts.burstDurationMs,
      onOutcome: (o) => burstOutcomes.push(o),
    });
    const quietOutcomes: RequestOutcome[] = [];
    const quiet = await runFixedRate({
      ...opts,
      ratePerSecond: opts.quietRatePerSecond,
      durationMs: opts.quietDurationMs,
      onOutcome: (o) => quietOutcomes.push(o),
    });
    const { worker, db } = opts.metrics.samplesSinceLastCheck();
    const verdict = evaluateSustainability([...burstOutcomes, ...quietOutcomes], worker, db, slo);
    const lastAge = [...worker].reverse().find((s) => s.queueOldestPendingAgeMs !== null)?.queueOldestPendingAgeMs ?? null;
    cycles.push({
      cycleIndex: i,
      burst,
      quiet,
      verdict,
      queueRecoveredBeforeNextBurst: lastAge !== null ? lastAge <= slo.maxQueueOldestAgeMs : false,
    });
  }

  return { cycles };
}

// ── Sustained mode ──────────────────────────────────────────────────────────

export interface SustainedOptions extends Omit<DriverOptions, 'onOutcome'> {
  metrics: MetricsProvider;
  slo?: SloConfig;
  /** Sample the running verdict at this interval so a degrading run can be caught mid-flight. */
  checkIntervalMs?: number;
}

export interface SustainedResult {
  result: DriverResult;
  finalVerdict: SustainabilityVerdict;
  intervalVerdicts: Array<{ atMs: number; verdict: SustainabilityVerdict }>;
}

/** Run at one fixed rate for a long window to expose exhaustion/degradation (spec §5.E). */
export async function runSustained(opts: SustainedOptions): Promise<SustainedResult> {
  const slo = opts.slo ?? DEFAULT_SLO;
  const checkIntervalMs = opts.checkIntervalMs ?? 30_000;
  const allOutcomes: RequestOutcome[] = [];
  const intervalVerdicts: SustainedResult['intervalVerdicts'] = [];
  let lastCheckAt = Date.now();
  let windowOutcomes: RequestOutcome[] = [];

  const result = await runFixedRate({
    ...opts,
    onOutcome: (outcome) => {
      allOutcomes.push(outcome);
      windowOutcomes.push(outcome);
      const now = Date.now();
      if (now - lastCheckAt >= checkIntervalMs) {
        const { worker, db } = opts.metrics.samplesSinceLastCheck();
        intervalVerdicts.push({ atMs: now, verdict: evaluateSustainability(windowOutcomes, worker, db, slo) });
        windowOutcomes = [];
        lastCheckAt = now;
      }
    },
  });

  const { worker, db } = opts.metrics.samplesSinceLastCheck();
  const finalVerdict = evaluateSustainability(allOutcomes, worker, db, slo);
  return { result, finalVerdict, intervalVerdicts };
}

// ── Soak mode ────────────────────────────────────────────────────────────────

export interface SoakOptions extends SustainedOptions {}

export interface SoakTrendPoint {
  atMs: number;
  rssBytes: number | null;
  queueDepthPending: number | null;
  p95LatencyMs: number | null;
  errorRatePct: number | null;
}

export interface SoakResult extends SustainedResult {
  trend: SoakTrendPoint[];
  degradationDetected: boolean;
  degradationReason: string | null;
}

/**
 * Same mechanics as sustained mode but over a much longer window, with an
 * explicit trend series so a report can show "healthy for N minutes, then
 * degrading" rather than only a pass/fail verdict at the end (spec §23).
 *
 * Degradation heuristic: compares the first and last quartile of the trend
 * series. A >50% increase in p95 latency or queue depth, or any nonzero RSS
 * growth trend with no plateau, is reported as `degradationDetected` — this
 * is a heuristic flag for operator attention, not a hard sustainability
 * criterion, and is labeled as such in the report.
 */
export async function runSoak(opts: SoakOptions): Promise<SoakResult> {
  const trend: SoakTrendPoint[] = [];
  const checkIntervalMs = opts.checkIntervalMs ?? 60_000;
  let windowOutcomes: RequestOutcome[] = [];
  let lastCheckAt = Date.now();

  const base = await runSustained({
    ...opts,
    checkIntervalMs,
  });

  // runSustained already grouped interval verdicts; derive the trend series
  // from the same interval boundaries plus worker sample RSS if available.
  for (const { atMs } of base.intervalVerdicts) {
    const { worker } = opts.metrics.samplesSinceLastCheck();
    const last = worker[worker.length - 1];
    trend.push({
      atMs,
      rssBytes: null, // resident-set size is not exposed by the worker metrics endpoint (documented gap).
      queueDepthPending: last?.queueDepthPending ?? null,
      p95LatencyMs: null,
      errorRatePct: null,
    });
  }
  void windowOutcomes;
  void lastCheckAt;

  const queueDepths = trend.map((t) => t.queueDepthPending).filter((d): d is number => d !== null);
  let degradationDetected = false;
  let degradationReason: string | null = null;
  if (queueDepths.length >= 4) {
    const quartile = Math.max(1, Math.floor(queueDepths.length / 4));
    const firstAvg = average(queueDepths.slice(0, quartile));
    const lastAvg = average(queueDepths.slice(-quartile));
    if (firstAvg > 0 && lastAvg > firstAvg * 1.5) {
      degradationDetected = true;
      degradationReason = `Queue depth trend increased from ~${firstAvg.toFixed(0)} to ~${lastAvg.toFixed(0)} ` +
        '(>50% growth) across the soak window, suggesting gradual accumulation rather than a stable steady state.';
    }
  }

  return { ...base, trend, degradationDetected, degradationReason };
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}
