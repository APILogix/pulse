/**
 * Summarize a benchmark matrix into the acceptance report fields.
 *
 * Input is scripts/run-ingestion-benchmark-matrix.ts JSON. Output defaults to
 * Markdown so the table can be pasted directly into the required report.
 */
import { readFile, writeFile } from 'fs/promises';

type OutputFormat = 'markdown' | 'json';

interface LatencySummary {
  p50?: number;
  p95?: number;
  p99?: number;
  p999?: number;
}

interface ResourceSummary {
  cpuTotalMs?: number;
  cpuUtilizationPct?: number;
  rssPeakBytes?: number;
  heapUsedPeakBytes?: number;
}

interface PoolSnapshot {
  total?: number;
  idle?: number;
  waiting?: number;
}

interface BenchmarkReport {
  mode?: string;
  type?: string;
  tenants?: number;
  batchSize?: number;
  totalEvents?: number;
  totalOutboxInserted?: number;
  throughputEventsPerSec?: number;
  wallThroughputEventsPerSec?: number;
  totalLatencyMs?: LatencySummary;
  stages?: Record<string, LatencySummary>;
  resources?: ResourceSummary;
  dbPools?: Record<string, PoolSnapshot | undefined>;
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
  dryRun?: boolean;
  plannedCases?: number;
  completedCases?: number;
  results?: MatrixResult[];
}

interface SummaryConfig {
  matrixPath: string;
  format: OutputFormat;
  outPath: string | null;
}

interface SummaryRow {
  type: string;
  mode: string | null;
  batchSize: number;
  tenants: number;
  workerConcurrency: number | null;
  trafficProfile: string | null;
  totalEvents: number | null;
  totalOutboxInserted: number | null;
  throughputEventsPerSec: number | null;
  wallThroughputEventsPerSec: number | null;
  p50Ms: number | null;
  p95Ms: number | null;
  p99Ms: number | null;
  p999Ms: number | null;
  dbLatencyP99Ms: number | null;
  dbLatencyP999Ms: number | null;
  typedInsertP99Ms: number | null;
  typedInsertP999Ms: number | null;
  queueLatencyP99Ms: number | null;
  queueLatencyP999Ms: number | null;
  cpuTotalMs: number | null;
  cpuUtilizationPct: number | null;
  rssPeakMb: number | null;
  heapUsedPeakMb: number | null;
  dbConnectionsTotal: number | null;
  dbConnectionsWaiting: number | null;
}

function usage(): void {
  console.error(`Usage:
  npm run bench:ingestion:matrix:summary -- --matrix matrix.json [--format markdown|json] [--out report.md]
`);
  process.exit(2);
}

function parseArgs(): SummaryConfig {
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

  const matrixPath = args.matrix;
  if (typeof matrixPath !== 'string') usage();
  if (typeof matrixPath !== 'string') process.exit(2);
  const format = args.format === 'json' ? 'json' : 'markdown';
  return {
    matrixPath,
    format,
    outPath: typeof args.out === 'string' ? args.out : null,
  };
}

async function readMatrix(path: string): Promise<MatrixReport> {
  const parsed = JSON.parse(await readFile(path, 'utf8')) as MatrixReport;
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.results)) {
    throw new Error(`${path} does not contain a benchmark matrix report`);
  }
  if (parsed.dryRun) throw new Error(`${path} is a dry-run plan, not measured benchmark evidence`);
  return parsed;
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function bytesToMb(value: unknown): number | null {
  const n = finite(value);
  return n === null ? null : Math.round((n / 1024 / 1024) * 100) / 100;
}

function maxNullable(values: Array<number | null>): number | null {
  const finiteValues = values.filter((value): value is number => value !== null);
  return finiteValues.length > 0 ? Math.max(...finiteValues) : null;
}

function dbLatencyPercentile(report: BenchmarkReport, percentile: keyof LatencySummary): number | null {
  return maxNullable([
    finite(report.stages?.dbConnectionWaitMs?.[percentile]),
    finite(report.stages?.db_connection_wait?.[percentile]),
    finite(report.stages?.insertMs?.[percentile]),
    finite(report.stages?.insert?.[percentile]),
    finite(report.stages?.commitMs?.[percentile]),
    finite(report.stages?.commit?.[percentile]),
    finite(report.stages?.outboxMs?.[percentile]),
    finite(report.stages?.outbox?.[percentile]),
    finite(report.stages?.dbQueryMs?.[percentile]),
    finite(report.stages?.db_query?.[percentile]),
  ]);
}

function typedInsertPercentile(report: BenchmarkReport, percentile: keyof LatencySummary): number | null {
  return maxNullable(Object.entries(report.stages ?? {})
    .filter(([stage]) => stage.startsWith('perType.') && stage.endsWith('.durationMs'))
    .map(([, summary]) => finite(summary?.[percentile])));
}

function queueLatencyPercentile(report: BenchmarkReport, percentile: keyof LatencySummary): number | null {
  return maxNullable([
    finite(report.stages?.queue_wait?.[percentile]),
    finite(report.stages?.queueWaitMs?.[percentile]),
    finite(report.stages?.worker_wait?.[percentile]),
    finite(report.stages?.workerWaitMs?.[percentile]),
    finite(report.stages?.worker_ready_wait?.[percentile]),
    finite(report.stages?.workerReadyWaitMs?.[percentile]),
  ]);
}

function poolTotal(report: BenchmarkReport): number | null {
  return maxNullable(Object.values(report.dbPools ?? {}).map((pool) => finite(pool?.total)));
}

function poolWaiting(report: BenchmarkReport): number | null {
  return maxNullable(Object.values(report.dbPools ?? {}).map((pool) => finite(pool?.waiting)));
}

function summarize(matrix: MatrixReport): SummaryRow[] {
  const rows: SummaryRow[] = [];
  for (const result of matrix.results ?? []) {
    if (result.exitCode !== 0 || result.error || !result.report) continue;
    const report = result.report;
    const benchCase = result.case ?? {
      type: report.type ?? 'unknown',
      batchSize: report.batchSize ?? 0,
      tenants: report.tenants ?? 0,
      workerConcurrency: null,
      trafficProfile: null,
    };
    rows.push({
      type: benchCase.type,
      mode: report.mode ?? null,
      batchSize: benchCase.batchSize,
      tenants: benchCase.tenants,
      workerConcurrency: finite(benchCase.workerConcurrency),
      trafficProfile: typeof benchCase.trafficProfile === 'string' ? benchCase.trafficProfile : null,
      totalEvents: finite(report.totalEvents),
      totalOutboxInserted: finite(report.totalOutboxInserted),
      throughputEventsPerSec: finite(report.throughputEventsPerSec),
      wallThroughputEventsPerSec: finite(report.wallThroughputEventsPerSec),
      p50Ms: finite(report.totalLatencyMs?.p50),
      p95Ms: finite(report.totalLatencyMs?.p95),
      p99Ms: finite(report.totalLatencyMs?.p99),
      p999Ms: finite(report.totalLatencyMs?.p999),
      dbLatencyP99Ms: dbLatencyPercentile(report, 'p99'),
      dbLatencyP999Ms: dbLatencyPercentile(report, 'p999'),
      typedInsertP99Ms: typedInsertPercentile(report, 'p99'),
      typedInsertP999Ms: typedInsertPercentile(report, 'p999'),
      queueLatencyP99Ms: queueLatencyPercentile(report, 'p99'),
      queueLatencyP999Ms: queueLatencyPercentile(report, 'p999'),
      cpuTotalMs: finite(report.resources?.cpuTotalMs),
      cpuUtilizationPct: finite(report.resources?.cpuUtilizationPct),
      rssPeakMb: bytesToMb(report.resources?.rssPeakBytes),
      heapUsedPeakMb: bytesToMb(report.resources?.heapUsedPeakBytes),
      dbConnectionsTotal: poolTotal(report),
      dbConnectionsWaiting: poolWaiting(report),
    });
  }
  return rows.sort((a, b) => a.type.localeCompare(b.type)
    || a.batchSize - b.batchSize
    || a.tenants - b.tenants
    || (a.workerConcurrency ?? 0) - (b.workerConcurrency ?? 0)
    || String(a.trafficProfile ?? '').localeCompare(String(b.trafficProfile ?? '')));
}

function renderValue(value: number | string | null): string {
  if (value === null) return '';
  if (typeof value === 'number') return String(Math.round(value * 100) / 100);
  return value;
}

function renderMarkdown(rows: SummaryRow[], matrix: MatrixReport): string {
  const header = [
    '# Ingestion Benchmark Matrix Summary',
    '',
    `Planned cases: ${matrix.plannedCases ?? ''}`,
    `Completed cases: ${matrix.completedCases ?? ''}`,
    `Summarized successful cases: ${rows.length}`,
    '',
    '| Type | Mode | Batch | Tenants | Worker concurrency | Traffic | Events | Outbox rows | Processing events/sec | Wall events/sec | p50 ms | p95 ms | p99 ms | p99.9 ms | DB p99 ms | DB p99.9 ms | Typed insert p99 ms | Typed insert p99.9 ms | Queue p99 ms | Queue p99.9 ms | CPU ms | CPU % | RSS peak MB | Heap peak MB | DB conns | DB waiting |',
    '| --- | --- | ---: | ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
  ];
  const body = rows.map((row) => [
    row.type,
    row.mode,
    row.batchSize,
    row.tenants,
    row.workerConcurrency,
    row.trafficProfile,
    row.totalEvents,
    row.totalOutboxInserted,
    row.throughputEventsPerSec,
    row.wallThroughputEventsPerSec,
    row.p50Ms,
    row.p95Ms,
    row.p99Ms,
    row.p999Ms,
    row.dbLatencyP99Ms,
    row.dbLatencyP999Ms,
    row.typedInsertP99Ms,
    row.typedInsertP999Ms,
    row.queueLatencyP99Ms,
    row.queueLatencyP999Ms,
    row.cpuTotalMs,
    row.cpuUtilizationPct,
    row.rssPeakMb,
    row.heapUsedPeakMb,
    row.dbConnectionsTotal,
    row.dbConnectionsWaiting,
  ].map(renderValue).join(' | ')).map((line) => `| ${line} |`);
  return [...header, ...body, ''].join('\n');
}

async function main(): Promise<void> {
  const config = parseArgs();
  const matrix = await readMatrix(config.matrixPath);
  const rows = summarize(matrix);
  const output = config.format === 'json'
    ? `${JSON.stringify({ matrix: { plannedCases: matrix.plannedCases ?? null, completedCases: matrix.completedCases ?? null }, rows }, null, 2)}\n`
    : renderMarkdown(rows, matrix);
  if (config.outPath) await writeFile(config.outPath, output, 'utf8');
  process.stdout.write(output);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
