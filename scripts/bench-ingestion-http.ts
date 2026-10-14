/**
 * HTTP-level ingestion benchmark generator.
 *
 * This is the entrypoint spec §2-§8 describe: it drives the REAL ingestion
 * path (SDK-shaped HTTP request -> auth -> gateway validation -> pg-boss
 * enqueue -> worker dispatch -> DB commit -> ACK), not a direct database or
 * EventProcessor call. For the direct-DB/direct-processor microbenchmark, use
 * `npm run bench:ingestion` (scripts/bench-ingestion-worker.ts), which is
 * explicitly classified as a DATABASE-ONLY MICROBENCHMARK — see
 * docs/ingestionv2/benchmark/01-tooling-classification.md.
 *
 * Modes: baseline, fixed-rate, ramp, burst, sustained, soak (spec §5).
 * Every mode shares the same request engine (http-request-engine.ts), the
 * same sustainability criteria (sustainability.ts), and the same metrics
 * collector (metrics-collector.ts).
 *
 * SAFETY (non-negotiable, spec §3-§4):
 *   - Refuses to run against a disallowed environment label
 *     (INGESTION_BENCH_ENV_ALLOWLIST) or a production-looking target URL
 *     without the explicit override, and NEVER permits ramp/burst/sustained/
 *     soak against a production-looking target even with the override
 *     (http-safety.ts).
 *   - Refuses a log-touching duplicate-heavy profile unless the target's
 *     events_logs unique guard is confirmed present or the operator passes
 *     --allow-unsafe-duplicate-logs (duplicate-safety-gate.ts).
 *
 * Usage:
 *   npx tsx scripts/bench-ingestion-http.ts --mode baseline \
 *     --target-url http://localhost:3000 --api-key <full-key> --environment benchmark
 *   npx tsx scripts/bench-ingestion-http.ts --mode fixed-rate --rate 50 --duration-seconds 30 \
 *     --target-url http://localhost:3000 --api-key <full-key> --environment benchmark
 */
import { mkdir, writeFile } from 'fs/promises';
import { dirname } from 'path';
import { assertBenchEnvironment, assertSafeTarget, currentGitCommit, type BenchmarkMode } from './bench/http-safety.js';
import { startCollector, type WorkerSample, type DbSample } from './bench/metrics-collector.js';
import { getProfile, listProfiles, DuplicateTracker, type WorkloadProfileName } from './bench/workload-profiles.js';
import { runFixedRate, quantiles, type RequestOutcome } from './bench/http-request-engine.js';
import { runRampToSaturation, runBurst, runSustained, runSoak, type MetricsProvider } from './bench/load-modes.js';
import { checkLogIdempotencyGuard, assertDuplicateProfileSafe } from './bench/duplicate-safety-gate.js';
import { DEFAULT_SLO, type SloConfig } from './bench/sustainability.js';

interface CliOptions {
  mode: BenchmarkMode;
  targetUrl: string;
  apiKey: string;
  environment: string;
  profile: WorkloadProfileName;
  ratePerSecond: number;
  batchSize: number;
  durationSeconds: number;
  maxConcurrency: number;
  requestTimeoutMs: number;
  outPath: string | null;
  overrideProductionLooking: boolean;
  allowUnsafeDuplicateLogs: boolean;
  logDbUrl: string | undefined;
  dbUrl: string | undefined;
  workerMetricsUrl: string | undefined;
  rateSteps: number[];
  stepDurationSeconds: number;
  burstRatePerSecond: number;
  burstDurationSeconds: number;
  quietRatePerSecond: number;
  quietDurationSeconds: number;
  burstCycles: number;
  soakCheckIntervalSeconds: number;
  slo: SloConfig;
}

function usage(): void {
  console.error(`Usage:
  npx tsx scripts/bench-ingestion-http.ts --mode <mode> --target-url <url> --api-key <key> --environment <label> [options]

Modes:
  baseline     Very low, fixed traffic. Per-batch/per-event overhead only.
  fixed-rate   Constant offered rate for --duration-seconds.
  ramp         Step offered rate upward through --rate-steps until unsustainable, then recover.
  burst        Alternating burst/quiet cycles.
  sustained    One fixed rate for a long window with periodic sustainability checks.
  soak         Same as sustained but intended for very long runs; adds a degradation trend.

  ramp/burst/sustained/soak are NEVER permitted against a production-looking target URL,
  with or without any override flag.

Required:
  --target-url <url>       Base URL of the ingestion gateway (e.g. http://localhost:3000).
  --api-key <key>          Full API key (see scripts/bench/provision-benchmark-fixture.ts).
  --environment <label>    Must be in INGESTION_BENCH_ENV_ALLOWLIST.

Common options:
  --profile <name>         One of: ${listProfiles().map((p) => p.name).join(', ')} (default: mixed).
  --rate <n>                Offered events/sec for baseline/fixed-rate (default: 5).
  --batch-size <n>          Events per HTTP request (default: 10; gateway caps at 1000).
  --duration-seconds <n>    Fixed-rate/sustained/soak run length (default: 30).
  --max-concurrency <n>     Max in-flight HTTP requests from the generator (default: 20).
  --request-timeout-ms <n>  Per-request timeout (default: 10000).
  --out <path>              Write JSON report to this path as well as stdout.

Ramp-only options:
  --rate-steps 5,10,25,50,100   Ascending offered rates to try (default: 5,10,25,50,100,200).
  --step-duration-seconds <n>   Duration of each ramp step (default: 20).

Burst-only options:
  --burst-rate <n> --burst-duration-seconds <n>
  --quiet-rate <n> --quiet-duration-seconds <n>
  --burst-cycles <n>

Safety overrides (use with extreme caution, read the error message first):
  --i-understand-this-may-affect-production   Required to run baseline/fixed-rate against a
                                               production-looking target URL. Never unlocks
                                               ramp/burst/sustained/soak.
  --allow-unsafe-duplicate-logs                Proceed with a log-touching duplicate-heavy
                                               profile even if the events_logs unique guard is
                                               not confirmed present on the target.

Observability inputs (all optional; absence is recorded, not guessed):
  --worker-metrics-url <url>   e.g. http://localhost:9465/metrics
  --db-url <url>               Read-only monitoring connection to the Primary DB.
  --log-db-url <url>           Read-only monitoring connection to the Log DB (used for the
                                duplicate-heavy safety gate and DB samples if --db-url is absent).
`);
  process.exit(2);
}

function parseArgs(): CliOptions {
  const args: Record<string, string | boolean> = {};
  for (let i = 2; i < process.argv.length; i += 1) {
    const arg = process.argv[i];
    if (!arg?.startsWith('--')) continue;
    const key = arg.slice(2);
    const value = process.argv[i + 1];
    if (!value || value.startsWith('--')) args[key] = true;
    else {
      args[key] = value;
      i += 1;
    }
  }
  if (args.help === true || args.h === true) usage();

  const mode = String(args.mode ?? '');
  if (!['baseline', 'fixed-rate', 'ramp', 'burst', 'sustained', 'soak'].includes(mode)) usage();
  const targetUrl = typeof args['target-url'] === 'string' ? args['target-url'] : '';
  const apiKey = typeof args['api-key'] === 'string' ? args['api-key'] : '';
  const environment = typeof args.environment === 'string' ? args.environment : '';
  if (!targetUrl || !apiKey || !environment) usage();

  const profileName = String(args.profile ?? 'mixed') as WorkloadProfileName;
  getProfile(profileName); // throws on unknown name

  return {
    mode: mode as BenchmarkMode,
    targetUrl,
    apiKey,
    environment,
    profile: profileName,
    ratePerSecond: positiveInt(args.rate, 5),
    batchSize: positiveInt(args['batch-size'], 10),
    durationSeconds: positiveInt(args['duration-seconds'], 30),
    maxConcurrency: positiveInt(args['max-concurrency'], 20),
    requestTimeoutMs: positiveInt(args['request-timeout-ms'], 10_000),
    outPath: typeof args.out === 'string' ? args.out : null,
    overrideProductionLooking: args['i-understand-this-may-affect-production'] === true,
    allowUnsafeDuplicateLogs: args['allow-unsafe-duplicate-logs'] === true,
    logDbUrl: typeof args['log-db-url'] === 'string' ? args['log-db-url'] : undefined,
    dbUrl: typeof args['db-url'] === 'string' ? args['db-url'] : undefined,
    workerMetricsUrl: typeof args['worker-metrics-url'] === 'string' ? args['worker-metrics-url'] : undefined,
    rateSteps: parseNumberList(args['rate-steps'], [5, 10, 25, 50, 100, 200]),
    stepDurationSeconds: positiveInt(args['step-duration-seconds'], 20),
    burstRatePerSecond: positiveInt(args['burst-rate'], 100),
    burstDurationSeconds: positiveInt(args['burst-duration-seconds'], 5),
    quietRatePerSecond: positiveInt(args['quiet-rate'], 2),
    quietDurationSeconds: positiveInt(args['quiet-duration-seconds'], 15),
    burstCycles: positiveInt(args['burst-cycles'], 3),
    soakCheckIntervalSeconds: positiveInt(args['soak-check-interval-seconds'], 60),
    slo: DEFAULT_SLO,
  };
}

function positiveInt(value: unknown, fallback: number): number {
  const parsed = Number(value ?? fallback);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseNumberList(value: unknown, fallback: number[]): number[] {
  if (typeof value !== 'string' || value.trim() === '') return fallback;
  const parsed = value.split(',').map((v) => Number(v.trim())).filter((n) => Number.isInteger(n) && n > 0);
  return parsed.length > 0 ? parsed : fallback;
}

function makeMetricsProvider(collector: { snapshot(): { workerSamples: WorkerSample[]; dbSamples: DbSample[] } }): MetricsProvider {
  let workerCursor = 0;
  let dbCursor = 0;
  return {
    samplesSinceLastCheck() {
      const snapshot = collector.snapshot();
      const worker = snapshot.workerSamples.slice(workerCursor);
      const db = snapshot.dbSamples.slice(dbCursor);
      workerCursor = snapshot.workerSamples.length;
      dbCursor = snapshot.dbSamples.length;
      return { worker, db };
    },
  };
}

async function main(): Promise<void> {
  const opts = parseArgs();

  // Gate 1: environment allowlist (reused primitive).
  assertBenchEnvironment(opts.environment);

  // Gate 2: target-URL shape, mode-aware.
  assertSafeTarget({
    targetUrl: opts.targetUrl,
    environment: opts.environment,
    mode: opts.mode,
    overrideFlag: opts.overrideProductionLooking,
  });

  const profile = getProfile(opts.profile);

  // Gate 3: duplicate-heavy / log idempotency safety check.
  const guardStatus = await checkLogIdempotencyGuard(opts.logDbUrl ?? opts.dbUrl);
  assertDuplicateProfileSafe({
    profileTypeWeights: profile.typeWeights,
    duplicateRatio: profile.duplicateRatio,
    guardStatus,
    allowUnsafeOverride: opts.allowUnsafeDuplicateLogs,
  });

  const collector = startCollector({
    workerMetricsUrl: opts.workerMetricsUrl,
    dbUrl: opts.dbUrl ?? opts.logDbUrl,
    intervalMs: 5_000,
  });

  const duplicateTracker = new DuplicateTracker();
  const target = { baseUrl: opts.targetUrl, apiKey: opts.apiKey, requestTimeoutMs: opts.requestTimeoutMs };
  const startedAt = new Date().toISOString();
  const gitCommit = currentGitCommit();

  let modeResult: unknown;
  let workerAccum: WorkerSample[] = [];
  let dbAccum: DbSample[] = [];

  try {
    if (opts.mode === 'baseline' || opts.mode === 'fixed-rate') {
      const outcomes: RequestOutcome[] = [];
      const result = await runFixedRate({
        target,
        profile,
        ratePerSecond: opts.mode === 'baseline' ? Math.min(1, opts.ratePerSecond) : opts.ratePerSecond,
        batchSize: opts.batchSize,
        durationMs: opts.durationSeconds * 1000,
        maxConcurrency: opts.maxConcurrency,
        duplicateTracker,
        onOutcome: (o) => outcomes.push(o),
      });
      const latencyQuantiles = quantiles(outcomes.filter((o) => o.error === null).map((o) => o.latencyMs));
      modeResult = { result, latencyQuantiles };
    } else {
      const metrics = makeMetricsProvider(collector);
      const commonOpts = { target, profile, batchSize: opts.batchSize, maxConcurrency: opts.maxConcurrency, duplicateTracker };

      if (opts.mode === 'ramp') {
        modeResult = await runRampToSaturation({
          ...commonOpts,
          rateSteps: opts.rateSteps,
          stepDurationMs: opts.stepDurationSeconds * 1000,
          slo: opts.slo,
          metrics,
        });
      } else if (opts.mode === 'burst') {
        modeResult = await runBurst({
          ...commonOpts,
          burstRatePerSecond: opts.burstRatePerSecond,
          burstDurationMs: opts.burstDurationSeconds * 1000,
          quietRatePerSecond: opts.quietRatePerSecond,
          quietDurationMs: opts.quietDurationSeconds * 1000,
          cycles: opts.burstCycles,
          slo: opts.slo,
          metrics,
        });
      } else if (opts.mode === 'sustained') {
        modeResult = await runSustained({
          ...commonOpts,
          ratePerSecond: opts.ratePerSecond,
          durationMs: opts.durationSeconds * 1000,
          slo: opts.slo,
          metrics,
          checkIntervalMs: 30_000,
        });
      } else {
        modeResult = await runSoak({
          ...commonOpts,
          ratePerSecond: opts.ratePerSecond,
          durationMs: opts.durationSeconds * 1000,
          slo: opts.slo,
          metrics,
          checkIntervalMs: opts.soakCheckIntervalSeconds * 1000,
        });
      }
    }
  } finally {
    const stopped = await collector.stop();
    workerAccum = stopped.workerSamples;
    dbAccum = stopped.dbSamples;
  }

  const report = {
    tool: 'bench-ingestion-http',
    classification: 'HTTP-LEVEL INGESTION CAPACITY BENCHMARK (real gateway -> auth -> pg-boss -> worker path)',
    startedAt,
    finishedAt: new Date().toISOString(),
    gitCommit,
    config: {
      mode: opts.mode,
      targetUrl: redact(opts.targetUrl),
      environment: opts.environment,
      profile: opts.profile,
      profileDescription: profile.description,
      ratePerSecond: opts.ratePerSecond,
      batchSize: opts.batchSize,
      durationSeconds: opts.durationSeconds,
      maxConcurrency: opts.maxConcurrency,
    },
    logIdempotencyGuardStatus: guardStatus,
    modeResult,
    workerSamplesCollected: workerAccum.length,
    dbSamplesCollected: dbAccum.length,
    workerMetricsReachable: workerAccum.length > 0,
    dbMetricsReachable: dbAccum.length > 0,
    workerSamples: workerAccum,
    dbSamples: dbAccum,
  };

  const json = JSON.stringify(report, null, 2);
  process.stdout.write(`${json}\n`);
  if (opts.outPath) {
    await mkdir(dirname(opts.outPath), { recursive: true });
    await writeFile(opts.outPath, json, 'utf8');
  }
}

function redact(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.hostname}${parsed.port ? `:${parsed.port}` : ''}`;
  } catch {
    return '<unparseable-url>';
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit((err as { exitCode?: number })?.exitCode ?? 1);
});
