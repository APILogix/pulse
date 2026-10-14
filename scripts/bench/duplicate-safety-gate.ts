/**
 * Safety gate for duplicate-heavy / billing-sensitive benchmark profiles.
 *
 * The prior ingestion audit established that `events_logs` lacks a deployed
 * scoped unique guard (migration 030,
 * `database/migrations/logdb/03_observability_v2/030_events_logs_idempotency.up.sql`,
 * not executed against any known target as of this session). Without that
 * guard, `ON CONFLICT DO NOTHING` on `events_logs` has no matching unique
 * index to conflict against, so a redelivered/duplicated `log` event inserts
 * again instead of being suppressed.
 *
 * Running a duplicate-heavy profile that includes `log` events against a
 * target where this guard is absent would:
 *   - create physically duplicated rows the benchmark cannot safely clean up
 *     (no reliable way to distinguish "benchmark duplicate" from "any other
 *     row" after the fact without the benchmark's own tagging, and even with
 *     tagging, this corrupts the very cost measurement the profile exists to
 *     produce), and
 *   - inflate inserted-only usage/billing counters for the affected
 *     organization even though this is a synthetic benchmark org.
 *
 * Per master prompt §21: "Before running duplicate-heavy tests, verify the
 * known log idempotency gap is resolved in the benchmark database. If it is
 * not resolved: STOP the duplicate/billing-sensitive benchmark and document
 * the blocker. Do not corrupt benchmark data."
 *
 * This module queries the target database directly (read-only) for the
 * presence of `idx_events_logs_event_unique` and refuses to proceed with a
 * `log`-touching duplicate-heavy run when it is absent — the caller must
 * either exclude `log` from the profile's type mix or resolve the guard on an
 * isolated benchmark target first.
 */
import { Pool } from 'pg';

export interface LogIdempotencyStatus {
  checked: boolean;
  guardPresent: boolean;
  reason: string;
}

const GUARD_INDEX_NAME = 'idx_events_logs_event_unique';

/**
 * Check whether the target Log DB has the scoped unique guard deployed.
 * Read-only: a single `pg_indexes` lookup, no DDL, no locks.
 */
export async function checkLogIdempotencyGuard(logDbUrl: string | undefined): Promise<LogIdempotencyStatus> {
  if (!logDbUrl) {
    return {
      checked: false,
      guardPresent: false,
      reason: 'No --log-db-url / LOG_DATABASE_URL provided; cannot verify events_logs unique guard. ' +
        'Treating as ABSENT for safety.',
    };
  }
  const pool = new Pool({ connectionString: logDbUrl, max: 1, application_name: 'pulse_ingestion_bench_safety_check' });
  try {
    const result = await pool.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'events_logs' AND indexname = $1`,
      [GUARD_INDEX_NAME],
    );
    const present = result.rows.length > 0;
    return {
      checked: true,
      guardPresent: present,
      reason: present
        ? `Found unique index ${GUARD_INDEX_NAME} on events_logs.`
        : `Unique index ${GUARD_INDEX_NAME} not found on events_logs. Migration 030 is not deployed ` +
          'on this target. Duplicate log events will insert again rather than being suppressed.',
    };
  } catch (err) {
    return {
      checked: false,
      guardPresent: false,
      reason: `Could not query target for ${GUARD_INDEX_NAME}: ${err instanceof Error ? err.message : String(err)}. ` +
        'Treating as ABSENT for safety.',
    };
  } finally {
    await pool.end().catch(() => undefined);
  }
}

export class DuplicateHeavySafetyError extends Error {
  readonly exitCode = 2;
  constructor(message: string) {
    super(message);
    this.name = 'DuplicateHeavySafetyError';
  }
}

/**
 * Enforce the gate. Throws {@link DuplicateHeavySafetyError} (never silently
 * proceeds) when the profile includes `log` events, the duplicate ratio is
 * above zero, and the guard is absent or unverifiable.
 */
export function assertDuplicateProfileSafe(opts: {
  profileTypeWeights: Partial<Record<string, number>>;
  duplicateRatio: number;
  guardStatus: LogIdempotencyStatus;
  allowUnsafeOverride: boolean;
}): void {
  const touchesLogs = (opts.profileTypeWeights.log ?? 0) > 0;
  if (!touchesLogs || opts.duplicateRatio <= 0) return;
  if (opts.guardStatus.guardPresent) return;
  if (opts.allowUnsafeOverride) return;

  throw new DuplicateHeavySafetyError(
    'STOPPED: duplicate-heavy profile includes log events but the events_logs scoped unique guard ' +
      `is not confirmed present on this target. ${opts.guardStatus.reason} ` +
      'This benchmark run would create physically duplicated log rows and inflate usage/billing ' +
      'counters. Options: (1) run this profile against an isolated benchmark target where migration ' +
      '030 has been applied and rehearsed, (2) exclude log from the profile weights, or ' +
      '(3) pass --allow-unsafe-duplicate-logs to proceed anyway with this blocker explicitly ' +
      'acknowledged and recorded in the report.',
  );
}
