/**
 * Compare two JSON outputs from scripts/run-ingestion-benchmark-matrix.ts.
 *
 * Matrix comparison applies the same throughput/latency/stage regression
 * checks as the single-run comparator to every matching matrix case.
 */
import { readFile } from 'fs/promises';

interface LatencySummary {
  p50?: number;
  p95?: number;
  p99?: number;
  p999?: number;
  max?: number;
}

interface BenchmarkReport {
  mode?: string;
  type?: string;
  tenants?: number;
  batchSize?: number;
  committed?: boolean;
  totalEvents?: number;
  throughputEventsPerSec?: number;
  wallThroughputEventsPerSec?: number;
  totalLatencyMs?: LatencySummary;
  stages?: Record<string, LatencySummary>;
  eventTypes?: Record<string, number>;
  resources?: Record<string, unknown>;
  dbPools?: Record<string, unknown>;
  workerMetrics?: string;
}

interface MatrixCase {
  type: string;
  batchSize: number;
  tenants: number;
  workerConcurrency?: number;
  trafficProfile?: string;
}

interface MatrixResult {
  case?: MatrixCase;
  exitCode?: number | null;
  report?: BenchmarkReport;
  error?: string;
}

interface MatrixReport {
  passed?: boolean;
  dryRun?: boolean;
  plannedCases?: number;
  completedCases?: number;
  results?: MatrixResult[];
}

interface CompareConfig {
  baselinePath: string;
  candidatePath: string;
  maxP95RegressionPct: number;
  maxP99RegressionPct: number;
  maxP999RegressionPct: number;
  maxStageP99RegressionPct: number;
  maxStageP999RegressionPct: number;
  maxThroughputDropPct: number;
  allowMissingCases: boolean;
}

interface CheckResult {
  caseKey: string;
  metric: string;
  baseline: number;
  candidate: number;
  deltaPct: number;
  limitPct: number;
  passed: boolean;
}

interface CaseComparison {
  caseKey: string;
  baseline: MatrixCase;
  candidate: MatrixCase;
  checks: CheckResult[];
  missingMetrics: string[];
  passed: boolean;
}

function usage(): void {
  console.error(`Usage:
  npm run bench:ingestion:matrix:compare -- --baseline baseline-matrix.json --candidate candidate-matrix.json

Options:
  --max-p95-regression-pct N       default 5
  --max-p99-regression-pct N       default 5
  --max-p999-regression-pct N      default 5
  --max-stage-p99-regression-pct N default 10
  --max-stage-p999-regression-pct N default 10
  --max-throughput-drop-pct N      default 5
  --allow-missing-cases            compare shared cases only
`);
  process.exit(2);
}

function parseNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseArgs(): CompareConfig {
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

  const baselinePath = args.baseline;
  const candidatePath = args.candidate;
  if (typeof baselinePath !== 'string' || typeof candidatePath !== 'string') {
    usage();
    process.exit(2);
  }

  return {
    baselinePath,
    candidatePath,
    maxP95RegressionPct: parseNumber(args['max-p95-regression-pct'], 5),
    maxP99RegressionPct: parseNumber(args['max-p99-regression-pct'], 5),
    maxP999RegressionPct: parseNumber(args['max-p999-regression-pct'], 5),
    maxStageP99RegressionPct: parseNumber(args['max-stage-p99-regression-pct'], 10),
    maxStageP999RegressionPct: parseNumber(args['max-stage-p999-regression-pct'], 10),
    maxThroughputDropPct: parseNumber(args['max-throughput-drop-pct'], 5),
    allowMissingCases: args['allow-missing-cases'] === true || args.allowMissingCases === true,
  };
}

async function readMatrix(path: string): Promise<MatrixReport> {
  const parsed = JSON.parse(await readFile(path, 'utf8')) as MatrixReport;
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.results)) {
    throw new Error(`${path} does not contain a benchmark matrix report`);
  }
  if (parsed.dryRun) throw new Error(`${path} is a dry-run plan, not benchmark evidence`);
  return parsed;
}

function caseKey(benchCase: MatrixCase): string {
  const concurrency = benchCase.workerConcurrency ?? 'default';
  const trafficProfile = benchCase.trafficProfile ?? 'default';
  return `${benchCase.type}|batch=${benchCase.batchSize}|tenants=${benchCase.tenants}|workerConcurrency=${concurrency}|traffic=${trafficProfile}`;
}

function resultMap(matrix: MatrixReport): Map<string, MatrixResult> {
  const map = new Map<string, MatrixResult>();
  for (const result of matrix.results ?? []) {
    if (!result.case) continue;
    map.set(caseKey(result.case), result);
  }
  return map;
}

function finiteMetric(report: BenchmarkReport, path: string): number | null {
  const value = path.split('.').reduce<unknown>((cur, key) => {
    if (!cur || typeof cur !== 'object') return undefined;
    return (cur as Record<string, unknown>)[key];
  }, report);
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function hasLatencyPercentiles(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const summary = value as Record<string, unknown>;
  return ['p50', 'p95', 'p99', 'p999'].every((key) => finiteMetric(summary as BenchmarkReport, key) !== null);
}

function hasAnyStagePercentiles(report: BenchmarkReport, names: string[]): boolean {
  const stages = report.stages ?? {};
  return names.some((name) => hasLatencyPercentiles(stages[name]));
}

function missingPerTypeStages(report: BenchmarkReport, prefix: string): string[] {
  const eventTypes = report.eventTypes ?? {};
  return Object.entries(eventTypes)
    .filter(([type, count]) => type !== 'mixed' && typeof count === 'number' && count > 0)
    .filter(([type]) => !hasLatencyPercentiles(report.stages?.[`perType.${type}.durationMs`]))
    .map(([type]) => `${prefix}.stages.perType.${type}.durationMs.p50/p95/p99/p999`);
}

function hasDbPoolSnapshot(report: BenchmarkReport): boolean {
  return Object.values(report.dbPools ?? {}).some((pool) => {
    if (!pool || typeof pool !== 'object' || Array.isArray(pool)) return false;
    const snapshot = pool as Record<string, unknown>;
    return ['total', 'idle', 'waiting'].every((key) => typeof snapshot[key] === 'number' && Number.isFinite(snapshot[key]));
  });
}

function missingReportMetrics(report: BenchmarkReport, prefix: string): string[] {
  const missing: string[] = [];
  if (report.mode !== 'processor') missing.push(`${prefix}.mode=processor`);
  if (report.committed !== true) missing.push(`${prefix}.committed=true`);
  if (finiteMetric(report, 'totalEvents') === null || Number(report.totalEvents) <= 0) missing.push(`${prefix}.totalEvents`);
  if (finiteMetric(report, 'throughputEventsPerSec') === null || Number(report.throughputEventsPerSec) <= 0) missing.push(`${prefix}.throughputEventsPerSec`);
  if (finiteMetric(report, 'wallThroughputEventsPerSec') === null || Number(report.wallThroughputEventsPerSec) <= 0) missing.push(`${prefix}.wallThroughputEventsPerSec`);
  if (!hasLatencyPercentiles(report.totalLatencyMs)) missing.push(`${prefix}.totalLatencyMs.p50/p95/p99/p999`);
  if (!hasAnyStagePercentiles(report, ['queue_wait', 'queueWaitMs', 'worker_wait', 'workerWaitMs', 'worker_ready_wait', 'workerReadyWaitMs'])) {
    missing.push(`${prefix}.queueLatency.p50/p95/p99/p999`);
  }
  if (!hasAnyStagePercentiles(report, ['dbConnectionWaitMs', 'db_connection_wait', 'insertMs', 'insert', 'commitMs', 'commit', 'outboxMs', 'outbox', 'dbQueryMs', 'db_query'])) {
    missing.push(`${prefix}.dbLatency.p50/p95/p99/p999`);
  }
  missing.push(...missingPerTypeStages(report, prefix));
  if (finiteMetric(report, 'resources.cpuTotalMs') === null
    || finiteMetric(report, 'resources.cpuUtilizationPct') === null
    || finiteMetric(report, 'resources.rssPeakBytes') === null
    || finiteMetric(report, 'resources.heapUsedPeakBytes') === null) {
    missing.push(`${prefix}.resources.cpu/memory`);
  }
  if (!hasDbPoolSnapshot(report)) missing.push(`${prefix}.dbPools.total/idle/waiting`);
  const workerMetrics = typeof report.workerMetrics === 'string' ? report.workerMetrics : '';
  for (const metric of [
    'ingest_jobs_retried_total',
    'ingest_events_failed_total',
    'ingest_events_rejected_total',
    'ingest_db_queries_per_batch_quantile',
    'ingest_events_per_batch_quantile',
  ]) {
    if (!workerMetrics.includes(metric)) missing.push(`${prefix}.workerMetrics.${metric}`);
  }
  return missing;
}

function pctChange(candidate: number, baseline: number): number {
  if (baseline === 0) return candidate === 0 ? 0 : 100;
  return ((candidate - baseline) / baseline) * 100;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

function latencyCheck(
  caseKeyValue: string,
  metric: string,
  baseline: BenchmarkReport,
  candidate: BenchmarkReport,
  limitPct: number,
): CheckResult | null {
  const base = finiteMetric(baseline, metric);
  const next = finiteMetric(candidate, metric);
  if (base === null || next === null) return null;
  const deltaPct = pctChange(next, base);
  return {
    caseKey: caseKeyValue,
    metric,
    baseline: base,
    candidate: next,
    deltaPct: round(deltaPct),
    limitPct,
    passed: deltaPct <= limitPct,
  };
}

function throughputCheck(
  caseKeyValue: string,
  metric: string,
  baseline: BenchmarkReport,
  candidate: BenchmarkReport,
  maxDropPct: number,
): CheckResult | null {
  const base = finiteMetric(baseline, metric);
  const next = finiteMetric(candidate, metric);
  if (base === null || next === null) return null;
  const deltaPct = pctChange(next, base);
  return {
    caseKey: caseKeyValue,
    metric,
    baseline: base,
    candidate: next,
    deltaPct: round(deltaPct),
    limitPct: -maxDropPct,
    passed: deltaPct >= -maxDropPct,
  };
}

function stageChecks(
  caseKeyValue: string,
  baseline: BenchmarkReport,
  candidate: BenchmarkReport,
  p99LimitPct: number,
  p999LimitPct: number,
): CheckResult[] {
  const checks: CheckResult[] = [];
  const stageNames = new Set([
    ...Object.keys(baseline.stages ?? {}),
    ...Object.keys(candidate.stages ?? {}),
  ]);
  for (const stage of stageNames) {
    const p99 = latencyCheck(caseKeyValue, `stages.${stage}.p99`, baseline, candidate, p99LimitPct);
    if (p99) checks.push(p99);
    const p999 = latencyCheck(caseKeyValue, `stages.${stage}.p999`, baseline, candidate, p999LimitPct);
    if (p999) checks.push(p999);
  }
  return checks;
}

function compareCase(caseKeyValue: string, baseline: MatrixResult, candidate: MatrixResult, config: CompareConfig): CaseComparison | null {
  if (!baseline.case || !candidate.case || !baseline.report || !candidate.report) return null;
  const missingMetrics = [
    ...missingReportMetrics(baseline.report, 'baseline'),
    ...missingReportMetrics(candidate.report, 'candidate'),
  ];
  const checks = [
    throughputCheck(caseKeyValue, 'throughputEventsPerSec', baseline.report, candidate.report, config.maxThroughputDropPct),
    throughputCheck(caseKeyValue, 'wallThroughputEventsPerSec', baseline.report, candidate.report, config.maxThroughputDropPct),
    latencyCheck(caseKeyValue, 'totalLatencyMs.p95', baseline.report, candidate.report, config.maxP95RegressionPct),
    latencyCheck(caseKeyValue, 'totalLatencyMs.p99', baseline.report, candidate.report, config.maxP99RegressionPct),
    latencyCheck(caseKeyValue, 'totalLatencyMs.p999', baseline.report, candidate.report, config.maxP999RegressionPct),
    ...stageChecks(caseKeyValue, baseline.report, candidate.report, config.maxStageP99RegressionPct, config.maxStageP999RegressionPct),
  ].filter((check): check is CheckResult => check !== null);
  return {
    caseKey: caseKeyValue,
    baseline: baseline.case,
    candidate: candidate.case,
    checks,
    missingMetrics,
    passed: missingMetrics.length === 0 && checks.length > 0 && checks.every((check) => check.passed),
  };
}

async function main(): Promise<void> {
  const config = parseArgs();
  const baseline = await readMatrix(config.baselinePath);
  const candidate = await readMatrix(config.candidatePath);
  const baselineMap = resultMap(baseline);
  const candidateMap = resultMap(candidate);
  const allKeys = new Set([...baselineMap.keys(), ...candidateMap.keys()]);
  const missingCases: string[] = [];
  const failedCases: string[] = [];
  const comparisons: CaseComparison[] = [];

  for (const key of [...allKeys].sort()) {
    const base = baselineMap.get(key);
    const next = candidateMap.get(key);
    if (!base || !next) {
      missingCases.push(key);
      continue;
    }
    if (base.exitCode !== 0 || base.error || next.exitCode !== 0 || next.error || !base.report || !next.report) {
      failedCases.push(key);
      continue;
    }
    const comparison = compareCase(key, base, next, config);
    if (comparison) comparisons.push(comparison);
  }

  const failedChecks = comparisons.flatMap((comparison) => comparison.checks.filter((check) => !check.passed));
  const missingMetrics = comparisons.flatMap((comparison) => comparison.missingMetrics.map((metric) => `${comparison.caseKey}: ${metric}`));
  const passed = comparisons.length > 0
    && failedChecks.length === 0
    && missingMetrics.length === 0
    && failedCases.length === 0
    && (config.allowMissingCases || missingCases.length === 0);

  console.log(JSON.stringify({
    passed,
    baseline: {
      plannedCases: baseline.plannedCases ?? null,
      completedCases: baseline.completedCases ?? null,
    },
    candidate: {
      plannedCases: candidate.plannedCases ?? null,
      completedCases: candidate.completedCases ?? null,
    },
    comparedCases: comparisons.length,
    missingCases,
    failedCases,
    missingMetrics,
    failedChecks,
    comparisons,
  }, null, 2));

  if (!passed) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
