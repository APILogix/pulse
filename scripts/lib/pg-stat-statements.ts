/**
 * `pg_stat_statements` capability probe, scoped reset, and delta capture.
 *
 * This is the **cross-check and cost attributor** for Phase 2 statement
 * accounting, not the authority. `scripts/lib/statement-counter.ts` owns the
 * authoritative per-batch statement count for Requirements 2.7, 9.1 and 21.3
 * because it needs no extension and no privileges. This module supplies what
 * the in-process counter cannot: server-side execution time, WAL bytes and
 * buffer activity per statement, which is what Requirement 8.3 (statements at
 * or above 1 percent of total measured database time) is written against.
 *
 * Three degradations are first-class results rather than failures, because the
 * extension may be absent and the role may not be permitted to reset counters:
 *
 *   1. Extension absent → `statementCostSource: 'explain_analyze'` and the
 *      absence itself is recorded (Requirement 1.6). The
 *      `EXPLAIN (ANALYZE, BUFFERS, VERBOSE)` output from `explain:ingestion`
 *      becomes the statement-cost source.
 *   2. Scoped reset not permitted → the window is measured as a delta of two
 *      snapshots with `resetScope: 'delta_without_reset'` and the
 *      concurrent-activity caveat recorded, so the numbers are reported as
 *      upper bounds instead of quietly as exact.
 *   3. Neither this source nor the in-process counter can run → the affected
 *      metric records the byte-exact Unmeasured_Declaration with a reason
 *      (Requirement 9.8), produced by `recordUnmeasured()` so the sentence
 *      cannot drift.
 *
 * The reset is scoped by `(userid, dbid)` so a measurement stays valid on a
 * shared benchmark cluster: another role's or another database's counters are
 * left alone, and the window therefore contains only this role's work in this
 * database. The scoped argument form is documented from PostgreSQL 13, so it is
 * **probed** from `pg_proc` rather than assumed, and a cluster whose function
 * takes no arguments degrades to the delta path rather than wiping the whole
 * cluster's statistics.
 *
 * `pg_stat_statements` exposes no percentile columns, so the p95 duration
 * Requirement 8.3 also asks for comes from the in-process counter's per-call
 * records, not from here.
 *
 * Design references: §2.2 (capture protocol and both degradations), §1.1
 * (provenance envelope), §1.2 (`statementCostSource` as a recorded field).
 * Requirements: 1.6, 8.3, 9.1, 9.8.
 */
import type { QueryResult, QueryResultRow } from 'pg';

import {
  assertBenchEnvironment,
  nowUtc,
  recordUnmeasured,
  type Measured,
  type Provenance,
} from './ingestion-evidence.js';

/* ------------------------------------------------------------------------- */
/* Constants                                                                  */
/* ------------------------------------------------------------------------- */

/** The capability probe from design §2.2, kept verbatim and recorded with the result. */
export const PG_STAT_STATEMENTS_PROBE_SQL =
  "SELECT to_regclass('pg_stat_statements') IS NOT NULL AS available";

/**
 * The scoped reset from design §2.2. Two arguments only: `queryid` keeps its
 * default so every statement of this role in this database is reset.
 */
export const PG_STAT_STATEMENTS_SCOPED_RESET_SQL = `SELECT pg_stat_statements_reset(
  (SELECT oid FROM pg_roles WHERE rolname = current_user),
  (SELECT oid FROM pg_database WHERE datname = current_database())) AS reset_at`;

/**
 * PostgreSQL 13 is where the argument-taking form of the reset function is
 * documented. Recorded alongside the `pg_proc` probe rather than used as the
 * sole test, because the probe is the ground truth for what this server offers.
 */
export const MIN_SCOPED_RESET_SERVER_VERSION_NUM = 130000;

/** Characters of `query` retained per statement (design §2.2 uses `LEFT(query, 400)`). */
export const DEFAULT_QUERY_PREFIX_LENGTH = 400;

/** Requirement 8.3 threshold: at least 1 percent of total measured database time. */
export const DEFAULT_MIN_TIME_SHARE_PCT = 1;

/**
 * Recorded whenever the window could not be bracketed by a reset. Without the
 * reset, concurrent work by the same role in the same database lands inside the
 * measured delta, so every figure derived from it is an upper bound.
 */
export const DELTA_WITHOUT_RESET_CAVEAT =
  'Statement counters were not reset before the measured window, so the recorded deltas may include ' +
  'concurrent activity by the same role in the same database during the window and are upper bounds ' +
  'rather than exact attributions.';

/** Recorded when a statement's counters moved backwards across the window. */
export const COUNTERS_REWOUND_CAVEAT =
  'At least one statement reported fewer calls at the end of the window than at the start, which means ' +
  'its entry was evicted or the counters were reset by another session mid-window. The affected rows are ' +
  'flagged countersRewound and their deltas are taken from the closing snapshot alone.';

/** Columns this module reads beyond the always-present identity and call columns. */
const OPTIONAL_COLUMNS = ['wal_bytes', 'shared_blks_hit', 'shared_blks_read'] as const;

/* ------------------------------------------------------------------------- */
/* Types                                                                      */
/* ------------------------------------------------------------------------- */

/** Requirement 1.6: which source the reported statement costs came from. */
export type StatementCostSource = 'pg_stat_statements' | 'explain_analyze';

/** Design §2.2: `user_db` when the scoped reset ran, otherwise the delta path. */
export type ResetScope = 'user_db' | 'delta_without_reset';

/**
 * The minimum of `pg`'s `Pool` / `PoolClient` surface this module needs.
 *
 * Structural on purpose: a caller may pass a pool, a dedicated client, or a
 * wrapper, and this module never assumes ownership of the connection — it
 * issues no `BEGIN`, no `COMMIT`, and no `ROLLBACK`.
 */
export interface StatsClient {
  query<R extends QueryResultRow = QueryResultRow>(
    sql: string,
    values?: unknown[],
  ): Promise<QueryResult<R>>;
}

/** Which time columns this server's view exposes (renamed in PostgreSQL 13). */
export interface TimeColumnNames {
  total: string;
  mean: string;
  /** `exec` for `total_exec_time`/`mean_exec_time`, `legacy` for `total_time`/`mean_time`. */
  generation: 'exec' | 'legacy';
}

/** Result of {@link probePgStatStatements}. */
export interface PgStatStatementsCapability {
  /** True when `to_regclass('pg_stat_statements')` resolved. */
  available: boolean;
  /** The exact probe statement, recorded so the reading is reproducible. */
  probeSql: string;
  probedAtUtc: string;
  /** Requirement 1.6: recorded as a first-class field, never inferred later. */
  statementCostSource: StatementCostSource;
  /** Requirement 1.6: the absence itself, recorded rather than merely implied. */
  absence: { reason: string; recordedAtUtc: string } | null;
  serverVersionNum: number | null;
  /** Every column of the view, as read from the catalog. Empty when unavailable. */
  viewColumns: string[];
  /** Null when neither the `*_exec_time` nor the legacy `*_time` pair is present. */
  timeColumns: TimeColumnNames | null;
  /** Requested columns this server does not expose; each is recorded, not silently dropped. */
  missingColumns: string[];
  resetFunction: {
    exists: boolean;
    /** `pg_get_function_identity_arguments` per overload, widest first. */
    identityArguments: string[];
    maxArgumentCount: number;
    supportsScopedReset: boolean;
    reason: string | null;
  };
}

export interface ScopedResetOptions {
  /**
   * Wrap the reset in a savepoint. **Required** when the client is already
   * inside a transaction: a permission failure raises `42501`, which aborts the
   * enclosing transaction and would poison every later statement on it.
   */
  useSavepoint?: boolean;
  /** Savepoint name; must be a bare identifier. */
  savepointName?: string;
}

/** Result of {@link resetScopedToUserAndDatabase}. */
export interface ScopedResetOutcome {
  attempted: boolean;
  succeeded: boolean;
  scope: ResetScope;
  /** The statement issued, or null when the reset was not attempted. */
  sql: string | null;
  executedAtUtc: string | null;
  failureReason: string | null;
  failureSqlState: string | null;
  /** Non-empty for every outcome other than a successful scoped reset. */
  caveats: string[];
}

/** One row of the view, filtered to the current role and database. */
export interface PgStatStatementsRow {
  /** `bigint`, carried as text so a 64-bit id is never rounded. */
  queryid: string | null;
  /** `LEFT(query, prefixLength)`; null when the role may not see the text. */
  query: string | null;
  calls: number;
  totalExecTimeMs: number;
  meanExecTimeMs: number | null;
  rows: number;
  /** Null when the server does not expose the column. */
  walBytes: number | null;
  sharedBlksHit: number | null;
  sharedBlksRead: number | null;
}

/** Result of {@link captureSnapshot}. */
export interface PgStatStatementsSnapshot {
  capturedAtUtc: string;
  /** The exact statement issued, recorded for reproducibility. */
  sql: string;
  rows: PgStatStatementsRow[];
  missingColumns: string[];
  timeColumns: TimeColumnNames;
  queryPrefixLength: number;
}

/** One statement's movement across the measured window. */
export interface StatementDelta {
  /** `queryid`, or a query-text-derived key when the server reported none. */
  key: string;
  queryid: string | null;
  query: string | null;
  calls: number;
  totalExecTimeMs: number;
  /** `totalExecTimeMs / calls`, or null when `calls` is zero. */
  meanExecTimeMs: number | null;
  rows: number;
  walBytes: number | null;
  sharedBlksHit: number | null;
  sharedBlksRead: number | null;
  /** True when the statement had no opening-snapshot entry. */
  firstSeenInWindow: boolean;
  /** True when closing counters were below opening counters (eviction or foreign reset). */
  countersRewound: boolean;
}

/** Result of {@link diffSnapshots}. */
export interface PgStatStatementsDelta {
  rows: StatementDelta[];
  /** Summed `totalExecTimeMs` across `rows`; the denominator for time share. */
  totalExecTimeMs: number;
  totalCalls: number;
  /** Requirement 17.5: the arithmetic that produced every value in `rows`. */
  arithmetic: string;
  resetScope: ResetScope;
  /** Statements present at the start of the window and gone by its end. */
  evictedKeys: string[];
  caveats: string[];
  windowStartUtc: string | null;
  windowEndUtc: string;
}

/** A {@link StatementDelta} with its share of total measured database time. */
export interface StatementTimeShare extends StatementDelta {
  sharePct: number;
  /** Requirement 17.5: the arithmetic that produced `sharePct`. */
  shareFormula: string;
}

export interface StatementCostCaptureOptions {
  client: StatsClient;
  /** Provenance for the reported values; its environment gates the reset. */
  provenance: Provenance;
  /** Characters of `query` to retain. Defaults to {@link DEFAULT_QUERY_PREFIX_LENGTH}. */
  queryPrefixLength?: number;
  /**
   * Assert `provenance.environment` against the bench allowlist before issuing
   * the reset, which mutates shared statistics. Defaults to true.
   */
  assertEnvironment?: boolean;
  /** Passed through to {@link resetScopedToUserAndDatabase}. */
  reset?: ScopedResetOptions;
  /** Skip the reset entirely and measure the window as a delta. Defaults to false. */
  skipReset?: boolean;
}

/** Result of {@link StatementCostCapture.finish}. */
export interface StatementCostCaptureResult {
  statementCostSource: StatementCostSource;
  capability: PgStatStatementsCapability;
  reset: ScopedResetOutcome;
  /** Null when the extension is absent or the opening snapshot failed. */
  before: PgStatStatementsSnapshot | null;
  after: PgStatStatementsSnapshot | null;
  delta: PgStatStatementsDelta | null;
  provenance: Provenance;
  caveats: string[];
  /** Non-null when the capture degraded; recorded rather than thrown away. */
  failureReason: string | null;
}

/** Handle returned by {@link beginStatementCostCapture}. */
export interface StatementCostCapture {
  capability: PgStatStatementsCapability;
  reset: ScopedResetOutcome;
  before: PgStatStatementsSnapshot | null;
  /** Capture the closing snapshot and diff it against the opening one. */
  finish: () => Promise<StatementCostCaptureResult>;
}

export type StatementCountSource = 'in_process_counter' | 'pg_stat_statements';

/** What the caller knows about `scripts/lib/statement-counter.ts` for this run. */
export interface InProcessCounterAvailability {
  available: boolean;
  reason?: string | null;
}

/** Result of {@link resolveStatementCountAvailability}. */
export interface StatementCountAvailability {
  available: boolean;
  sources: StatementCountSource[];
  /** Null when at least one source is available; otherwise why none is. */
  reason: string | null;
}

/* ------------------------------------------------------------------------- */
/* Errors                                                                     */
/* ------------------------------------------------------------------------- */

/** Raised when the view exists but cannot be read in the shape this module needs. */
export class PgStatStatementsError extends Error {
  readonly exitCode = 2;

  constructor(message: string) {
    super(message);
    this.name = 'PgStatStatementsError';
  }
}

/* ------------------------------------------------------------------------- */
/* Internal helpers                                                           */
/* ------------------------------------------------------------------------- */

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/** The `SQLSTATE` a driver error carries, when it carries one. */
function sqlState(err: unknown): string | null {
  if (err && typeof err === 'object') {
    const code = (err as { code?: unknown }).code;
    if (typeof code === 'string' && code.trim() !== '') return code;
  }
  return null;
}

/**
 * Coerce a driver value to a finite number, or null.
 *
 * `bigint` and `numeric` columns arrive as strings from `pg`, so `calls`,
 * `rows`, `wal_bytes` and the block counters all pass through here.
 */
function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toText(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  return null;
}

function resolveTimeColumns(columns: readonly string[]): TimeColumnNames | null {
  const present = new Set(columns);
  if (present.has('total_exec_time') && present.has('mean_exec_time')) {
    return { total: 'total_exec_time', mean: 'mean_exec_time', generation: 'exec' };
  }
  if (present.has('total_time') && present.has('mean_time')) {
    return { total: 'total_time', mean: 'mean_time', generation: 'legacy' };
  }
  return null;
}

function assertPositiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new PgStatStatementsError(`${label} must be a positive integer, received ${String(value)}`);
  }
  return value;
}

function assertBareIdentifier(value: string, label: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new PgStatStatementsError(
      `${label} must be a bare SQL identifier, received ${JSON.stringify(value)}`,
    );
  }
  return value;
}

function unavailableCapability(reason: string, probedAtUtc: string): PgStatStatementsCapability {
  return {
    available: false,
    probeSql: PG_STAT_STATEMENTS_PROBE_SQL,
    probedAtUtc,
    statementCostSource: 'explain_analyze',
    absence: { reason, recordedAtUtc: probedAtUtc },
    serverVersionNum: null,
    viewColumns: [],
    timeColumns: null,
    missingColumns: [...OPTIONAL_COLUMNS],
    resetFunction: {
      exists: false,
      identityArguments: [],
      maxArgumentCount: 0,
      supportsScopedReset: false,
      reason: reason,
    },
  };
}

/* ------------------------------------------------------------------------- */
/* Capability probe (Requirement 1.6)                                         */
/* ------------------------------------------------------------------------- */

/**
 * Probe for `pg_stat_statements` and record what this server actually offers:
 * the view, its columns, the server version, and the reset function's argument
 * forms.
 *
 * Never throws for an absent extension or an unreadable catalog — absence is
 * the result, recorded with its reason and with
 * `statementCostSource: 'explain_analyze'` so the caller substitutes the
 * `EXPLAIN (ANALYZE, BUFFERS, VERBOSE)` source (Requirement 1.6).
 */
export async function probePgStatStatements(
  client: StatsClient,
): Promise<PgStatStatementsCapability> {
  const probedAtUtc = nowUtc();

  let available = false;
  try {
    const probe = await client.query<{ available: boolean | null }>(PG_STAT_STATEMENTS_PROBE_SQL);
    available = probe.rows[0]?.available === true;
  } catch (err) {
    return unavailableCapability(
      `The pg_stat_statements probe could not be executed: ${errorMessage(err)}`,
      probedAtUtc,
    );
  }

  if (!available) {
    return unavailableCapability(
      'pg_stat_statements is not installed in the measured database: ' +
        `${PG_STAT_STATEMENTS_PROBE_SQL} returned false. Statement costs are taken from ` +
        'EXPLAIN (ANALYZE, BUFFERS, VERBOSE) output instead.',
      probedAtUtc,
    );
  }

  let serverVersionNum: number | null = null;
  try {
    const version = await client.query<{ server_version_num: string | null }>(
      "SELECT current_setting('server_version_num') AS server_version_num",
    );
    serverVersionNum = toNumber(version.rows[0]?.server_version_num);
  } catch {
    serverVersionNum = null;
  }

  let viewColumns: string[] = [];
  try {
    const columns = await client.query<{ attname: string }>(
      `SELECT a.attname
         FROM pg_attribute a
        WHERE a.attrelid = to_regclass('pg_stat_statements')
          AND a.attnum > 0
          AND NOT a.attisdropped
        ORDER BY a.attnum`,
    );
    viewColumns = columns.rows.map((row) => row.attname);
  } catch (err) {
    return unavailableCapability(
      `pg_stat_statements resolved but its columns could not be read: ${errorMessage(err)}`,
      probedAtUtc,
    );
  }

  const timeColumns = resolveTimeColumns(viewColumns);
  const present = new Set(viewColumns);
  const missingColumns: string[] = OPTIONAL_COLUMNS.filter((column) => !present.has(column));
  if (timeColumns === null) {
    missingColumns.unshift('total_exec_time', 'mean_exec_time');
  }

  let identityArguments: string[] = [];
  let maxArgumentCount = 0;
  let resetExists = false;
  let resetProbeError: string | null = null;
  try {
    const reset = await client.query<{ pronargs: number | string; identity_arguments: string | null }>(
      `SELECT p.pronargs, pg_get_function_identity_arguments(p.oid) AS identity_arguments
         FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE p.proname = 'pg_stat_statements_reset'
        ORDER BY p.pronargs DESC`,
    );
    resetExists = reset.rows.length > 0;
    identityArguments = reset.rows.map((row) => row.identity_arguments ?? '');
    for (const row of reset.rows) {
      maxArgumentCount = Math.max(maxArgumentCount, toNumber(row.pronargs) ?? 0);
    }
  } catch (err) {
    resetProbeError = errorMessage(err);
  }

  const supportsScopedReset = resetExists && maxArgumentCount >= 2;
  let resetReason: string | null = null;
  if (resetProbeError !== null) {
    resetReason = `pg_stat_statements_reset could not be probed: ${resetProbeError}`;
  } else if (!resetExists) {
    resetReason =
      'pg_stat_statements_reset is not present in this database, so the window cannot be bracketed by a reset.';
  } else if (!supportsScopedReset) {
    resetReason =
      `pg_stat_statements_reset takes ${String(maxArgumentCount)} argument(s), so the ` +
      '(userid, dbid) scoped form documented from PostgreSQL 13 is unavailable. The unscoped form would ' +
      "reset the whole cluster's statistics and is never issued.";
  } else if (
    serverVersionNum !== null &&
    serverVersionNum < MIN_SCOPED_RESET_SERVER_VERSION_NUM
  ) {
    resetReason =
      `server_version_num ${String(serverVersionNum)} is below ` +
      `${String(MIN_SCOPED_RESET_SERVER_VERSION_NUM)}, but the catalog probe reports ` +
      `${String(maxArgumentCount)} arguments, so the scoped form is used on the probe's authority.`;
  }

  return {
    available: true,
    probeSql: PG_STAT_STATEMENTS_PROBE_SQL,
    probedAtUtc,
    statementCostSource: 'pg_stat_statements',
    absence: null,
    serverVersionNum,
    viewColumns,
    timeColumns,
    missingColumns,
    resetFunction: {
      exists: resetExists,
      identityArguments,
      maxArgumentCount,
      supportsScopedReset,
      reason: resetReason,
    },
  };
}

/* ------------------------------------------------------------------------- */
/* Scoped reset (design §2.2)                                                 */
/* ------------------------------------------------------------------------- */

/**
 * Reset this role's statements in this database, leaving every other role and
 * database untouched so the measurement stays valid on a shared cluster.
 *
 * A refused reset is not an error: the outcome carries
 * `scope: 'delta_without_reset'` plus {@link DELTA_WITHOUT_RESET_CAVEAT}, and
 * the caller measures the window as a two-snapshot delta whose figures are
 * upper bounds.
 *
 * Pass `useSavepoint: true` when the client is inside a transaction — a
 * permission failure raises `42501` and would otherwise abort it.
 */
export async function resetScopedToUserAndDatabase(
  client: StatsClient,
  capability: PgStatStatementsCapability,
  options: ScopedResetOptions = {},
): Promise<ScopedResetOutcome> {
  if (!capability.available) {
    return {
      attempted: false,
      succeeded: false,
      scope: 'delta_without_reset',
      sql: null,
      executedAtUtc: null,
      failureReason:
        capability.absence?.reason ?? 'pg_stat_statements is unavailable in the measured database.',
      failureSqlState: null,
      caveats: [DELTA_WITHOUT_RESET_CAVEAT],
    };
  }

  if (!capability.resetFunction.supportsScopedReset) {
    return {
      attempted: false,
      succeeded: false,
      scope: 'delta_without_reset',
      sql: null,
      executedAtUtc: null,
      failureReason:
        capability.resetFunction.reason ??
        'The (userid, dbid) scoped form of pg_stat_statements_reset is unavailable on this server.',
      failureSqlState: null,
      caveats: [DELTA_WITHOUT_RESET_CAVEAT],
    };
  }

  const useSavepoint = options.useSavepoint === true;
  const savepointName = assertBareIdentifier(
    options.savepointName ?? 'pgss_scoped_reset',
    'savepointName',
  );

  if (useSavepoint) {
    try {
      await client.query(`SAVEPOINT ${savepointName}`);
    } catch (err) {
      return {
        attempted: false,
        succeeded: false,
        scope: 'delta_without_reset',
        sql: null,
        executedAtUtc: null,
        failureReason: `SAVEPOINT ${savepointName} failed, so the reset was not attempted: ${errorMessage(err)}`,
        failureSqlState: sqlState(err),
        caveats: [DELTA_WITHOUT_RESET_CAVEAT],
      };
    }
  }

  try {
    await client.query(PG_STAT_STATEMENTS_SCOPED_RESET_SQL);
    if (useSavepoint) {
      await client.query(`RELEASE SAVEPOINT ${savepointName}`);
    }
    return {
      attempted: true,
      succeeded: true,
      scope: 'user_db',
      sql: PG_STAT_STATEMENTS_SCOPED_RESET_SQL,
      executedAtUtc: nowUtc(),
      failureReason: null,
      failureSqlState: null,
      caveats: [],
    };
  } catch (err) {
    const state = sqlState(err);
    if (useSavepoint) {
      try {
        await client.query(`ROLLBACK TO SAVEPOINT ${savepointName}`);
        await client.query(`RELEASE SAVEPOINT ${savepointName}`);
      } catch {
        // The transaction is already unusable; the caller sees the reset failure
        // and the enclosing harness owns the rollback.
      }
    }
    return {
      attempted: true,
      succeeded: false,
      scope: 'delta_without_reset',
      sql: PG_STAT_STATEMENTS_SCOPED_RESET_SQL,
      executedAtUtc: null,
      failureReason:
        `The scoped pg_stat_statements_reset was refused${state === null ? '' : ` (SQLSTATE ${state})`}: ` +
        `${errorMessage(err)}. Resetting requires pg_read_all_stats plus EXECUTE on the function, or ` +
        'superuser. Falling back to a two-snapshot delta.',
      failureSqlState: state,
      caveats: [DELTA_WITHOUT_RESET_CAVEAT],
    };
  }
}

/* ------------------------------------------------------------------------- */
/* Snapshot capture (Requirement 8.3)                                         */
/* ------------------------------------------------------------------------- */

/**
 * Build the capture statement from design §2.2, substituting `NULL` for any
 * column this server does not expose so a degraded server still yields the
 * columns it has.
 */
export function buildSnapshotSql(
  capability: PgStatStatementsCapability,
  queryPrefixLength: number = DEFAULT_QUERY_PREFIX_LENGTH,
): { sql: string; timeColumns: TimeColumnNames; missingColumns: string[] } {
  if (!capability.available) {
    throw new PgStatStatementsError(
      'Cannot build a pg_stat_statements capture statement: the extension is unavailable. ' +
        `Recorded absence: ${capability.absence?.reason ?? 'unknown'}`,
    );
  }

  const timeColumns = capability.timeColumns;
  if (timeColumns === null) {
    throw new PgStatStatementsError(
      'pg_stat_statements exposes neither total_exec_time/mean_exec_time nor total_time/mean_time, ' +
        `so statement cost cannot be read. Columns present: ${capability.viewColumns.join(', ')}`,
    );
  }

  const prefix = assertPositiveInteger(queryPrefixLength, 'queryPrefixLength');
  const present = new Set(capability.viewColumns);
  const missingColumns: string[] = [];

  const optional = (column: string, cast: string): string => {
    if (present.has(column)) return `${column} AS ${column}`;
    missingColumns.push(column);
    return `NULL::${cast} AS ${column}`;
  };

  const sql = `SELECT queryid::text AS queryid,
       LEFT(query, ${String(prefix)}) AS query,
       calls,
       ${timeColumns.total} AS total_exec_time,
       ${timeColumns.mean} AS mean_exec_time,
       rows,
       ${optional('wal_bytes', 'numeric')},
       ${optional('shared_blks_hit', 'bigint')},
       ${optional('shared_blks_read', 'bigint')}
  FROM pg_stat_statements
 WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
   AND userid = (SELECT oid FROM pg_roles WHERE rolname = current_user)
 ORDER BY ${timeColumns.total} DESC`;

  return { sql, timeColumns, missingColumns };
}

interface RawSnapshotRow extends QueryResultRow {
  queryid: string | null;
  query: string | null;
  calls: string | number | null;
  total_exec_time: string | number | null;
  mean_exec_time: string | number | null;
  rows: string | number | null;
  wal_bytes: string | number | null;
  shared_blks_hit: string | number | null;
  shared_blks_read: string | number | null;
}

/**
 * Capture one snapshot of this role's statements in this database.
 *
 * Filtering by `(userid, dbid)` matches the reset's scope, so a snapshot pair
 * describes the same population whether or not the reset succeeded.
 */
export async function captureSnapshot(
  client: StatsClient,
  capability: PgStatStatementsCapability,
  queryPrefixLength: number = DEFAULT_QUERY_PREFIX_LENGTH,
): Promise<PgStatStatementsSnapshot> {
  const { sql, timeColumns, missingColumns } = buildSnapshotSql(capability, queryPrefixLength);
  const capturedAtUtc = nowUtc();

  let result: QueryResult<RawSnapshotRow>;
  try {
    result = await client.query<RawSnapshotRow>(sql);
  } catch (err) {
    throw new PgStatStatementsError(
      `The pg_stat_statements capture statement failed: ${errorMessage(err)}`,
    );
  }

  const rows: PgStatStatementsRow[] = result.rows.map((row) => ({
    queryid: toText(row.queryid),
    query: toText(row.query),
    calls: toNumber(row.calls) ?? 0,
    totalExecTimeMs: toNumber(row.total_exec_time) ?? 0,
    meanExecTimeMs: toNumber(row.mean_exec_time),
    rows: toNumber(row.rows) ?? 0,
    walBytes: toNumber(row.wal_bytes),
    sharedBlksHit: toNumber(row.shared_blks_hit),
    sharedBlksRead: toNumber(row.shared_blks_read),
  }));

  return {
    capturedAtUtc,
    sql,
    rows,
    missingColumns,
    timeColumns,
    queryPrefixLength: assertPositiveInteger(queryPrefixLength, 'queryPrefixLength'),
  };
}

/* ------------------------------------------------------------------------- */
/* Delta (design §2.2 fallback path)                                          */
/* ------------------------------------------------------------------------- */

/** Key a row by `queryid`, falling back to its text when the server reported none. */
function rowKey(row: PgStatStatementsRow): string {
  if (row.queryid !== null && row.queryid.trim() !== '') return row.queryid;
  return `no_queryid:${row.query ?? ''}`;
}

function subtractOptional(after: number | null, before: number | null): number | null {
  if (after === null) return null;
  if (before === null) return after;
  const delta = after - before;
  return delta < 0 ? after : delta;
}

/**
 * Difference two snapshots into per-statement movement across the window.
 *
 * `before` may be null when only a closing snapshot exists — after a successful
 * scoped reset the closing snapshot *is* the window. Passing both snapshots is
 * still preferred: it is what makes the `delta_without_reset` path measurable.
 *
 * A statement whose closing `calls` fall below its opening `calls` was evicted
 * or reset by another session mid-window. Its delta is taken from the closing
 * snapshot alone, the row is flagged `countersRewound`, and
 * {@link COUNTERS_REWOUND_CAVEAT} is recorded — rather than reporting a
 * negative count as though it were real.
 */
export function diffSnapshots(
  before: PgStatStatementsSnapshot | null,
  after: PgStatStatementsSnapshot,
  resetScope: ResetScope,
): PgStatStatementsDelta {
  const beforeByKey = new Map<string, PgStatStatementsRow>();
  for (const row of before?.rows ?? []) {
    beforeByKey.set(rowKey(row), row);
  }

  const rows: StatementDelta[] = [];
  const seen = new Set<string>();
  let countersRewound = false;

  for (const afterRow of after.rows) {
    const key = rowKey(afterRow);
    seen.add(key);
    const beforeRow = beforeByKey.get(key);

    const rewound = beforeRow !== undefined && afterRow.calls < beforeRow.calls;
    if (rewound) countersRewound = true;

    const base = rewound ? undefined : beforeRow;
    const calls = afterRow.calls - (base?.calls ?? 0);
    const totalExecTimeMs = afterRow.totalExecTimeMs - (base?.totalExecTimeMs ?? 0);
    const rowsDelta = afterRow.rows - (base?.rows ?? 0);

    if (calls === 0 && totalExecTimeMs === 0 && rowsDelta === 0) continue;

    rows.push({
      key,
      queryid: afterRow.queryid,
      query: afterRow.query,
      calls,
      totalExecTimeMs,
      meanExecTimeMs: calls > 0 ? totalExecTimeMs / calls : null,
      rows: rowsDelta,
      walBytes: subtractOptional(afterRow.walBytes, base?.walBytes ?? null),
      sharedBlksHit: subtractOptional(afterRow.sharedBlksHit, base?.sharedBlksHit ?? null),
      sharedBlksRead: subtractOptional(afterRow.sharedBlksRead, base?.sharedBlksRead ?? null),
      firstSeenInWindow: beforeRow === undefined,
      countersRewound: rewound,
    });
  }

  const evictedKeys = [...beforeByKey.keys()].filter((key) => !seen.has(key));

  const caveats: string[] = [];
  if (resetScope === 'delta_without_reset') caveats.push(DELTA_WITHOUT_RESET_CAVEAT);
  if (countersRewound) caveats.push(COUNTERS_REWOUND_CAVEAT);
  if (evictedKeys.length > 0) {
    caveats.push(
      `${String(evictedKeys.length)} statement(s) present at the start of the window were absent at its ` +
        'end, so their in-window cost is not recorded. pg_stat_statements evicts the least-executed ' +
        'entries once pg_stat_statements.max is reached.',
    );
  }

  rows.sort((a, b) => b.totalExecTimeMs - a.totalExecTimeMs);

  return {
    rows,
    totalExecTimeMs: rows.reduce((sum, row) => sum + row.totalExecTimeMs, 0),
    totalCalls: rows.reduce((sum, row) => sum + row.calls, 0),
    arithmetic:
      'per statement: delta = closing snapshot value - opening snapshot value; ' +
      'meanExecTimeMs = totalExecTimeMs / calls; ' +
      'a statement whose closing calls fell below its opening calls uses the closing value alone',
    resetScope,
    evictedKeys,
    caveats,
    windowStartUtc: before?.capturedAtUtc ?? null,
    windowEndUtc: after.capturedAtUtc,
  };
}

/**
 * Statements at or above `minSharePct` of total measured database time
 * (Requirement 8.3, default 1 percent), highest share first.
 *
 * Returns an empty list when the window recorded no execution time: a share of
 * a zero denominator is undefined, and reporting one would be a fabricated
 * number. Requirement 8.3 also asks for a p95 duration, which
 * `pg_stat_statements` does not expose — that value comes from the in-process
 * counter's per-call records.
 */
export function selectStatementsAboveTimeShare(
  delta: PgStatStatementsDelta,
  minSharePct: number = DEFAULT_MIN_TIME_SHARE_PCT,
): StatementTimeShare[] {
  const total = delta.totalExecTimeMs;
  if (!(total > 0)) return [];

  return delta.rows
    .map((row) => {
      const sharePct = (row.totalExecTimeMs / total) * 100;
      return {
        ...row,
        sharePct,
        shareFormula: `${row.totalExecTimeMs.toFixed(3)} / ${total.toFixed(3)} * 100 = ${sharePct.toFixed(3)}%`,
      };
    })
    .filter((row) => row.sharePct >= minSharePct)
    .sort((a, b) => b.sharePct - a.sharePct);
}

/* ------------------------------------------------------------------------- */
/* Capture session                                                            */
/* ------------------------------------------------------------------------- */

/**
 * Probe, reset if permitted, and take the opening snapshot; `finish()` takes the
 * closing snapshot and returns the delta with its recorded degradations.
 *
 * The opening snapshot is taken even after a successful reset — it should be
 * near-empty, and capturing it keeps one code path and makes any concurrent
 * same-role activity visible instead of assumed away.
 *
 * `provenance.environment` is asserted against the bench allowlist before the
 * reset, because a reset mutates shared statistics. Pass
 * `assertEnvironment: false` only for a read-only capture on a client whose
 * environment the caller has already gated.
 */
export async function beginStatementCostCapture(
  options: StatementCostCaptureOptions,
): Promise<StatementCostCapture> {
  const { client, provenance } = options;
  const queryPrefixLength = options.queryPrefixLength ?? DEFAULT_QUERY_PREFIX_LENGTH;

  if (options.assertEnvironment !== false) {
    assertBenchEnvironment(provenance.environment);
  }

  const capability = await probePgStatStatements(client);

  const reset: ScopedResetOutcome =
    options.skipReset === true
      ? {
          attempted: false,
          succeeded: false,
          scope: 'delta_without_reset',
          sql: null,
          executedAtUtc: null,
          failureReason: 'The caller requested skipReset, so the window is measured as a delta.',
          failureSqlState: null,
          caveats: [DELTA_WITHOUT_RESET_CAVEAT],
        }
      : await resetScopedToUserAndDatabase(client, capability, options.reset ?? {});

  let before: PgStatStatementsSnapshot | null = null;
  let openingFailure: string | null = null;
  if (capability.available) {
    try {
      before = await captureSnapshot(client, capability, queryPrefixLength);
    } catch (err) {
      openingFailure = errorMessage(err);
    }
  }

  const baseResult = (
    after: PgStatStatementsSnapshot | null,
    delta: PgStatStatementsDelta | null,
    failureReason: string | null,
    extraCaveats: string[],
  ): StatementCostCaptureResult => ({
    statementCostSource: capability.available && delta !== null ? 'pg_stat_statements' : 'explain_analyze',
    capability,
    reset,
    before,
    after,
    delta,
    provenance,
    caveats: [...new Set([...reset.caveats, ...(delta?.caveats ?? []), ...extraCaveats])],
    failureReason,
  });

  return {
    capability,
    reset,
    before,
    finish: async (): Promise<StatementCostCaptureResult> => {
      if (!capability.available) {
        return baseResult(null, null, capability.absence?.reason ?? null, []);
      }
      if (openingFailure !== null) {
        return baseResult(
          null,
          null,
          `The opening pg_stat_statements snapshot failed, so no delta can be computed: ${openingFailure}`,
          [],
        );
      }

      let after: PgStatStatementsSnapshot;
      try {
        after = await captureSnapshot(client, capability, queryPrefixLength);
      } catch (err) {
        return baseResult(
          null,
          null,
          `The closing pg_stat_statements snapshot failed, so no delta can be computed: ${errorMessage(err)}`,
          [],
        );
      }

      const delta = diffSnapshots(before, after, reset.scope);
      const extraCaveats =
        capability.missingColumns.length === 0
          ? []
          : [
              `This server does not expose ${capability.missingColumns.join(', ')} on ` +
                'pg_stat_statements, so those values are recorded as null rather than estimated.',
            ];
      return baseResult(after, delta, null, extraCaveats);
    },
  };
}

/* ------------------------------------------------------------------------- */
/* Availability and the Unmeasured_Declaration (Requirement 9.8)              */
/* ------------------------------------------------------------------------- */

/**
 * Decide which statement-count sources are usable for this run.
 *
 * The in-process counter is listed first because it is the authoritative source
 * for the per-batch statement counts of Requirements 2.7, 9.1 and 21.3; it has
 * no database dependency beyond the connection, so "neither source available"
 * is expected only under total unreachability.
 */
export function resolveStatementCountAvailability(input: {
  capability: PgStatStatementsCapability | null;
  inProcessCounter: InProcessCounterAvailability;
}): StatementCountAvailability {
  const sources: StatementCountSource[] = [];
  if (input.inProcessCounter.available) sources.push('in_process_counter');
  if (input.capability?.available === true) sources.push('pg_stat_statements');

  if (sources.length > 0) {
    return { available: true, sources, reason: null };
  }

  const counterReason =
    input.inProcessCounter.reason ?? 'the in-process statement counter could not be run';
  const extensionReason =
    input.capability === null
      ? 'pg_stat_statements was not probed'
      : (input.capability.absence?.reason ?? 'pg_stat_statements is unavailable');

  return {
    available: false,
    sources,
    reason:
      'Neither statement-count source was available: ' +
      `${counterReason}; ${extensionReason}. ` +
      'Requirement 9.8 records the statement count as unmeasured for every affected batch size.',
  };
}

/**
 * Record a statement-count metric as unmeasured (Requirement 9.8).
 *
 * The Unmeasured_Declaration itself comes from
 * `scripts/lib/ingestion-evidence.ts`, so the byte-exact sentence cannot drift.
 * Throws when a source *was* available: reporting a metric as unmeasured while
 * a source could have produced it would corrupt the evidence just as surely as
 * inventing the number.
 */
export function recordStatementCountUnmeasured<T>(
  availability: StatementCountAvailability,
  provenance: Provenance,
): Measured<T> {
  if (availability.available) {
    throw new PgStatStatementsError(
      'recordStatementCountUnmeasured() was called while a statement-count source was available ' +
        `(${availability.sources.join(', ')}). Measure the metric instead of declaring it unmeasured.`,
    );
  }

  return recordUnmeasured<T>(
    availability.reason ?? 'No statement-count source was available for this run.',
    provenance,
  );
}
