/**
 * Safety gating for the HTTP-level ingestion benchmark generator.
 *
 * Two independent gates must both pass before any request is sent:
 *
 *   1. Environment label gate (reused, not reimplemented): the same
 *      allowlist/assertion `scripts/lib/ingestion-evidence.ts` already uses
 *      for the direct-DB microbenchmark. `--environment` must resolve to a
 *      label in `INGESTION_BENCH_ENV_ALLOWLIST` (default
 *      staging,bench,benchmark,local).
 *
 *   2. Target-URL gate (new, HTTP-specific): because this generator talks to
 *      a URL rather than a database connection string, a benchmark operator
 *      could point `--target-url` at a production hostname while still
 *      passing `--environment benchmark`. `assertSafeTargetUrl()` closes that
 *      gap by refusing hostnames that look like production unless the
 *      explicit override `--i-understand-this-may-affect-production` is
 *      passed AND `--environment` is not itself a destructive mode (ramp,
 *      burst, sustained, soak).
 *
 * Default behavior is closed: an unset or ambiguous target is rejected, not
 * assumed safe.
 */
import { spawnSync } from 'child_process';

export {
  assertBenchEnvironment,
  isBenchEnvironmentAllowed,
  resolveBenchEnvironmentAllowlist,
  BenchEnvironmentError,
  EvidenceError,
  DEFAULT_BENCH_ENV_ALLOWLIST,
  BENCH_ENV_ALLOWLIST_VAR,
} from '../lib/ingestion-evidence.js';

import { BenchEnvironmentError } from '../lib/ingestion-evidence.js';

/** Modes that generate sustained/escalating load and must never touch production. */
export const DESTRUCTIVE_MODES = ['ramp', 'burst', 'sustained', 'soak'] as const;
export type DestructiveMode = (typeof DESTRUCTIVE_MODES)[number];
export type BenchmarkMode = 'baseline' | 'fixed-rate' | DestructiveMode;

/**
 * Hostname/URL substrings that, if present, mark a target as looking like
 * production. This is a deliberately broad heuristic: a false positive here
 * only costs the operator one explicit override flag; a false negative could
 * put load on production.
 */
const PRODUCTION_LOOKING_PATTERNS: readonly RegExp[] = [
  /\bprod\b/i,
  /\bproduction\b/i,
  /\blive\b/i,
  /^api\.pulse\./i,
  /^app\.pulse\./i,
  /pulse\.io$/i,
  /pulse\.dev$/i,
  /\.internal$/i,
];

export interface TargetSafetyOptions {
  targetUrl: string;
  environment: string;
  mode: BenchmarkMode;
  /** Explicit, deliberately verbose override flag name for logging/error text. */
  overrideFlag: boolean;
}

export class UnsafeTargetError extends BenchEnvironmentError {}

function looksLikeProduction(targetUrl: string): boolean {
  let hostname: string;
  try {
    hostname = new URL(targetUrl).hostname;
  } catch {
    // An unparseable URL is not "safe" either; treat as production-looking so
    // it is rejected rather than silently passed through.
    return true;
  }
  return PRODUCTION_LOOKING_PATTERNS.some((pattern) => pattern.test(hostname));
}

function isLoopbackOrPrivate(targetUrl: string): boolean {
  let hostname: string;
  try {
    hostname = new URL(targetUrl).hostname;
  } catch {
    return false;
  }
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    /^10\./.test(hostname) ||
    /^192\.168\./.test(hostname) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(hostname)
  );
}

/**
 * Refuse to proceed unless the target URL + environment + mode combination is
 * safe. Throws {@link UnsafeTargetError} (exit code 2) rather than degrading.
 *
 * Rules:
 *   - `--environment` must always pass `assertBenchEnvironment()` first (the
 *     caller is responsible for calling that before this function; this
 *     function does not re-implement it, it only adds the URL-shape check).
 *   - A destructive mode (ramp/burst/sustained/soak) against a
 *     production-looking hostname is refused unconditionally — the override
 *     flag does not unlock destructive modes against apparent production,
 *     because spec §4/§13 forbid it outright, not conditionally.
 *   - A non-destructive mode (baseline/fixed-rate) against a
 *     production-looking hostname is refused UNLESS the explicit override is
 *     set. This exists only for the case this session's operator confirmed:
 *     rollback-only, low-volume smoke runs against the current live target
 *     because no isolated Neon branch exists yet. The caller (the CLI) is
 *     responsible for also enforcing `--commit` is absent in that case.
 */
export function assertSafeTarget(opts: TargetSafetyOptions): void {
  const productionLooking = looksLikeProduction(opts.targetUrl);
  const isDestructive = (DESTRUCTIVE_MODES as readonly string[]).includes(opts.mode);

  if (!productionLooking) return; // loopback/private/staging-labelled hosts pass through

  if (isDestructive) {
    throw new UnsafeTargetError(
      `Refusing to run mode=${opts.mode} against a production-looking target URL (${redactUrl(opts.targetUrl)}). ` +
        'Ramp/burst/sustained/soak modes are never permitted against production or a ' +
        'production-looking hostname, regardless of any override flag. Provision an isolated ' +
        'benchmark environment (e.g. a Neon branch) and pass its URL instead.',
    );
  }

  if (!opts.overrideFlag) {
    throw new UnsafeTargetError(
      `Refusing to run against a production-looking target URL (${redactUrl(opts.targetUrl)}) without the explicit ` +
        'override flag --i-understand-this-may-affect-production. Even with the override, only ' +
        'baseline/fixed-rate modes are permitted, and destructive writes must stay disabled ' +
        '(no --commit on the direct-DB path; use rollback-only HTTP requests scoped to a tagged ' +
        'benchmark org/project).',
    );
  }
}

function redactUrl(targetUrl: string): string {
  try {
    const url = new URL(targetUrl);
    return `${url.protocol}//${url.hostname}${url.port ? `:${url.port}` : ''}`;
  } catch {
    return '<unparseable-url>';
  }
}

/** True when the target is loopback/private, i.e. definitely not production. */
export { isLoopbackOrPrivate };

/**
 * Capture the current git commit for provenance. Thin re-export point so
 * generator code has one place to get this rather than shelling out
 * ad hoc; mirrors `captureProvenance()`'s internal git call.
 */
export function currentGitCommit(cwd: string = process.cwd()): string {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) return 'unknown';
  return (result.stdout ?? '').trim() || 'unknown';
}
