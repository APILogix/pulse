/**
 * Evaluator dry-run resolution (pure).
 *
 * Architecture: docs/alerting-redesign/DEVIATIONS.md DEV-002 (option 2)
 *
 * DEV-002 repoints the scheduled evaluators' telemetry reads onto the Log DB pool. Where the
 * Log DB is a separate database that changes WHAT the evaluator can see: previously it queried
 * empty control-plane copies of `events_*` and fired nothing. Enabling it blind would emit a
 * burst of alerts for pre-existing telemetry, which is precisely the transition Increment 8's
 * parity harness exists to gate.
 *
 * So firing is suppressed by default *only when the repoint actually changed something*:
 *   - separate telemetry pool  → dry-run ON  until an operator opts in after parity validation
 *   - same pool (single DB)    → dry-run OFF, preserving existing behaviour exactly
 *
 * This lives in its own module, and takes the environment value as an argument rather than
 * importing `config/env.js`, so the evaluators stay free of environment-validation coupling.
 */

/** Tri-state value of the `ALERTING_EVAL_DRY_RUN` environment variable. */
export type DryRunEnvValue = 'true' | 'false' | undefined;

/**
 * Resolve whether the evaluators should run in dry-run mode.
 *
 * @param envValue    explicit operator override; always wins when present
 * @param poolsDiffer true when the telemetry pool is not the control-plane pool
 */
export function resolveEvaluatorDryRun(
  envValue: DryRunEnvValue,
  poolsDiffer: boolean,
): boolean {
  if (envValue === 'true') return true;
  if (envValue === 'false') return false;
  return poolsDiffer;
}
