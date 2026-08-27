/**
 * The provenance envelope every ingestion Phase 2 measurement carries.
 *
 * Two rules govern the whole Phase 2 program and this module is where both are
 * made structural rather than left to discipline:
 *
 *   1. No number is reported that a command did not produce (Requirement 17.4).
 *      Every value is wrapped in `Measured<T>`, which is either a measured
 *      value with a complete `Provenance` envelope, or the byte-exact sentence
 *      `Runtime throughput could not be measured.` plus a reason. There is no
 *      third state, and `validateEvidenceEntry()` exists to catch one.
 *
 *   2. Nothing is measured against an environment that is not a staging or
 *      benchmark environment (Requirement 5.4, Requirement 8.5).
 *      `assertBenchEnvironment()` is called before any database work and exits
 *      non-zero rather than degrading.
 *
 * The allowlist is read directly from `process.env` here, NOT from
 * `src/config/env.ts`, because `src/config/env.ts` is one of the four guarded
 * paths whose first modification must follow the Baseline_Record timestamp
 * (Requirement 1.4). Task 6.4 promotes the setting into the Zod-validated
 * config once the baseline has been captured; this module's default must stay
 * identical to the default that lands there.
 *
 * Design references: §1.1 (provenance envelope), §1.2 (baseline production and
 * the clean-tree gate).
 */
import { spawnSync } from 'child_process';

/**
 * Requirement 1.5, 8.7, 9.8, 10.8, 11.8, 13.7, 17.7, 20.9 all demand this
 * exact sentence. It is compared byte for byte, so it is declared once and
 * never re-typed.
 */
export const UNMEASURED = 'Runtime throughput could not be measured.' as const;

export type UnmeasuredDeclaration = typeof UNMEASURED;

/** The environment variable that overrides the measurement environment allowlist. */
export const BENCH_ENV_ALLOWLIST_VAR = 'INGESTION_BENCH_ENV_ALLOWLIST' as const;

/**
 * Default measurement environment allowlist. Must stay identical to the default
 * task 6.4 gives `INGESTION_BENCH_ENV_ALLOWLIST` in `src/config/env.ts`.
 * `benchmark` is included because it is the existing default `--environment`
 * label of `bench-ingestion-worker.ts` and `explain-ingestion-writes.ts`.
 */
export const DEFAULT_BENCH_ENV_ALLOWLIST: readonly string[] = [
  'staging',
  'bench',
  'benchmark',
  'local',
];

/**
 * The four paths whose first modification must follow the Baseline_Record
 * timestamp (Requirement 1.4). A trailing slash means "this prefix"; no
 * trailing slash means "this exact file".
 */
export const GUARDED_BASELINE_PATHS: readonly string[] = [
  'src/modules/ingestion/',
  'src/modules/errors/',
  'database/migrations/logdb/',
  'src/config/env.ts',
];

/** Recorded for every measurement so Requirement 17.6 holds by construction. */
export interface Provenance {
  /** Exact argv of the command that produced the value. */
  command: string;
  /** Resolved environment label; must match the bench/staging allowlist. */
  environment: string;
  /** ISO 8601 UTC timestamp of the run. */
  timestampUtc: string;
  /** `git rev-parse HEAD` of the measured working tree. */
  gitCommit: string;
  /** Number of runs the reported value summarizes. */
  repetitions: number;
}

/**
 * A measurement, or the recorded absence of one. Requirement 17.7: the absence
 * of a measurement is a first-class result, never a substituted estimate.
 */
export type Measured<T> =
  | {
      status: 'measured';
      value: T;
      runs: T[];
      median: T;
      min: T;
      max: T;
      provenance: Provenance;
    }
  | {
      status: 'unmeasured';
      declaration: UnmeasuredDeclaration;
      reason: string;
      provenance: Provenance;
    };

/**
 * A value computed from more than one recorded measurement. Requirement 17.5
 * requires each constituent measurement and the arithmetic to be recorded
 * alongside the derived number, so a reviewer can recompute it.
 */
export interface DerivedConstituent {
  label: string;
  measurement: Measured<number> | number;
}

export interface Derived<T> {
  status: 'derived';
  value: T;
  constituents: DerivedConstituent[];
  /** The arithmetic that produced `value`, e.g. `(present - absent) / absent * 100`. */
  arithmetic: string;
  provenance: Provenance;
}

export type EvidenceEntry<T> = Measured<T> | Derived<T>;

/* ------------------------------------------------------------------------- */
/* Errors                                                                     */
/* ------------------------------------------------------------------------- */

/**
 * Base class for every failure this module raises. `exitCode` is 2 to match the
 * convention the existing ingestion scripts use for a refusal to proceed, so a
 * caller can `process.exit(err.exitCode)` without inventing a code.
 */
export class EvidenceError extends Error {
  readonly exitCode: number = 2;

  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** Thrown by `assertBenchEnvironment()` before any database work is attempted. */
export class BenchEnvironmentError extends EvidenceError {}

/** Thrown by `captureProvenance()` when the working tree cannot be identified. */
export class ProvenanceCaptureError extends EvidenceError {}

/** Thrown by the `record*` constructors and `assertEvidenceEntry()`. */
export class EvidenceValidationError extends EvidenceError {
  readonly issues: readonly string[];

  constructor(message: string, issues: readonly string[]) {
    super(`${message}: ${issues.join('; ')}`);
    this.issues = [...issues];
  }
}

/* ------------------------------------------------------------------------- */
/* Environment allowlist (Requirement 5.4, 8.5)                               */
/* ------------------------------------------------------------------------- */

function normalizeLabel(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Resolve the allowlist from `process.env.INGESTION_BENCH_ENV_ALLOWLIST`,
 * falling back to {@link DEFAULT_BENCH_ENV_ALLOWLIST} when the variable is
 * unset or blank.
 *
 * A variable that is set but contains no usable entry (for example `",,"`) is a
 * configuration error rather than a request for the default: silently widening
 * back to the default would let a misconfigured deploy measure anywhere.
 */
export function resolveBenchEnvironmentAllowlist(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const raw = env[BENCH_ENV_ALLOWLIST_VAR];
  if (raw === undefined || raw.trim() === '') {
    return [...DEFAULT_BENCH_ENV_ALLOWLIST];
  }

  const entries = raw
    .split(',')
    .map(normalizeLabel)
    .filter((entry) => entry !== '');

  if (entries.length === 0) {
    throw new BenchEnvironmentError(
      `${BENCH_ENV_ALLOWLIST_VAR} is set to ${JSON.stringify(raw)}, which contains no environment label. ` +
        `Unset it to use the default allowlist (${DEFAULT_BENCH_ENV_ALLOWLIST.join(', ')}) ` +
        'or set it to a comma-separated list of labels.',
    );
  }

  return [...new Set(entries)];
}

/** Non-throwing allowlist membership test, for use inside validation gates. */
export function isBenchEnvironmentAllowed(
  label: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return resolveBenchEnvironmentAllowlist(env).includes(normalizeLabel(label));
}

/**
 * Abort unless `label` names an allowlisted staging or benchmark environment.
 *
 * Call this before opening a connection, issuing DDL, or running
 * `EXPLAIN ANALYZE`. It throws a {@link BenchEnvironmentError} carrying
 * `exitCode = 2`, so the caller exits non-zero having measured nothing and
 * changed nothing.
 */
export function assertBenchEnvironment(
  label: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const allowlist = resolveBenchEnvironmentAllowlist(env);
  const normalized = normalizeLabel(label);

  if (normalized === '') {
    throw new BenchEnvironmentError(
      'Measurement environment label is empty. Pass --environment <label> naming a staging or ' +
        `benchmark environment. Allowed labels: ${allowlist.join(', ')}.`,
    );
  }

  if (!allowlist.includes(normalized)) {
    throw new BenchEnvironmentError(
      `Refusing to measure against environment ${JSON.stringify(label)}: it is not in the ` +
        `${BENCH_ENV_ALLOWLIST_VAR} allowlist (${allowlist.join(', ')}). ` +
        'Requirements 5.4 and 8.5 permit measurement only in a staging or benchmark environment. ' +
        `Nothing was measured and nothing was changed. Set ${BENCH_ENV_ALLOWLIST_VAR} to include ` +
        'the label only if it truly names a staging or benchmark environment.',
    );
  }

  return normalized;
}

/* ------------------------------------------------------------------------- */
/* Provenance capture (Requirement 1.2, 1.4)                                  */
/* ------------------------------------------------------------------------- */

/** One entry of `git status --porcelain`. */
export interface DirtyFile {
  /** The two-character porcelain status field, e.g. ` M`, `??`, `R `. */
  status: string;
  /** Repository-relative path, forward-slashed. */
  path: string;
  /** Populated for renames and copies: the pre-rename path. */
  originalPath: string | null;
  /** True when `path` or `originalPath` falls under {@link GUARDED_BASELINE_PATHS}. */
  guarded: boolean;
}

/** The working-tree state a Baseline_Record must record (Requirement 1.4). */
export interface TreeState {
  gitCommit: string;
  /** Verbatim `git status --porcelain` output, recorded for the evidence bundle. */
  porcelain: string;
  dirtyFiles: DirtyFile[];
  /** Dirty paths under the four guarded paths. Non-empty invalidates a baseline. */
  guardedDirtyFiles: string[];
  /** Requirement 1.4 gate: true when no guarded path is dirty. */
  cleanTree: boolean;
}

export interface CaptureProvenanceInput {
  /** Exact argv of the command being recorded. */
  command: string;
  /** Environment label; validated against the allowlist when `assertEnvironment` is true. */
  environment: string;
  /** Runs the reported value will summarize. Use 0 for an unmeasured record. */
  repetitions: number;
  /** Override the recorded timestamp; defaults to now. */
  timestampUtc?: string;
  /** Working directory for the git invocations; defaults to `process.cwd()`. */
  cwd?: string;
  /** Environment used to resolve the allowlist; defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
  /** Assert the environment label against the allowlist. Defaults to true. */
  assertEnvironment?: boolean;
}

export interface CapturedProvenance {
  provenance: Provenance;
  tree: TreeState;
}

/** Current time as an ISO 8601 UTC timestamp. */
export function nowUtc(): string {
  return new Date().toISOString();
}

function runGit(args: string[], cwd: string): string {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
  });

  if (result.error) {
    throw new ProvenanceCaptureError(
      `Could not run \`git ${args.join(' ')}\` in ${cwd}: ${result.error.message}. ` +
        'Requirement 1.2 requires the Git commit of the measured working tree, so the run is ' +
        'aborted rather than recorded without provenance.',
    );
  }

  if (result.status !== 0) {
    const stderr = (result.stderr ?? '').trim();
    throw new ProvenanceCaptureError(
      `\`git ${args.join(' ')}\` exited ${String(result.status)} in ${cwd}` +
        (stderr === '' ? '' : `: ${stderr}`) +
        '. Requirement 1.2 requires the Git commit of the measured working tree, so the run is ' +
        'aborted rather than recorded without provenance.',
    );
  }

  return result.stdout ?? '';
}

/**
 * Decode a `git status --porcelain` path field.
 *
 * Git quotes a path and C-escapes it whenever it contains a special or
 * non-ASCII byte. Octal escapes are individual bytes of a UTF-8 sequence, so
 * the bytes are collected and decoded together rather than one at a time.
 */
export function unquoteGitPath(value: string): string {
  if (value.length < 2 || !value.startsWith('"') || !value.endsWith('"')) {
    return value;
  }

  const inner = value.slice(1, -1);
  const bytes: number[] = [];

  for (let i = 0; i < inner.length; i += 1) {
    const ch = inner[i];
    if (ch === undefined) break;

    if (ch !== '\\') {
      for (const byte of Buffer.from(ch, 'utf8')) bytes.push(byte);
      continue;
    }

    const next = inner[i + 1];
    if (next === undefined) {
      bytes.push(0x5c);
      break;
    }
    i += 1;

    if (next === 'n') { bytes.push(0x0a); continue; }
    if (next === 't') { bytes.push(0x09); continue; }
    if (next === 'r') { bytes.push(0x0d); continue; }
    if (next === 'a') { bytes.push(0x07); continue; }
    if (next === 'b') { bytes.push(0x08); continue; }
    if (next === 'f') { bytes.push(0x0c); continue; }
    if (next === 'v') { bytes.push(0x0b); continue; }
    if (next === '"' || next === '\\') {
      for (const byte of Buffer.from(next, 'utf8')) bytes.push(byte);
      continue;
    }

    const octal = inner.slice(i, i + 3);
    if (/^[0-7]{3}$/.test(octal)) {
      bytes.push(parseInt(octal, 8));
      i += 2;
      continue;
    }

    for (const byte of Buffer.from(next, 'utf8')) bytes.push(byte);
  }

  return Buffer.from(bytes).toString('utf8');
}

/** True when `path` falls under one of {@link GUARDED_BASELINE_PATHS}. */
export function isGuardedBaselinePath(path: string): boolean {
  const normalized = path.replace(/\\/g, '/').replace(/^\.\//, '');
  return GUARDED_BASELINE_PATHS.some((guarded) =>
    guarded.endsWith('/') ? normalized.startsWith(guarded) : normalized === guarded,
  );
}

/** Parse `git status --porcelain` output into typed entries. */
export function parsePorcelain(porcelain: string): DirtyFile[] {
  const files: DirtyFile[] = [];

  for (const rawLine of porcelain.replace(/\r\n/g, '\n').split('\n')) {
    if (rawLine.trim() === '') continue;

    const status = rawLine.slice(0, 2);
    const pathField = rawLine.slice(3).trim();
    if (pathField === '') continue;

    const arrow = pathField.indexOf(' -> ');
    let originalPath: string | null = null;
    let pathPart = pathField;
    if (arrow >= 0) {
      originalPath = unquoteGitPath(pathField.slice(0, arrow).trim()).replace(/\\/g, '/');
      pathPart = pathField.slice(arrow + 4).trim();
    }

    const path = unquoteGitPath(pathPart).replace(/\\/g, '/');
    files.push({
      status,
      path,
      originalPath,
      guarded:
        isGuardedBaselinePath(path) ||
        (originalPath !== null && isGuardedBaselinePath(originalPath)),
    });
  }

  return files;
}

/**
 * Capture the provenance envelope and the working-tree state for a measurement
 * run by shelling `git rev-parse HEAD` and `git status --porcelain`.
 *
 * The returned `tree.guardedDirtyFiles` is what the Requirement 1.4 clean-tree
 * gate consumes: a Baseline_Record is only valid while it is empty, because a
 * dirty guarded path means the baseline no longer precedes the first change to
 * the ingestion write path.
 *
 * Fails fast when git cannot be reached, since a run whose commit cannot be
 * identified can never satisfy Requirement 1.2 and is better aborted before it
 * spends an hour producing an unusable bundle.
 */
export function captureProvenance(input: CaptureProvenanceInput): CapturedProvenance {
  const cwd = input.cwd ?? process.cwd();
  const env = input.env ?? process.env;

  const environment =
    input.assertEnvironment === false
      ? input.environment.trim()
      : assertBenchEnvironment(input.environment, env);

  const gitCommit = runGit(['rev-parse', 'HEAD'], cwd).trim();
  if (gitCommit === '') {
    throw new ProvenanceCaptureError(
      `\`git rev-parse HEAD\` produced no commit in ${cwd}. Requirement 1.2 requires the Git ` +
        'commit of the measured working tree.',
    );
  }

  const porcelain = runGit(['status', '--porcelain'], cwd);
  const dirtyFiles = parsePorcelain(porcelain);
  const guardedDirtyFiles = dirtyFiles.filter((file) => file.guarded).map((file) => file.path);

  const provenance: Provenance = {
    command: input.command,
    environment,
    timestampUtc: input.timestampUtc ?? nowUtc(),
    gitCommit,
    repetitions: input.repetitions,
  };

  const issues = validateProvenance(provenance);
  if (issues.length > 0) {
    throw new EvidenceValidationError('Captured provenance is incomplete', issues);
  }

  return {
    provenance,
    tree: {
      gitCommit,
      porcelain,
      dirtyFiles,
      guardedDirtyFiles,
      cleanTree: guardedDirtyFiles.length === 0,
    },
  };
}

/* ------------------------------------------------------------------------- */
/* Validation (Requirement 17.4, 17.5, 17.6)                                  */
/* ------------------------------------------------------------------------- */

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;

export interface ValidateEvidenceOptions {
  /** Prefix for every issue message, e.g. `perSignal.error.eventsPerSecond`. */
  label?: string;
  /** Require `provenance.environment` to be allowlisted. Defaults to false. */
  requireAllowlistedEnvironment?: boolean;
  /** Environment used to resolve the allowlist; defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** True for the byte-exact Unmeasured_Declaration and nothing else. */
export function isUnmeasuredDeclaration(value: unknown): value is UnmeasuredDeclaration {
  return value === UNMEASURED;
}

export function isMeasured<T>(
  entry: Measured<T>,
): entry is Extract<Measured<T>, { status: 'measured' }> {
  return entry.status === 'measured';
}

export function isUnmeasured<T>(
  entry: Measured<T>,
): entry is Extract<Measured<T>, { status: 'unmeasured' }> {
  return entry.status === 'unmeasured';
}

/**
 * Validate a provenance envelope, returning one issue string per defect.
 * Requirement 17.6: exact command, allowlisted environment, ISO 8601 UTC
 * timestamp, and the repetition count the value summarizes.
 */
export function validateProvenance(
  value: unknown,
  options: ValidateEvidenceOptions = {},
): string[] {
  const at = options.label === undefined ? 'provenance' : `${options.label}.provenance`;
  const issues: string[] = [];

  if (!isRecord(value)) {
    return [`${at}: missing or not an object`];
  }

  if (typeof value.command !== 'string' || value.command.trim() === '') {
    issues.push(`${at}.command: missing or empty; Requirement 17.6 requires the exact command invoked`);
  }

  if (typeof value.environment !== 'string' || value.environment.trim() === '') {
    issues.push(`${at}.environment: missing or empty`);
  } else if (options.requireAllowlistedEnvironment === true) {
    if (!isBenchEnvironmentAllowed(value.environment, options.env ?? process.env)) {
      issues.push(
        `${at}.environment: ${JSON.stringify(value.environment)} is not an allowlisted staging or ` +
          'benchmark environment',
      );
    }
  }

  if (typeof value.timestampUtc !== 'string' || !ISO_UTC.test(value.timestampUtc)) {
    issues.push(`${at}.timestampUtc: not an ISO 8601 UTC timestamp`);
  } else if (!Number.isFinite(Date.parse(value.timestampUtc))) {
    issues.push(`${at}.timestampUtc: not a parseable timestamp`);
  }

  if (typeof value.gitCommit !== 'string' || value.gitCommit.trim() === '') {
    issues.push(`${at}.gitCommit: missing or empty`);
  }

  if (
    typeof value.repetitions !== 'number' ||
    !Number.isInteger(value.repetitions) ||
    value.repetitions < 0
  ) {
    issues.push(`${at}.repetitions: not a non-negative integer`);
  }

  return issues;
}

function numericIssues(at: string, label: string, value: unknown): string[] {
  if (typeof value !== 'number') return [];
  return Number.isFinite(value) ? [] : [`${at}.${label}: ${String(value)} is not a finite number`];
}

/**
 * Validate one evidence entry. Returns an empty array only when the entry is
 * exactly one of the three permitted shapes:
 *
 *   - `measured` with a complete provenance envelope and `runs.length` equal to
 *     `provenance.repetitions`;
 *   - `unmeasured` carrying the byte-exact Unmeasured_Declaration and a
 *     non-empty reason;
 *   - `derived` recording its constituent measurements and its arithmetic
 *     (Requirement 17.5).
 *
 * Any other shape is the third state the Requirement 17.4 gate exists to catch.
 */
export function validateEvidenceEntry(
  entry: unknown,
  options: ValidateEvidenceOptions = {},
): string[] {
  const at = options.label ?? 'entry';

  if (!isRecord(entry)) {
    return [`${at}: missing or not an object`];
  }

  const status = entry.status;

  if (status === 'measured') {
    const issues = validateProvenance(entry.provenance, options);

    if (!Array.isArray(entry.runs)) {
      issues.push(`${at}.runs: missing or not an array`);
    } else if (entry.runs.length === 0) {
      issues.push(`${at}.runs: empty; a measured value must summarize at least one run`);
    } else if (
      isRecord(entry.provenance) &&
      typeof entry.provenance.repetitions === 'number' &&
      entry.runs.length !== entry.provenance.repetitions
    ) {
      issues.push(
        `${at}: runs.length ${entry.runs.length} does not equal provenance.repetitions ` +
          `${entry.provenance.repetitions}`,
      );
    }

    for (const key of ['value', 'median', 'min', 'max'] as const) {
      if (!(key in entry)) {
        issues.push(`${at}.${key}: missing`);
        continue;
      }
      issues.push(...numericIssues(at, key, entry[key]));
    }

    const { min, median, max } = entry;
    if (typeof min === 'number' && typeof median === 'number' && typeof max === 'number') {
      if (!(min <= median && median <= max)) {
        issues.push(`${at}: min <= median <= max violated (${min}, ${median}, ${max})`);
      }
    }

    if ('declaration' in entry) {
      issues.push(`${at}.declaration: present on a measured entry`);
    }

    return issues;
  }

  if (status === 'unmeasured') {
    const issues = validateProvenance(entry.provenance, options);

    if (!('declaration' in entry)) {
      issues.push(`${at}.declaration: missing`);
    } else if (!isUnmeasuredDeclaration(entry.declaration)) {
      issues.push(
        `${at}.declaration: expected the byte-exact ${JSON.stringify(UNMEASURED)}, got ` +
          `${JSON.stringify(entry.declaration)}`,
      );
    }

    if (typeof entry.reason !== 'string' || entry.reason.trim() === '') {
      issues.push(`${at}.reason: missing or empty; an unmeasured metric must record why`);
    }

    if ('value' in entry) {
      issues.push(`${at}.value: present on an unmeasured entry`);
    }

    return issues;
  }

  if (status === 'derived') {
    const issues = validateProvenance(entry.provenance, options);

    issues.push(...numericIssues(at, 'value', entry.value));
    if (!('value' in entry)) issues.push(`${at}.value: missing`);

    if (typeof entry.arithmetic !== 'string' || entry.arithmetic.trim() === '') {
      issues.push(
        `${at}.arithmetic: missing or empty; Requirement 17.5 requires the arithmetic that ` +
          'produced the derived value',
      );
    }

    if (!Array.isArray(entry.constituents) || entry.constituents.length === 0) {
      issues.push(
        `${at}.constituents: missing or empty; Requirement 17.5 requires each constituent ` +
          'recorded measurement',
      );
    } else {
      entry.constituents.forEach((constituent, index) => {
        const childAt = `${at}.constituents[${index}]`;
        if (!isRecord(constituent)) {
          issues.push(`${childAt}: not an object`);
          return;
        }
        if (typeof constituent.label !== 'string' || constituent.label.trim() === '') {
          issues.push(`${childAt}.label: missing or empty`);
        }
        if (typeof constituent.measurement === 'number') {
          issues.push(...numericIssues(childAt, 'measurement', constituent.measurement));
          return;
        }
        issues.push(
          ...validateEvidenceEntry(constituent.measurement, {
            ...options,
            label: `${childAt}.measurement`,
          }),
        );
      });
    }

    return issues;
  }

  return [
    `${at}.status: expected 'measured', 'unmeasured' or 'derived', got ` +
      `${JSON.stringify(status)}; an evidence entry has no fourth state`,
  ];
}

/** Throwing form of {@link validateEvidenceEntry}. */
export function assertEvidenceEntry(
  entry: unknown,
  options: ValidateEvidenceOptions = {},
): void {
  const issues = validateEvidenceEntry(entry, options);
  if (issues.length > 0) {
    throw new EvidenceValidationError('Invalid evidence entry', issues);
  }
}

/* ------------------------------------------------------------------------- */
/* Constructors                                                               */
/* ------------------------------------------------------------------------- */

export interface RecordMeasuredInput<T> {
  runs: readonly T[];
  median: T;
  min: T;
  max: T;
  provenance: Provenance;
  /** The reported value. Defaults to `median`. */
  value?: T;
}

/**
 * Construct a measured entry, refusing to build one whose run count disagrees
 * with its recorded repetition count. Summaries come from the caller — see
 * `scripts/lib/aggregate.ts` — so this constructor stays the single place that
 * enforces the envelope's invariants without owning aggregation.
 */
export function recordMeasured<T>(input: RecordMeasuredInput<T>): Measured<T> {
  const runs = [...input.runs];
  const entry: Measured<T> = {
    status: 'measured',
    value: 'value' in input && input.value !== undefined ? input.value : input.median,
    runs,
    median: input.median,
    min: input.min,
    max: input.max,
    provenance: { ...input.provenance },
  };

  assertEvidenceEntry(entry);
  return entry;
}

/**
 * Construct the recorded absence of a measurement. The declaration is supplied
 * by this module, never by the caller, so it cannot drift from the byte-exact
 * sentence the requirements demand.
 */
export function recordUnmeasured<T>(reason: string, provenance: Provenance): Measured<T> {
  const entry: Measured<T> = {
    status: 'unmeasured',
    declaration: UNMEASURED,
    reason,
    provenance: { ...provenance },
  };

  assertEvidenceEntry(entry);
  return entry;
}

export interface RecordDerivedInput<T> {
  value: T;
  constituents: readonly DerivedConstituent[];
  arithmetic: string;
  provenance: Provenance;
}

/** Construct a derived entry carrying its constituents and arithmetic (Requirement 17.5). */
export function recordDerived<T>(input: RecordDerivedInput<T>): Derived<T> {
  const entry: Derived<T> = {
    status: 'derived',
    value: input.value,
    constituents: input.constituents.map((constituent) => ({ ...constituent })),
    arithmetic: input.arithmetic,
    provenance: { ...input.provenance },
  };

  assertEvidenceEntry(entry);
  return entry;
}
