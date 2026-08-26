/**
 * Run a repeatable ingestion benchmark matrix by invoking
 * scripts/bench-ingestion-worker.ts for each type / batch-size / tenant /
 * worker-concurrency / traffic-profile combo.
 *
 * The child benchmark output is preserved as-is under each matrix result so
 * compare gates and reports can continue to use the canonical single-run JSON.
 */
import { spawn } from 'child_process';
import { writeFile } from 'fs/promises';
import { performance } from 'perf_hooks';

type BenchMode = 'writer' | 'processor';
type MatrixPreset = 'smoke' | 'acceptance' | 'custom';
type TrafficProfile = 'low' | 'normal' | 'burst';

interface MatrixConfig {
  preset: MatrixPreset;
  mode: BenchMode;
  types: string[];
  batchSizes: number[];
  tenants: number[];
  workerConcurrency: number[];
  trafficProfiles: TrafficProfile[];
  batches: number;
  warmupBatches: number;
  commit: boolean;
  dryRun: boolean;
  continueOnError: boolean;
  outPath: string | null;
}

interface MatrixCase {
  type: string;
  batchSize: number;
  tenants: number;
  workerConcurrency: number;
  trafficProfile: TrafficProfile;
}

interface MatrixResult {
  case: MatrixCase;
  command: string[];
  env: Record<string, string>;
  exitCode: number | null;
  durationMs: number;
  report?: unknown;
  stderr?: string;
  error?: string;
}

const acceptanceTypes = [
  'error',
  'request',
  'message',
  'span',
  'trace',
  'metric',
  'log',
  'profile',
  'cron_checkin',
  'replay',
  'mixed',
];

function usage(): void {
  console.error(`Usage:
  npm run bench:ingestion:matrix -- [options]

Presets:
  --preset smoke       request/error/mixed x 10/100 x 1/10 tenants (default)
  --preset acceptance  all event types x 10/100/500/1000/5000/10000 x 1/10/100 tenants x 1/2/4/8/16/32 worker concurrency x low/normal/burst traffic
  --preset custom      use --types, --batch-sizes, --tenants, --worker-concurrency, and --traffic-profiles

Options:
  --mode writer|processor       default writer
  --types request,span,mixed    comma-separated
  --batch-sizes 10,100,500      comma-separated
  --tenants 1,10,100            comma-separated
  --worker-concurrency 1,2,4,8   comma-separated INGESTION_TYPE_WORKER_CONCURRENCY values
  --traffic-profiles low,burst   comma-separated low|normal|burst
  --batches N                   default 25
  --warmup-batches N            default 3
  --commit                      pass --commit to child runs
  --dry-run                     print planned cases without running benchmarks
  --continue-on-error           keep running after a failed case
  --out path.json               write aggregate JSON to a file as well as stdout
`);
  process.exit(2);
}

function parseArgs(): MatrixConfig {
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

  const preset = parsePreset(args.preset);
  const mode = parseMode(args.mode);
  const presetDefaults = defaultsForPreset(preset);

  return {
    preset,
    mode,
    types: parseStringList(args.types, presetDefaults.types),
    batchSizes: parseNumberList(args['batch-sizes'] ?? args.batchSizes, presetDefaults.batchSizes),
    tenants: parseNumberList(args.tenants, presetDefaults.tenants),
    workerConcurrency: parseNumberList(
      args['worker-concurrency'] ?? args.workerConcurrency ?? args['worker-concurrencies'],
      presetDefaults.workerConcurrency,
    ),
    trafficProfiles: parseTrafficProfiles(
      args['traffic-profiles'] ?? args.trafficProfiles ?? args['traffic-profile'] ?? args.trafficProfile,
      presetDefaults.trafficProfiles,
    ),
    batches: positiveInt(args.batches, 25),
    warmupBatches: positiveInt(args['warmup-batches'] ?? args.warmupBatches, 3),
    commit: args.commit === true || args.commit === 'true',
    dryRun: args['dry-run'] === true || args.dryRun === true,
    continueOnError: args['continue-on-error'] === true || args.continueOnError === true,
    outPath: typeof args.out === 'string' ? args.out : null,
  };
}

function parsePreset(raw: unknown): MatrixPreset {
  if (raw === undefined) return 'smoke';
  if (raw === 'smoke' || raw === 'acceptance' || raw === 'custom') return raw;
  usage();
  return 'smoke';
}

function parseMode(raw: unknown): BenchMode {
  if (raw === undefined) return 'writer';
  if (raw === 'writer' || raw === 'processor') return raw;
  usage();
  return 'writer';
}

function defaultsForPreset(preset: MatrixPreset): Pick<MatrixConfig, 'types' | 'batchSizes' | 'tenants' | 'workerConcurrency' | 'trafficProfiles'> {
  if (preset === 'acceptance') {
    return {
      types: acceptanceTypes,
      batchSizes: [10, 100, 500, 1000, 5000, 10000],
      tenants: [1, 10, 100],
      workerConcurrency: [1, 2, 4, 8, 16, 32],
      trafficProfiles: ['low', 'normal', 'burst'],
    };
  }
  if (preset === 'custom') {
    return {
      types: ['request'],
      batchSizes: [200],
      tenants: [1],
      workerConcurrency: [8],
      trafficProfiles: ['burst'],
    };
  }
  return {
    types: ['request', 'error', 'mixed'],
    batchSizes: [10, 100],
    tenants: [1, 10],
    workerConcurrency: [8],
    trafficProfiles: ['burst'],
  };
}

function parseStringList(raw: unknown, fallback: string[]): string[] {
  if (typeof raw !== 'string' || raw.trim().length === 0) return fallback;
  const values = raw.split(',').map((value) => value.trim()).filter(Boolean);
  return values.length > 0 ? values : fallback;
}

function parseNumberList(raw: unknown, fallback: number[]): number[] {
  if (typeof raw !== 'string' || raw.trim().length === 0) return fallback;
  const values = raw
    .split(',')
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isInteger(value) && value > 0);
  return values.length > 0 ? values : fallback;
}

function parseTrafficProfiles(raw: unknown, fallback: TrafficProfile[]): TrafficProfile[] {
  if (typeof raw !== 'string' || raw.trim().length === 0) return fallback;
  const values = raw
    .split(',')
    .map((value) => value.trim())
    .filter((value): value is TrafficProfile => value === 'low' || value === 'normal' || value === 'burst');
  return values.length > 0 ? values : fallback;
}

function positiveInt(value: unknown, fallback: number): number {
  const parsed = Number(value ?? fallback);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function casesFor(config: MatrixConfig): MatrixCase[] {
  const cases: MatrixCase[] = [];
  for (const type of config.types) {
    for (const batchSize of config.batchSizes) {
      for (const tenants of config.tenants) {
        for (const workerConcurrency of config.workerConcurrency) {
          for (const trafficProfile of config.trafficProfiles) {
            cases.push({ type, batchSize, tenants, workerConcurrency, trafficProfile });
          }
        }
      }
    }
  }
  return cases;
}

function childArgs(config: MatrixConfig, benchCase: MatrixCase): string[] {
  const args = [
    '--import',
    'tsx',
    'scripts/bench-ingestion-worker.ts',
    '--mode',
    config.mode,
    '--type',
    benchCase.type,
    '--batch-size',
    String(benchCase.batchSize),
    '--tenants',
    String(benchCase.tenants),
    '--batches',
    String(config.batches),
    '--warmup-batches',
    String(config.warmupBatches),
    '--traffic-profile',
    benchCase.trafficProfile,
  ];
  if (config.commit) args.push('--commit');
  return args;
}

function childEnv(benchCase: MatrixCase): Record<string, string> {
  return {
    INGESTION_TYPE_WORKER_CONCURRENCY: String(benchCase.workerConcurrency),
  };
}

function extractJson(stdout: string): unknown {
  const trimmed = stdout.trim();
  const firstBrace = trimmed.indexOf('{');
  if (firstBrace < 0) throw new Error('benchmark stdout did not contain JSON');
  return JSON.parse(trimmed.slice(firstBrace));
}

async function runCase(config: MatrixConfig, benchCase: MatrixCase): Promise<MatrixResult> {
  const args = childArgs(config, benchCase);
  const envOverrides = childEnv(benchCase);
  const processEnv = {
    ...process.env,
    ...envOverrides,
  };
  const startedAt = performance.now();
  const result = await new Promise<MatrixResult>((resolve) => {
    const child = spawn(process.execPath, args, {
      cwd: process.cwd(),
      env: processEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (err) => {
      resolve({
        case: benchCase,
        command: [process.execPath, ...args],
        env: envOverrides,
        exitCode: null,
        durationMs: Math.round(performance.now() - startedAt),
        stderr: stderr.trim() || undefined,
        error: err.message,
      });
    });
    child.on('close', (code) => {
      let report: unknown;
      let error: string | undefined;
      if (code === 0) {
        try {
          report = extractJson(stdout);
        } catch (err) {
          error = err instanceof Error ? err.message : String(err);
        }
      }
      resolve({
        case: benchCase,
        command: [process.execPath, ...args],
        env: envOverrides,
        exitCode: code,
        durationMs: Math.round(performance.now() - startedAt),
        ...(report !== undefined ? { report } : {}),
        ...(stderr.trim().length > 0 ? { stderr: stderr.trim() } : {}),
        ...(error ? { error } : {}),
      });
    });
  });
  return result;
}

async function main(): Promise<void> {
  const config = parseArgs();
  const startedAt = new Date();
  const results: MatrixResult[] = [];
  const matrixCases = casesFor(config);
  if (config.dryRun) {
    const output = {
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      passed: true,
      dryRun: true,
      config,
      plannedCases: matrixCases.length,
      completedCases: 0,
      cases: matrixCases.map((benchCase) => ({
        ...benchCase,
        command: [process.execPath, ...childArgs(config, benchCase)],
        env: childEnv(benchCase),
      })),
      results,
    };
    const json = JSON.stringify(output, null, 2);
    if (config.outPath) await writeFile(config.outPath, `${json}\n`, 'utf8');
    console.log(json);
    return;
  }

  for (const [index, benchCase] of matrixCases.entries()) {
    console.error(`[${index + 1}/${matrixCases.length}] ${benchCase.type} batch=${benchCase.batchSize} tenants=${benchCase.tenants} workerConcurrency=${benchCase.workerConcurrency} traffic=${benchCase.trafficProfile}`);
    const result = await runCase(config, benchCase);
    results.push(result);
    if ((result.exitCode !== 0 || result.error) && !config.continueOnError) break;
  }

  const passed = results.length === matrixCases.length
    && results.every((result) => result.exitCode === 0 && !result.error);
  const output = {
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    passed,
    config,
    plannedCases: matrixCases.length,
    completedCases: results.length,
    results,
  };
  const json = JSON.stringify(output, null, 2);
  if (config.outPath) await writeFile(config.outPath, `${json}\n`, 'utf8');
  console.log(json);
  if (!passed) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
