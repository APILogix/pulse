/**
 * Pure aggregation helpers shared by the ingestion write-path forensics
 * harnesses (Phase 2).
 *
 * Three concerns live here, all of them side-effect free so the design's
 * Property 16 and Property 17 can quantify over them directly:
 *
 *  - `summarize()`            median / min / max across measurement runs (R1.7)
 *  - `filterValidRepetitions()`  exclusion of incomplete and error-heavy
 *                            repetitions from every reported aggregate
 *                            (R17.8, R17.9)
 *  - `selectKnee()`          batch-size point-of-diminishing-return selection
 *                            (R11.3), the regression rule (R11.5) and the
 *                            no-knee rule (R11.6)
 *
 * No database, filesystem, process or clock access. Nothing here reads
 * `process.env`. Callers own provenance: `scripts/lib/ingestion-evidence.ts`
 * wraps a `RunAggregate` plus its run list into `Measured<T>`, and the sweep
 * callers unwrap `BatchSizeSweepCell.medianEventsPerSecond` before handing a
 * plain number to `selectKnee()` — an unmeasured cell is passed with
 * `medianEventsPerSecond: null` so it is recorded as skipped instead of
 * silently treated as zero throughput.
 */

/**
 * Requirement 17.9: a repetition whose error rate exceeds 1 percent of events
 * submitted is invalid for throughput comparison. Exactly 1 percent does not
 * exceed the bound and stays valid.
 */
export const MAX_VALID_ERROR_RATE_PCT = 1;

/**
 * Requirements 11.3, 11.5 and 11.6 all pivot on the same 5 percent step.
 */
export const DIMINISHING_RETURN_THRESHOLD_PCT = 5;

// ── Run aggregation (Requirement 1.7) ───────────────────────────────────────

export interface RunAggregate {
  /** Number of run values the summary was computed from. */
  count: number;
  median: number;
  min: number;
  max: number;
}

/**
 * Summarize per-run measured values into the median, minimum and maximum
 * Requirement 1.7 asks a reported value to carry.
 *
 * Permutation invariant (the input is copied and sorted) and range respecting
 * (`min <= median <= max`, with an even-length median taken as the mean of the
 * two central values, which always lies between them).
 *
 * Returns `null` for an empty run list — an absent aggregate is a first-class
 * result and must not be reported as a zero. Throws on a non-finite run value
 * rather than dropping it, because summarizing a subset of the runs while
 * reporting the full repetition count would fabricate provenance.
 */
export function summarize(runs: number[]): RunAggregate | null {
  if (runs.length === 0) return null;

  for (const value of runs) {
    if (!Number.isFinite(value)) {
      throw new Error(`summarize() received a non-finite run value: ${String(value)}`);
    }
  }

  const sorted = [...runs].sort((a, b) => a - b);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const upper = sorted[Math.floor(sorted.length / 2)];
  if (min === undefined || max === undefined || upper === undefined) return null;

  let median = upper;
  if (sorted.length % 2 === 0) {
    const lower = sorted[Math.floor(sorted.length / 2) - 1];
    if (lower === undefined) return null;
    median = (lower + upper) / 2;
  }

  return { count: sorted.length, median, min, max };
}

// ── Repetition validity (Requirements 17.8, 17.9) ───────────────────────────

export type RepetitionExclusionReason =
  /** Requirement 17.8: the measurement window did not complete. */
  | 'terminated_early'
  /** Requirement 17.9: measured error rate above `MAX_VALID_ERROR_RATE_PCT`. */
  | 'error_rate_exceeded'
  /** The error rate itself was not measured, so validity cannot be established. */
  | 'error_rate_unavailable';

/**
 * The subset of `WorkloadRepetition` (design §Data Models) this module needs.
 * Structural, so a caller can pass full `WorkloadRepetition` records and get
 * them back untouched.
 */
export interface RepetitionValidity {
  /** False when the repetition terminated before its measurement window completed. */
  completed: boolean;
  terminationReason: string | null;
  /** Error rate as a percentage of events submitted. */
  errorRatePct: number;
  /** Classification of the observed failures, where the caller recorded one. */
  failureClassification?: string | null;
}

export interface ExcludedRepetition<T> {
  /** Position of the repetition in the input list. */
  index: number;
  repetition: T;
  /** Every reason that applies; a repetition can fail both rules at once. */
  reasons: RepetitionExclusionReason[];
  terminationReason: string | null;
  /** The measured error rate, or `null` when it could not be read. */
  errorRatePct: number | null;
  failureClassification: string | null;
}

export interface RepetitionFilterResult<T> {
  valid: T[];
  excluded: ExcludedRepetition<T>[];
}

/**
 * Split repetitions into the set that may influence a reported aggregate and
 * the set that may not.
 *
 * A repetition is excluded when it terminated before its measurement window
 * completed (Requirement 17.8) or when its measured error rate exceeded
 * `MAX_VALID_ERROR_RATE_PCT` (Requirement 17.9). Each exclusion carries its
 * termination reason and its measured error rate, so the report can state why
 * the repetition was dropped instead of leaving a gap.
 *
 * A repetition whose error rate is not a finite number is also excluded: its
 * validity cannot be established, and admitting it would let an unverified
 * repetition into a reported number.
 */
export function filterValidRepetitions<T extends RepetitionValidity>(
  repetitions: T[],
): RepetitionFilterResult<T> {
  const valid: T[] = [];
  const excluded: ExcludedRepetition<T>[] = [];

  repetitions.forEach((repetition, index) => {
    const reasons: RepetitionExclusionReason[] = [];

    if (!repetition.completed) {
      reasons.push('terminated_early');
    }

    const errorRateMeasured = Number.isFinite(repetition.errorRatePct);
    if (!errorRateMeasured) {
      reasons.push('error_rate_unavailable');
    } else if (repetition.errorRatePct > MAX_VALID_ERROR_RATE_PCT) {
      reasons.push('error_rate_exceeded');
    }

    if (reasons.length === 0) {
      valid.push(repetition);
      return;
    }

    excluded.push({
      index,
      repetition,
      reasons,
      terminationReason: repetition.terminationReason,
      errorRatePct: errorRateMeasured ? repetition.errorRatePct : null,
      failureClassification: repetition.failureClassification ?? null,
    });
  });

  return { valid, excluded };
}

export interface ValidRepetitionAggregate<T> {
  /** `null` when no repetition survived the filter. */
  aggregate: RunAggregate | null;
  /** The per-run values the aggregate was computed from, in input order. */
  values: number[];
  valid: T[];
  excluded: ExcludedRepetition<T>[];
}

/**
 * Aggregate one metric across repetitions, computed from the complete and
 * valid repetitions alone (Requirement 17.9, design Property 17).
 *
 * `select` must return a finite measured value for a valid repetition;
 * `summarize()` throws otherwise rather than reporting a partial aggregate.
 */
export function summarizeValidRepetitions<T extends RepetitionValidity>(
  repetitions: T[],
  select: (repetition: T) => number,
): ValidRepetitionAggregate<T> {
  const { valid, excluded } = filterValidRepetitions(repetitions);
  const values = valid.map(select);
  return { aggregate: summarize(values), values, valid, excluded };
}

// ── Batch-size knee selection (Requirements 11.3, 11.5, 11.6) ───────────────

export interface SweepPoint {
  batchSize: number;
  /**
   * Median events per second at this batch size, or `null` when the cell was
   * not measured. A cell recorded as unmeasured must arrive as `null`, never
   * as `0`.
   */
  medianEventsPerSecond: number | null;
  /**
   * `BatchSizeSweepCell.excludedReason` (Requirements 11.7, 11.8) where the
   * cell carries one. A non-empty value removes the cell from the comparison,
   * because Requirement 11.3 compares against the next smaller *measured*
   * batch size.
   */
  excludedReason?: string | null;
}

export type SweepPointSkipReason =
  | 'excluded'
  | 'median_unavailable'
  | 'invalid_batch_size'
  | 'duplicate_batch_size';

export interface SkippedSweepPoint {
  batchSize: number | null;
  reason: SweepPointSkipReason;
  /** The originating `excludedReason`, or the detail of the malformed input. */
  detail: string | null;
}

export type SweepStepClassification =
  /** Gain above the 5 percent threshold: the sweep has not flattened yet. */
  | 'gain_above_threshold'
  /** Gain of 5 percent or less, but not a regression: the Requirement 11.3 knee. */
  | 'diminishing_return'
  /** More than 5 percent below the next smaller batch size (Requirement 11.5). */
  | 'regression';

export interface SweepStep {
  fromBatchSize: number;
  toBatchSize: number;
  fromMedianEventsPerSecond: number;
  toMedianEventsPerSecond: number;
  gainPct: number;
  /** The arithmetic that produced `gainPct` (Requirement 17.5). */
  formula: string;
  classification: SweepStepClassification;
}

export type KneeOutcome =
  /** Requirement 11.3 knee found. */
  | 'knee'
  /** Requirement 11.5 regression: the smaller batch size is recommended. */
  | 'regression'
  /** Requirement 11.6: every measured step gained more than 5 percent. */
  | 'no_knee'
  /** Fewer than two measured batch sizes, so no step can be classified. */
  | 'insufficient_data';

export interface KneeSelection {
  outcome: KneeOutcome;
  /**
   * The Requirement 11.3 answer: the smallest measured batch size whose median
   * events per second exceeds the next smaller measured batch size's median by
   * 5 percent or less. `null` when no such batch size exists in the measured
   * range.
   */
  kneeBatchSize: number | null;
  /**
   * The batch size to recommend. Equals `kneeBatchSize` for a knee; the next
   * smaller measured batch size for a regression (Requirement 11.5); the
   * largest measured batch size when no knee was reached (Requirement 11.6,
   * still subject to the Requirement 15.3 memory bound, which the caller
   * applies).
   */
  recommendedBatchSize: number | null;
  /** Measured batch sizes in ascending order. */
  measuredBatchSizes: number[];
  /** Every consecutive measured pair, in ascending order. */
  steps: SweepStep[];
  /** Every input point excluded from the comparison, with its reason. */
  skipped: SkippedSweepPoint[];
  /** Plain-language statement of the rule applied and the numbers it used. */
  rule: string;
}

/**
 * Percentage change from `previous` to `current`.
 *
 * `previous === 0` has no defined percentage change: a rise from zero is
 * reported as `Infinity` (unbounded gain, treated as above the threshold) and a
 * flat zero as `0` (no gain, treated as the point of diminishing return).
 */
export function gainPercent(previous: number, current: number): number {
  if (previous === 0) return current > 0 ? Number.POSITIVE_INFINITY : 0;
  return ((current - previous) / previous) * 100;
}

/**
 * Select the batch-size point of diminishing return from a throughput sweep.
 *
 * Scanning measured batch sizes in ascending order, the first step whose gain
 * is not above 5 percent decides the outcome:
 *
 *  - gain in `(-5, 5]`  → Requirement 11.3 knee; recommend that batch size.
 *  - gain below `-5`    → Requirement 11.5 regression; the step's batch size is
 *                         still the Requirement 11.3 knee (its median exceeds
 *                         the next smaller by 5 percent or less), but the
 *                         recommendation drops to the smaller batch size and
 *                         both medians are recorded.
 *  - no such step       → Requirement 11.6; record that the point of
 *                         diminishing return was not reached and recommend the
 *                         largest measured batch size.
 *
 * Every step is recorded regardless of where the decision fell, so the report
 * can show the whole curve. Nothing is silently dropped: malformed, excluded
 * and unmeasured points are returned in `skipped` with their reason.
 */
export function selectKnee(series: SweepPoint[]): KneeSelection {
  const skipped: SkippedSweepPoint[] = [];
  const measured: Array<{ batchSize: number; median: number }> = [];
  const seen = new Set<number>();

  for (const point of series) {
    if (!Number.isFinite(point.batchSize) || point.batchSize <= 0) {
      skipped.push({
        batchSize: null,
        reason: 'invalid_batch_size',
        detail: `batchSize ${String(point.batchSize)} is not a positive finite number`,
      });
      continue;
    }

    const excludedReason = point.excludedReason ?? null;
    if (excludedReason !== null && excludedReason !== '') {
      skipped.push({ batchSize: point.batchSize, reason: 'excluded', detail: excludedReason });
      continue;
    }

    const median = point.medianEventsPerSecond;
    if (median === null || !Number.isFinite(median) || median < 0) {
      skipped.push({
        batchSize: point.batchSize,
        reason: 'median_unavailable',
        detail: `medianEventsPerSecond ${String(median)} is not a non-negative finite number`,
      });
      continue;
    }

    if (seen.has(point.batchSize)) {
      skipped.push({
        batchSize: point.batchSize,
        reason: 'duplicate_batch_size',
        detail: 'a batch size may appear at most once in a sweep; the first occurrence was kept',
      });
      continue;
    }

    seen.add(point.batchSize);
    measured.push({ batchSize: point.batchSize, median });
  }

  measured.sort((a, b) => a.batchSize - b.batchSize);
  const measuredBatchSizes = measured.map((point) => point.batchSize);

  if (measured.length < 2) {
    const only = measured[0];
    return {
      outcome: 'insufficient_data',
      kneeBatchSize: null,
      recommendedBatchSize: only?.batchSize ?? null,
      measuredBatchSizes,
      steps: [],
      skipped,
      rule:
        only === undefined
          ? 'No measured batch size in the series; no knee can be selected.'
          : `Only one measured batch size (${only.batchSize}); Requirement 11.3 needs a next smaller measured batch size to compare against.`,
    };
  }

  const steps: SweepStep[] = [];
  let decision: SweepStep | null = null;

  for (let i = 1; i < measured.length; i += 1) {
    const previous = measured[i - 1];
    const current = measured[i];
    if (previous === undefined || current === undefined) continue;

    const pct = gainPercent(previous.median, current.median);
    const step: SweepStep = {
      fromBatchSize: previous.batchSize,
      toBatchSize: current.batchSize,
      fromMedianEventsPerSecond: previous.median,
      toMedianEventsPerSecond: current.median,
      gainPct: pct,
      formula:
        `(${format(current.median)} - ${format(previous.median)}) / ${format(previous.median)} * 100` +
        ` = ${format(pct)}%`,
      classification: classifyStep(pct),
    };
    steps.push(step);

    if (decision === null && step.classification !== 'gain_above_threshold') {
      decision = step;
    }
  }

  if (decision === null) {
    const largest = measuredBatchSizes[measuredBatchSizes.length - 1] ?? null;
    return {
      outcome: 'no_knee',
      kneeBatchSize: null,
      recommendedBatchSize: largest,
      measuredBatchSizes,
      steps,
      skipped,
      rule:
        `R11.6: every measured step gained more than ${DIMINISHING_RETURN_THRESHOLD_PCT}%` +
        ` across batch sizes ${measuredBatchSizes.join(', ')}; the point of diminishing return was` +
        ` not reached within the measured range. Recommending the largest measured batch size` +
        ` ${String(largest)}, subject to the Requirement 15.3 worst-case memory bound applied by the caller.`,
    };
  }

  if (decision.classification === 'regression') {
    return {
      outcome: 'regression',
      kneeBatchSize: decision.toBatchSize,
      recommendedBatchSize: decision.fromBatchSize,
      measuredBatchSizes,
      steps,
      skipped,
      rule:
        `R11.5: batch size ${decision.toBatchSize} median ${format(decision.toMedianEventsPerSecond)}` +
        ` events/s is ${format(Math.abs(decision.gainPct))}% below batch size ${decision.fromBatchSize}` +
        ` median ${format(decision.fromMedianEventsPerSecond)} events/s, more than` +
        ` ${DIMINISHING_RETURN_THRESHOLD_PCT}%. Recommending the smaller batch size ${decision.fromBatchSize}.`,
    };
  }

  return {
    outcome: 'knee',
    kneeBatchSize: decision.toBatchSize,
    recommendedBatchSize: decision.toBatchSize,
    measuredBatchSizes,
    steps,
    skipped,
    rule:
      `R11.3: batch size ${decision.toBatchSize} is the smallest measured batch size whose median` +
      ` ${format(decision.toMedianEventsPerSecond)} events/s exceeds the next smaller measured batch size` +
      ` ${decision.fromBatchSize} median ${format(decision.fromMedianEventsPerSecond)} events/s by` +
      ` ${format(decision.gainPct)}%, which is ${DIMINISHING_RETURN_THRESHOLD_PCT}% or less.`,
  };
}

function classifyStep(gainPct: number): SweepStepClassification {
  if (gainPct < -DIMINISHING_RETURN_THRESHOLD_PCT) return 'regression';
  if (gainPct > DIMINISHING_RETURN_THRESHOLD_PCT) return 'gain_above_threshold';
  return 'diminishing_return';
}

function format(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  return (Math.round(value * 100) / 100).toFixed(2);
}
