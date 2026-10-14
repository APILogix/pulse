/**
 * Sustainability criteria evaluation (spec §10).
 *
 * A load level is "sustainable" only when every applicable measured
 * criterion holds. Criteria whose supporting telemetry is unavailable (e.g.
 * no DB URL supplied, so no direct WAL/connection numbers) are marked
 * `unmeasured` rather than assumed to pass — an unmeasured criterion never
 * silently counts as "met."
 *
 * Thresholds are operator-configurable via `SloConfig`, because this
 * benchmark has no authority to invent a production SLO. Defaults are
 * deliberately conservative and documented as defaults, not measured facts.
 */
import type { WorkerSample, DbSample } from './metrics-collector.js';
import type { RequestOutcome } from './http-request-engine.js';

export interface SloConfig {
  maxP95LatencyMs: number;
  maxP99LatencyMs: number;
  maxErrorRatePct: number;
  maxQueueOldestAgeMs: number;
  /** Queue depth is "not continuously increasing" if it does not grow for this many consecutive samples. */
  maxConsecutiveQueueGrowthSamples: number;
  maxDbConnectionUtilizationPct: number;
}

export const DEFAULT_SLO: SloConfig = {
  maxP95LatencyMs: 2_000,
  maxP99LatencyMs: 5_000,
  maxErrorRatePct: 1,
  maxQueueOldestAgeMs: 60_000,
  maxConsecutiveQueueGrowthSamples: 5,
  maxDbConnectionUtilizationPct: 90,
};

export type CriterionStatus = 'met' | 'violated' | 'unmeasured';

export interface CriterionResult {
  name: string;
  status: CriterionStatus;
  detail: string;
}

export interface SustainabilityVerdict {
  sustainable: boolean;
  criteria: CriterionResult[];
  violatedCriteria: string[];
  unmeasuredCriteria: string[];
}

function latencyPercentile(outcomes: RequestOutcome[], q: number): number | null {
  const values = outcomes.filter((o) => o.error === null).map((o) => o.latencyMs).sort((a, b) => a - b);
  if (values.length === 0) return null;
  const idx = Math.min(values.length - 1, Math.max(0, Math.ceil(q * values.length) - 1));
  return values[idx] ?? null;
}

function isQueueContinuouslyIncreasing(samples: WorkerSample[], windowSize: number): boolean {
  const depths = samples.map((s) => s.queueDepthPending).filter((d): d is number => d !== null);
  if (depths.length < windowSize + 1) return false;
  const recent = depths.slice(-(windowSize + 1));
  for (let i = 1; i < recent.length; i += 1) {
    if ((recent[i] ?? 0) <= (recent[i - 1] ?? 0)) return false;
  }
  return true;
}

export function evaluateSustainability(
  outcomes: RequestOutcome[],
  workerSamples: WorkerSample[],
  dbSamples: DbSample[],
  slo: SloConfig = DEFAULT_SLO,
): SustainabilityVerdict {
  const criteria: CriterionResult[] = [];

  // Error rate — always measurable from outcomes alone.
  const total = outcomes.length;
  const errored = outcomes.filter((o) => o.error !== null).length;
  const errorRatePct = total > 0 ? (errored / total) * 100 : 0;
  criteria.push({
    name: 'error_rate',
    status: errorRatePct <= slo.maxErrorRatePct ? 'met' : 'violated',
    detail: `${errorRatePct.toFixed(2)}% of ${total} requests errored (limit ${slo.maxErrorRatePct}%).`,
  });

  // Latency p95/p99.
  const p95 = latencyPercentile(outcomes, 0.95);
  const p99 = latencyPercentile(outcomes, 0.99);
  criteria.push({
    name: 'p95_latency',
    status: p95 === null ? 'unmeasured' : p95 <= slo.maxP95LatencyMs ? 'met' : 'violated',
    detail: p95 === null ? 'No successful requests to compute p95 from.' : `p95=${p95.toFixed(1)}ms (limit ${slo.maxP95LatencyMs}ms).`,
  });
  criteria.push({
    name: 'p99_latency',
    status: p99 === null ? 'unmeasured' : p99 <= slo.maxP99LatencyMs ? 'met' : 'violated',
    detail: p99 === null ? 'No successful requests to compute p99 from.' : `p99=${p99.toFixed(1)}ms (limit ${slo.maxP99LatencyMs}ms).`,
  });

  // Queue age / bounded depth — requires worker metrics.
  if (workerSamples.length === 0) {
    criteria.push({ name: 'queue_oldest_age', status: 'unmeasured', detail: 'No worker metrics samples collected (worker-metrics-url unreachable or not provided).' });
    criteria.push({ name: 'queue_depth_bounded', status: 'unmeasured', detail: 'No worker metrics samples collected.' });
  } else {
    const lastAge = [...workerSamples].reverse().find((s) => s.queueOldestPendingAgeMs !== null)?.queueOldestPendingAgeMs ?? null;
    criteria.push({
      name: 'queue_oldest_age',
      status: lastAge === null ? 'unmeasured' : lastAge <= slo.maxQueueOldestAgeMs ? 'met' : 'violated',
      detail: lastAge === null ? 'No oldest-pending-age gauge observed.' : `oldest pending job age=${lastAge}ms (limit ${slo.maxQueueOldestAgeMs}ms).`,
    });
    const increasing = isQueueContinuouslyIncreasing(workerSamples, slo.maxConsecutiveQueueGrowthSamples);
    criteria.push({
      name: 'queue_depth_bounded',
      status: increasing ? 'violated' : 'met',
      detail: increasing
        ? `Queue depth increased for ${slo.maxConsecutiveQueueGrowthSamples + 1} consecutive samples with no recovery.`
        : 'Queue depth did not show sustained continuous growth across the sampled window.',
    });
  }

  // DB connection utilization — requires DB samples.
  if (dbSamples.length === 0) {
    criteria.push({ name: 'db_connection_utilization', status: 'unmeasured', detail: 'No DB samples collected (no --db-url provided or target unreachable).' });
  } else {
    const last = dbSamples[dbSamples.length - 1]!;
    if (last.activeConnections === null || last.totalConnections === null || last.totalConnections === 0) {
      criteria.push({ name: 'db_connection_utilization', status: 'unmeasured', detail: 'DB sample present but connection counts were null.' });
    } else {
      const utilPct = (last.activeConnections / last.totalConnections) * 100;
      criteria.push({
        name: 'db_connection_utilization',
        status: utilPct <= slo.maxDbConnectionUtilizationPct ? 'met' : 'violated',
        detail: `${utilPct.toFixed(1)}% active connections (limit ${slo.maxDbConnectionUtilizationPct}%).`,
      });
    }
  }

  const violatedCriteria = criteria.filter((c) => c.status === 'violated').map((c) => c.name);
  const unmeasuredCriteria = criteria.filter((c) => c.status === 'unmeasured').map((c) => c.name);

  return {
    // Sustainable only if nothing measured VIOLATED. Unmeasured criteria do
    // not block a verdict of "sustainable" (spec doesn't require every axis
    // to have telemetry), but every unmeasured criterion is listed so a
    // report never implies more confidence than the evidence supports.
    sustainable: violatedCriteria.length === 0,
    criteria,
    violatedCriteria,
    unmeasuredCriteria,
  };
}
