/**
 * Validate that an ingestion optimization evidence bundle is complete enough
 * to support the final reports.
 */
import { access, readFile, writeFile } from 'fs/promises';
import { dirname, isAbsolute, resolve } from 'path';
import { priorPhaseRemovedIndexNames } from './lib/ingestion-catalog-scope.js';

type EvidenceStatus = 'passed' | 'failed';

interface EvidenceConfig {
  benchmarkMatrixPath: string;
  benchmarkSummaryPath: string;
  matrixComparePath: string;
  explainPath: string;
  explainSummaryPath: string;
  dbAuditPath: string;
  dbAuditSummaryPath: string;
  dbRuntimePath: string;
  dbRuntimeSummaryPath: string;
  admissionSummaryPath: string;
  workerSummaryPath: string;
  triageSummaryPath: string;
  prometheusScrapePath: string;
  grafanaDashboardPath: string;
  metricsScrapeProofPath: string;
  failureScenariosPath: string;
  testReportPath: string;
  outPath: string | null;
}

interface EvidenceCheck {
  name: string;
  status: EvidenceStatus;
  detail: string;
}

const requiredBenchmarkTypes = [
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

const requiredBatchSizes = [10, 100, 500, 1000, 5000, 10000];
const requiredTenantCounts = [1, 10, 100];
const requiredWorkerConcurrency = [1, 2, 4, 8, 16, 32];
const requiredTrafficProfiles = ['low', 'normal', 'burst'];
const requiredIngestionTables = [
  'events_errors',
  'events_requests',
  'events_messages',
  'events_spans',
  'events_traces',
  'events_metrics',
  'events_logs',
  'events_profiles',
  'events_cron_checkins',
  'events_replays',
  'telemetry_outbox',
  'alert_runtime_idempotency_keys',
  'error_groups',
  'analytics_error_groups',
  'ingestion_dead_letter_jobs',
];

const requiredIngestQueues = [
  'ingest.error',
  'ingest.message',
  'ingest.request',
  'ingest.span',
  'ingest.trace',
  'ingest.metric',
  'ingest.log',
  'ingest.profile',
  'ingest.cron_checkin',
  'ingest.replay',
  'ingest.dlq-intake',
];

const requiredPrimaryAuthIndexes = [
  'idx_project_api_keys_public_key',
  'idx_org_subscriptions_live_latest',
  'idx_project_api_key_rotations_grace_lookup',
];

const requiredRequestHotPathIndexes = [
  'idx_events_requests_event_unique',
  'idx_events_requests_tenant_time',
  'idx_events_requests_occurred_brin',
  'idx_events_requests_pubid',
];

/**
 * The `events_requests` indexes earlier phases removed from the ingestion hot
 * path, derived from `scripts/lib/ingestion-catalog-scope.ts` so this check and
 * the audit's prior-phase disposition record cannot drift apart.
 *
 * This check is `events_requests`-scoped, so the derivation is too: it yields
 * the 14 names dropped by `025` and `028`. The 10 `events_spans` and
 * `events_logs` names dropped by `029` are recorded in the shared list and
 * surface through the audit's `priorPhaseIndexRemovals` section instead.
 */
const forbiddenRequestHotPathIndexes = priorPhaseRemovedIndexNames('events_requests');

const requiredTypedEventTriggerTables = [
  'events_requests',
  'events_errors',
  'events_logs',
  'events_metrics',
  'events_spans',
  'events_traces',
  'events_messages',
  'events_profiles',
  'events_replays',
  'events_cron_checkins',
];

const forbiddenTypedEventTriggerTables = [
  'error_groups',
  'analytics_error_groups',
];

const requiredExplainTables = [
  'events_errors',
  'events_requests',
  'events_messages',
  'events_spans',
  'events_traces',
  'events_metrics',
  'events_logs',
  'events_profiles',
  'events_cron_checkins',
  'events_replays',
  'telemetry_outbox',
  'alert_runtime_idempotency_keys',
];

const requiredFailureScenarios = [
  'PostgreSQL connection failure',
  'database timeout',
  'worker crash',
  'queue restart',
  'duplicate job delivery',
  'partial batch failure',
  'malformed timestamp',
  'malformed event',
  'huge event',
  'traffic burst',
  'one tenant flooding ingestion',
  'database overload',
  'connection pool exhaustion',
  'graceful shutdown',
];

function usage(): void {
  console.error(`Usage:
  npm run ingestion:evidence:validate -- \\
    --benchmark-matrix artifacts/ingestion-acceptance-matrix.json \\
    --benchmark-summary artifacts/ingestion-acceptance-summary.md \\
    --matrix-compare artifacts/ingestion-matrix-compare.json \\
    --explain artifacts/ingestion-mixed-explain.json \\
    --explain-summary artifacts/ingestion-mixed-explain-summary.md \\
    --db-audit artifacts/ingestion-db-audit.json \\
    --db-audit-summary artifacts/ingestion-db-audit.md \\
    --db-runtime artifacts/ingestion-db-runtime.json \\
    --db-runtime-summary artifacts/ingestion-db-runtime-summary.md \\
    --admission-summary artifacts/ingestion-admission-summary.md \\
    --worker-summary artifacts/ingestion-worker-summary.md \\
    --triage-summary artifacts/ingestion-triage-summary.md \\
    --prometheus-scrape docs/modules/ingestion/observability/prometheus-scrape.yml \\
    --grafana-dashboard docs/modules/ingestion/observability/grafana-dashboard.json \\
    --metrics-scrape-proof artifacts/ingestion-metrics-scrape-proof.json \\
    --failure-scenarios artifacts/ingestion-failure-scenarios.json \\
    --test-report artifacts/ingestion-test-report.md \\
    [--out artifacts/ingestion-evidence-validation.json]
`);
  process.exit(2);
}

function parseArgs(): EvidenceConfig {
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

  const benchmarkMatrixPath = args['benchmark-matrix'];
  const benchmarkSummaryPath = args['benchmark-summary'];
  const matrixComparePath = args['matrix-compare'];
  const explainPath = args.explain;
  const explainSummaryPath = args['explain-summary'];
  const dbAuditPath = args['db-audit'];
  const dbAuditSummaryPath = args['db-audit-summary'];
  const dbRuntimePath = args['db-runtime'];
  const dbRuntimeSummaryPath = args['db-runtime-summary'];
  const admissionSummaryPath = args['admission-summary'];
  const workerSummaryPath = args['worker-summary'];
  const triageSummaryPath = args['triage-summary'];
  const prometheusScrapePath = args['prometheus-scrape'];
  const grafanaDashboardPath = args['grafana-dashboard'];
  const metricsScrapeProofPath = args['metrics-scrape-proof'];
  const failureScenariosPath = args['failure-scenarios'];
  const testReportPath = args['test-report'];
  if (
    typeof benchmarkMatrixPath !== 'string'
    || typeof benchmarkSummaryPath !== 'string'
    || typeof matrixComparePath !== 'string'
    || typeof explainPath !== 'string'
    || typeof explainSummaryPath !== 'string'
    || typeof dbAuditPath !== 'string'
    || typeof dbAuditSummaryPath !== 'string'
    || typeof dbRuntimePath !== 'string'
    || typeof dbRuntimeSummaryPath !== 'string'
    || typeof admissionSummaryPath !== 'string'
    || typeof workerSummaryPath !== 'string'
    || typeof triageSummaryPath !== 'string'
    || typeof prometheusScrapePath !== 'string'
    || typeof grafanaDashboardPath !== 'string'
    || typeof metricsScrapeProofPath !== 'string'
    || typeof failureScenariosPath !== 'string'
    || typeof testReportPath !== 'string'
  ) {
    usage();
  }
  if (
    typeof benchmarkMatrixPath !== 'string'
    || typeof benchmarkSummaryPath !== 'string'
    || typeof matrixComparePath !== 'string'
    || typeof explainPath !== 'string'
    || typeof explainSummaryPath !== 'string'
    || typeof dbAuditPath !== 'string'
    || typeof dbAuditSummaryPath !== 'string'
    || typeof dbRuntimePath !== 'string'
    || typeof dbRuntimeSummaryPath !== 'string'
    || typeof admissionSummaryPath !== 'string'
    || typeof workerSummaryPath !== 'string'
    || typeof triageSummaryPath !== 'string'
    || typeof prometheusScrapePath !== 'string'
    || typeof grafanaDashboardPath !== 'string'
    || typeof metricsScrapeProofPath !== 'string'
    || typeof failureScenariosPath !== 'string'
    || typeof testReportPath !== 'string'
  ) {
    process.exit(2);
  }

  return {
    benchmarkMatrixPath,
    benchmarkSummaryPath,
    matrixComparePath,
    explainPath,
    explainSummaryPath,
    dbAuditPath,
    dbAuditSummaryPath,
    dbRuntimePath,
    dbRuntimeSummaryPath,
    admissionSummaryPath,
    workerSummaryPath,
    triageSummaryPath,
    prometheusScrapePath,
    grafanaDashboardPath,
    metricsScrapeProofPath,
    failureScenariosPath,
    testReportPath,
    outPath: typeof args.out === 'string' ? args.out : null,
  };
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8'));
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function numberArray(value: unknown): number[] {
  return Array.isArray(value)
    ? value.map((item) => Number(item)).filter((item) => Number.isFinite(item))
    : [];
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function pass(name: string, detail: string): EvidenceCheck {
  return { name, status: 'passed', detail };
}

function fail(name: string, detail: string): EvidenceCheck {
  return { name, status: 'failed', detail };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function checkJsonFile(path: string, name: string): Promise<{ parsed: unknown; check: EvidenceCheck }> {
  if (!(await exists(path))) return { parsed: null, check: fail(name, `${path} is missing`) };
  try {
    return { parsed: await readJson(path), check: pass(name, `${path} is valid JSON`) };
  } catch (err) {
    return { parsed: null, check: fail(name, `${path} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`) };
  }
}

async function checkRequiredTextFile(path: string, name: string, requiredText: string[]): Promise<EvidenceCheck> {
  if (!(await exists(path))) return fail(name, `${path} is missing`);
  const content = await readFile(path, 'utf8');
  const missing = requiredText.filter((text) => !content.includes(text));
  if (missing.length > 0) return fail(name, `${path} is missing required text: ${missing.join(', ')}`);
  return pass(name, `${path} includes ${requiredText.length} required evidence marker(s)`);
}

async function checkBenchmarkSummary(path: string): Promise<EvidenceCheck[]> {
  if (!(await exists(path))) return [fail('benchmark_summary_file', `${path} is missing`)];
  const content = await readFile(path, 'utf8');
  const requiredText = [
    'Ingestion Benchmark Matrix Summary',
    'p99.9',
    'Wall events/sec',
    'Worker concurrency',
    'Traffic',
    'DB p99.9',
    'Queue p99.9',
  ];
  const missing = requiredText.filter((text) => !content.includes(text));
  if (missing.length > 0) {
    return [
      pass('benchmark_summary_file', `${path} exists`),
      fail('benchmark_summary_content', `${path} is missing required benchmark summary text: ${missing.join(', ')}`),
    ];
  }
  return [
    pass('benchmark_summary_file', `${path} exists`),
    pass('benchmark_summary_content', `${path} includes p99.9, wall throughput, worker concurrency, traffic profile, DB tail, and queue tail columns`),
  ];
}

async function checkExplainSummary(path: string): Promise<EvidenceCheck> {
  return checkRequiredTextFile(path, 'explain_summary_file', [
    'Ingestion EXPLAIN Summary',
    'Type: mixed',
    'Analyze: true',
    'WAL: true',
    'Planning ms',
    'Execution ms',
    'Trigger calls',
    'Trigger ms',
    'WAL records',
    'WAL FPI',
    'WAL bytes',
    'Actual rows',
    'Plan rows',
    'Shared hit',
    'Shared read',
    'Shared dirtied',
    'Temp read',
    'Temp written',
    '## Findings',
    ...requiredExplainTables,
  ]);
}

async function checkDbAuditSummary(path: string): Promise<EvidenceCheck> {
  return checkRequiredTextFile(path, 'db_audit_summary_file', [
    'Ingestion Database Schema Audit',
    'Log database:',
    'Primary database:',
    'Tables requested:',
    '## Tables',
    '## Indexes',
    '## Constraints',
    '## Triggers',
    '## Partitions',
    '## Timescale Hypertables',
    '## Primary Auth Indexes',
    '## pg-boss Tables',
    '## pg-boss Queues',
    'pgboss',
    'job',
    'archive',
    ...requiredPrimaryAuthIndexes,
    ...requiredIngestionTables,
  ]);
}

async function checkDbRuntimeSummary(path: string): Promise<EvidenceCheck> {
  return checkRequiredTextFile(path, 'db_runtime_summary_file', [
    'Ingestion Runtime DB Summary',
    '## Pressure Summary',
    'Log DB inserted row delta',
    'events_requests inserted row delta',
    'events_requests heap bytes delta',
    'events_requests index bytes delta',
    'events_requests index bytes per inserted row',
    'WAL bytes delta',
    'WAL sync time ms delta',
    'WAL sync time ms per Log DB commit',
    'Log DB committed transaction delta',
    'Log DB rollback transaction delta',
    'Log DB block read delta',
    'Log DB block hit delta',
    'Log DB cache hit pct',
    'Log DB temp bytes delta',
    'Waiting Log DB sessions',
    'Log DB lock waiter rows',
    'pg-boss pending jobs',
    'Primary DB WAL bytes delta',
    'Primary DB WAL sync time ms delta',
    'Primary DB WAL sync time ms per commit',
    'Primary DB committed transaction delta',
    'Primary DB rollback transaction delta',
    'Primary DB block read delta',
    'Primary DB block hit delta',
    'Primary DB cache hit pct',
    'Primary DB temp bytes delta',
    'Waiting Primary DB pg-boss sessions',
    'Primary DB pg-boss lock waiter rows',
    'Primary pg-boss inserted row delta',
    'Primary pg-boss updated row delta',
    'Primary pg-boss index bytes delta',
    '## Findings',
    '## Top Insert Tables',
    '## Top Primary pg-boss Write Tables',
    '## Top Relation Growth',
    '## Top Primary pg-boss Relation Growth',
    '## Largest Relations',
    '## Largest Primary pg-boss Relations',
  ]);
}

async function checkAdmissionSummary(path: string): Promise<EvidenceCheck> {
  return checkRequiredTextFile(path, 'admission_summary_file', [
    'Ingestion Admission Profile Summary',
    '## Totals',
    'Profiles:',
    'Received',
    'Accepted',
    'Rejected',
    'Shed',
    'Jobs built',
    '## Gateway Latency',
    'enqueueMs',
    'totalAdmissionMs',
    'queueProvisionMs',
    'queueProvisionRetryMs',
    '## Admission Stage Detail',
    'projectLookupMs',
    'quotaMs',
    'queueDepthMs',
    'jobBuildMs',
    '## Queue Breakdown Coverage',
    'Profiles missing enqueueQueues while enqueueMs > 0',
    '## Queue Enqueue Latency',
    'ingest.request',
    'Fallback batches',
    '## Diagnostic Classification',
    '## Findings',
  ]);
}

async function checkWorkerSummary(path: string): Promise<EvidenceCheck> {
  return checkRequiredTextFile(path, 'worker_summary_file', [
    'Ingestion Worker Profile Summary',
    '## Totals',
    'Profiles:',
    'Successful profiles',
    'Failed profiles',
    'Received',
    'Validated',
    'Rejected',
    'Inserted',
    'DB queries',
    'DB query ms',
    '## Successful Stage Latency',
    'totalProcessingMs',
    'queueWaitMs',
    'dbConnectionWaitMs',
    'insertMs',
    'commitMs',
    'dbQueryMs',
    '## Failed Transaction Latency',
    'rollbackMs',
    '## Event Type Summary',
    'request',
    '## Failure Classes',
    '## Per-Type Typed Insert Latency',
    '## Diagnostic Classification',
    '## Findings',
  ]);
}

async function checkTriageSummary(path: string): Promise<EvidenceCheck> {
  return checkRequiredTextFile(path, 'triage_summary_file', [
    'Ingestion Bottleneck Triage Summary',
    '## Inputs',
    'Admission summary:',
    'Worker summary:',
    'DB runtime summary:',
    '## Admission Classification',
    '## Worker Classification',
    '## DB Runtime Findings',
    '## Admission Findings',
    '## Worker Findings',
    '## Next Proof Required',
  ]);
}

async function checkTestReport(path: string): Promise<EvidenceCheck[]> {
  if (!(await exists(path))) return [fail('test_report_file', `${path} is missing`)];
  const content = await readFile(path, 'utf8');
  const normalizedContent = content.toLowerCase();
  const requiredSections = [
    'Test Report',
    'unit',
    'integration',
    'load',
    'failure',
    'duplicate',
    'timestamp',
    'fairness',
  ];
  const missing = requiredSections.filter((section) => !normalizedContent.includes(section.toLowerCase()));
  if (missing.length > 0) {
    return [
      pass('test_report_file', `${path} exists`),
      fail('test_report_content', `${path} is missing required section text: ${missing.join(', ')}`),
    ];
  }
  if (/Status:\s*(not_run|failed)\b/i.test(content) || /Overall status:\s*failed\b/i.test(content)) {
    return [
      pass('test_report_file', `${path} exists`),
      fail('test_report_content', `${path} contains not_run or failed test sections`),
    ];
  }
  const missingFailureScenarios = requiredFailureScenarios.filter((scenario) => !normalizedContent.includes(scenario.toLowerCase()));
  if (missingFailureScenarios.length > 0) {
    return [
      pass('test_report_file', `${path} exists`),
      fail('test_report_content', `${path} is missing required failure scenario coverage text: ${missingFailureScenarios.join(', ')}`),
    ];
  }
  const missingPassedScenarioRows = requiredFailureScenarios.filter((scenario) => {
    const pattern = new RegExp(`\\|\\s*${escapeRegExp(scenario)}\\s*\\|\\s*passed\\s*\\|`, 'i');
    return !pattern.test(content);
  });
  if (missingPassedScenarioRows.length > 0) {
    return [
      pass('test_report_file', `${path} exists`),
      fail('test_report_content', `${path} is missing passed scenario-matrix row(s): ${missingPassedScenarioRows.join(', ')}`),
    ];
  }
  return [
    pass('test_report_file', `${path} exists`),
    pass('test_report_content', `${path} includes required unit/integration/load/failure/duplicate/timestamp/fairness coverage sections and ${requiredFailureScenarios.length} passed failure scenario rows`),
  ];
}

function missingValues<T extends string | number>(actual: T[], required: T[]): T[] {
  const actualSet = new Set(actual);
  return required.filter((item) => !actualSet.has(item));
}

function caseKey(type: string, batchSize: number, tenants: number, workerConcurrency: number, trafficProfile: string): string {
  return `${type}|${batchSize}|${tenants}|${workerConcurrency}|${trafficProfile}`;
}

function compareCaseKey(type: string, batchSize: number, tenants: number, workerConcurrency: number, trafficProfile: string): string {
  return `${type}|batch=${batchSize}|tenants=${tenants}|workerConcurrency=${workerConcurrency}|traffic=${trafficProfile}`;
}

function requiredBenchmarkCaseKeys(format: 'matrix' | 'compare'): string[] {
  const keys: string[] = [];
  for (const type of requiredBenchmarkTypes) {
    for (const batchSize of requiredBatchSizes) {
      for (const tenants of requiredTenantCounts) {
        for (const workerConcurrency of requiredWorkerConcurrency) {
          for (const trafficProfile of requiredTrafficProfiles) {
            keys.push(format === 'matrix'
              ? caseKey(type, batchSize, tenants, workerConcurrency, trafficProfile)
              : compareCaseKey(type, batchSize, tenants, workerConcurrency, trafficProfile));
          }
        }
      }
    }
  }
  return keys;
}

function hasLatencyPercentiles(value: unknown): boolean {
  const summary = object(value);
  return summary !== null
    && finiteNumber(summary.p50) !== null
    && finiteNumber(summary.p95) !== null
    && finiteNumber(summary.p99) !== null
    && finiteNumber(summary.p999) !== null;
}

function hasAnyStagePercentiles(stages: Record<string, unknown>, names: string[]): boolean {
  return names.some((name) => hasLatencyPercentiles(stages[name]));
}

function missingPerTypeStages(report: Record<string, unknown>): string[] {
  const eventTypes = object(report.eventTypes) ?? {};
  const stages = object(report.stages) ?? {};
  return Object.entries(eventTypes)
    .filter(([type, count]) => type !== 'mixed' && finiteNumber(count) !== null && Number(count) > 0)
    .filter(([type]) => !hasLatencyPercentiles(stages[`perType.${type}.durationMs`]))
    .map(([type]) => `stages.perType.${type}.durationMs.p50/p95/p99/p999`);
}

function hasDbPoolSnapshot(value: unknown): boolean {
  const pools = object(value);
  if (!pools) return false;
  return Object.values(pools).some((pool) => {
    const snapshot = object(pool);
    return snapshot !== null
      && finiteNumber(snapshot.total) !== null
      && finiteNumber(snapshot.idle) !== null
      && finiteNumber(snapshot.waiting) !== null;
  });
}

function missingBenchmarkReportFields(result: unknown): string[] {
  const resultObject = object(result);
  const benchCase = object(resultObject?.case);
  const report = object(resultObject?.report);
  if (!report) return ['report'];
  const stages = object(report.stages) ?? {};
  const resources = object(report.resources);
  const workerMetrics = typeof report.workerMetrics === 'string' ? report.workerMetrics : '';
  const missing: string[] = [];
  if (report.mode !== 'processor') missing.push('mode=processor');
  if (report.committed !== true) missing.push('committed=true');
  if (typeof benchCase?.trafficProfile === 'string' && report.trafficProfile !== benchCase.trafficProfile) missing.push('trafficProfile');
  if (Number(benchCase?.workerConcurrency) <= 0) missing.push('case.workerConcurrency');
  if (finiteNumber(report.totalEvents) === null || Number(report.totalEvents) <= 0) missing.push('totalEvents');
  if (finiteNumber(report.totalOutboxInserted) === null) missing.push('totalOutboxInserted');
  if (finiteNumber(report.throughputEventsPerSec) === null || Number(report.throughputEventsPerSec) <= 0) missing.push('throughputEventsPerSec');
  if (finiteNumber(report.wallThroughputEventsPerSec) === null || Number(report.wallThroughputEventsPerSec) <= 0) missing.push('wallThroughputEventsPerSec');
  if (!hasLatencyPercentiles(report.totalLatencyMs)) missing.push('totalLatencyMs.p50/p95/p99/p999');
  if (!hasAnyStagePercentiles(stages, ['queue_wait', 'queueWaitMs', 'worker_wait', 'workerWaitMs', 'worker_ready_wait', 'workerReadyWaitMs'])) {
    missing.push('queueLatency.p50/p95/p99/p999');
  }
  if (!hasAnyStagePercentiles(stages, ['dbConnectionWaitMs', 'db_connection_wait', 'insertMs', 'insert', 'commitMs', 'commit', 'outboxMs', 'outbox', 'dbQueryMs', 'db_query'])) {
    missing.push('dbLatency.p50/p95/p99/p999');
  }
  missing.push(...missingPerTypeStages(report));
  if (!resources
    || finiteNumber(resources.cpuTotalMs) === null
    || finiteNumber(resources.cpuUtilizationPct) === null
    || finiteNumber(resources.rssPeakBytes) === null
    || finiteNumber(resources.heapUsedPeakBytes) === null) {
    missing.push('resources.cpu/memory');
  }
  if (!hasDbPoolSnapshot(report.dbPools)) missing.push('dbPools.total/idle/waiting');
  for (const metric of [
    'ingest_jobs_retried_total',
    'ingest_events_failed_total',
    'ingest_events_rejected_total',
    'ingest_db_queries_per_batch_quantile',
    'ingest_events_per_batch_quantile',
  ]) {
    if (!workerMetrics.includes(metric)) missing.push(`workerMetrics.${metric}`);
  }
  return missing;
}

function checkBenchmarkMatrix(parsed: unknown): EvidenceCheck[] {
  const matrix = object(parsed);
  if (!matrix) return [fail('benchmark_matrix_content', 'benchmark matrix is not an object')];
  if (matrix.dryRun === true) return [fail('benchmark_matrix_content', 'benchmark matrix is only a dry-run plan')];
  if (matrix.passed !== true) return [fail('benchmark_matrix_content', 'benchmark matrix did not pass')];

  const checks: EvidenceCheck[] = [];
  const config = object(matrix.config);
  if (!config) {
    checks.push(fail('benchmark_matrix_dimensions', 'benchmark matrix has no config object'));
  } else {
    const missingTypes = missingValues(stringArray(config.types), requiredBenchmarkTypes);
    const missingBatchSizes = missingValues(numberArray(config.batchSizes), requiredBatchSizes);
    const missingTenants = missingValues(numberArray(config.tenants), requiredTenantCounts);
    const missingWorkerConcurrency = missingValues(numberArray(config.workerConcurrency), requiredWorkerConcurrency);
    const missingTrafficProfiles = missingValues(stringArray(config.trafficProfiles), requiredTrafficProfiles);
    const missing = [
      missingTypes.length > 0 ? `types=${missingTypes.join(',')}` : null,
      missingBatchSizes.length > 0 ? `batchSizes=${missingBatchSizes.join(',')}` : null,
      missingTenants.length > 0 ? `tenants=${missingTenants.join(',')}` : null,
      missingWorkerConcurrency.length > 0 ? `workerConcurrency=${missingWorkerConcurrency.join(',')}` : null,
      missingTrafficProfiles.length > 0 ? `trafficProfiles=${missingTrafficProfiles.join(',')}` : null,
    ].filter(Boolean);
    if (missing.length > 0) {
      checks.push(fail('benchmark_matrix_dimensions', `benchmark matrix is missing required acceptance dimensions: ${missing.join('; ')}`));
    } else {
      checks.push(pass(
        'benchmark_matrix_dimensions',
        `benchmark matrix covers ${requiredBenchmarkTypes.length} event types, ${requiredBatchSizes.length} batch sizes, ${requiredTenantCounts.length} tenant counts, ${requiredWorkerConcurrency.length} worker concurrency values, and ${requiredTrafficProfiles.length} traffic profiles`,
      ));
    }
  }

  const planned = Number(matrix.plannedCases);
  const completed = Number(matrix.completedCases);
  const results = Array.isArray(matrix.results) ? matrix.results : [];
  if (!Number.isFinite(planned) || planned <= 0) return [fail('benchmark_matrix_content', 'benchmark matrix has no planned cases'), ...checks];
  if (completed !== planned || results.length !== planned) {
    return [fail('benchmark_matrix_content', `benchmark matrix incomplete: planned=${planned}, completed=${completed}, results=${results.length}`), ...checks];
  }
  const failed = results.filter((result) => object(result)?.exitCode !== 0 || object(result)?.error);
  if (failed.length > 0) return [fail('benchmark_matrix_content', `${failed.length} benchmark case(s) failed`), ...checks];

  const weakReports: string[] = [];
  for (const result of results) {
    const missingFields = missingBenchmarkReportFields(result);
    if (missingFields.length === 0) continue;
    const benchCase = object(object(result)?.case);
    const label = benchCase
      ? compareCaseKey(
        String(benchCase.type ?? 'unknown'),
        Number(benchCase.batchSize),
        Number(benchCase.tenants),
        Number(benchCase.workerConcurrency),
        String(benchCase.trafficProfile ?? 'unknown'),
      )
      : 'unknown';
    weakReports.push(`${label}: ${missingFields.join(', ')}`);
  }
  if (weakReports.length > 0) {
    return [
      fail('benchmark_matrix_report_metrics', `benchmark matrix has ${weakReports.length} case report(s) missing required final metrics: ${weakReports.slice(0, 5).join('; ')}${weakReports.length > 5 ? '; ...' : ''}`),
      ...checks,
    ];
  }

  const completedCases = new Set<string>();
  for (const result of results) {
    const benchCase = object(object(result)?.case);
    if (!benchCase) continue;
    const type = typeof benchCase.type === 'string' ? benchCase.type : '';
    const batchSize = Number(benchCase.batchSize);
    const tenants = Number(benchCase.tenants);
    const workerConcurrency = Number(benchCase.workerConcurrency);
    const trafficProfile = typeof benchCase.trafficProfile === 'string' ? benchCase.trafficProfile : '';
    if (type && Number.isFinite(batchSize) && Number.isFinite(tenants) && Number.isFinite(workerConcurrency) && trafficProfile) {
      completedCases.add(caseKey(type, batchSize, tenants, workerConcurrency, trafficProfile));
    }
  }
  const missingCases = requiredBenchmarkCaseKeys('matrix').filter((key) => !completedCases.has(key));
  if (missingCases.length > 0) {
    return [
      fail('benchmark_matrix_content', `benchmark matrix is missing ${missingCases.length} required acceptance case(s): ${missingCases.slice(0, 10).join(', ')}${missingCases.length > 10 ? ', ...' : ''}`),
      ...checks,
    ];
  }

  return [
    pass('benchmark_matrix_content', `benchmark matrix passed with ${planned} completed case(s), including all ${requiredBenchmarkTypes.length * requiredBatchSizes.length * requiredTenantCounts.length * requiredWorkerConcurrency.length * requiredTrafficProfiles.length} required acceptance case(s)`),
    pass('benchmark_matrix_report_metrics', 'all benchmark case reports include processor mode, committed writes, throughput, outbox row counts, p50/p95/p99/p99.9, queue latency, DB latency, CPU/memory, DB pool, retry/error, and batch-shape metrics'),
    ...checks,
  ];
}

function checkMatrixCompare(parsed: unknown): EvidenceCheck[] {
  const compare = object(parsed);
  if (!compare) return [fail('matrix_compare_content', 'matrix compare is not an object')];
  if (compare.passed !== true) return [fail('matrix_compare_content', 'matrix compare did not pass')];
  const comparedCases = Number(compare.comparedCases);
  if (!Number.isFinite(comparedCases) || comparedCases <= 0) {
    return [fail('matrix_compare_content', 'matrix compare has no compared cases')];
  }
  const missingCases = Array.isArray(compare.missingCases) ? compare.missingCases.length : 0;
  const failedCases = Array.isArray(compare.failedCases) ? compare.failedCases.length : 0;
  const missingMetrics = Array.isArray(compare.missingMetrics) ? compare.missingMetrics.length : 0;
  const failedChecks = Array.isArray(compare.failedChecks) ? compare.failedChecks.length : 0;
  if (missingCases || failedCases || missingMetrics || failedChecks) {
    return [fail('matrix_compare_content', `matrix compare has missing=${missingCases}, failedCases=${failedCases}, missingMetrics=${missingMetrics}, failedChecks=${failedChecks}`)];
  }

  const comparisons = Array.isArray(compare.comparisons) ? compare.comparisons : [];
  const comparedKeys = new Set<string>();
  for (const comparison of comparisons) {
    const comparisonObject = object(comparison);
    if (typeof comparisonObject?.caseKey === 'string') comparedKeys.add(comparisonObject.caseKey);
  }
  const missingAcceptanceCases = requiredBenchmarkCaseKeys('compare').filter((key) => !comparedKeys.has(key));
  if (missingAcceptanceCases.length > 0) {
    return [
      fail('matrix_compare_content', `matrix compare is missing ${missingAcceptanceCases.length} required acceptance comparison(s): ${missingAcceptanceCases.slice(0, 10).join(', ')}${missingAcceptanceCases.length > 10 ? ', ...' : ''}`),
    ];
  }
  const weakComparisons = comparisons
    .map(object)
    .filter((comparison) => !Array.isArray(comparison?.checks) || comparison.checks.length === 0 || !Array.isArray(comparison?.missingMetrics));
  if (weakComparisons.length > 0) {
    return [fail('matrix_compare_content', `${weakComparisons.length} comparison(s) were produced by an older/weak comparator without checks and missingMetrics metadata`)];
  }
  return [
    pass('matrix_compare_content', `matrix compare passed for ${comparedCases} case(s), including all ${requiredBenchmarkTypes.length * requiredBatchSizes.length * requiredTenantCounts.length * requiredWorkerConcurrency.length * requiredTrafficProfiles.length} required acceptance comparison(s) with required metric coverage`),
  ];
}

function textSetFromRows(rows: unknown[], fields: string[]): Set<string> {
  const values = new Set<string>();
  for (const row of rows) {
    const rowObject = object(row);
    if (!rowObject) continue;
    for (const field of fields) {
      const value = rowObject[field];
      if (typeof value === 'string') values.add(value);
    }
  }
  return values;
}

function containsTable(texts: Set<string>, table: string): boolean {
  for (const text of texts) {
    if (text.includes(table)) return true;
  }
  return false;
}

function firstExplainEntry(raw: unknown): Record<string, unknown> | null {
  if (Array.isArray(raw)) return object(raw[0]);
  return object(raw);
}

function planTreeHasNumber(plan: Record<string, unknown> | null, field: string): boolean {
  if (!plan) return false;
  if (finiteNumber(plan[field]) !== null) return true;
  const children = Array.isArray(plan.Plans) ? plan.Plans : [];
  return children.some((child) => planTreeHasNumber(object(child), field));
}

function explainPlanHasWal(plan: Record<string, unknown>): boolean {
  const entry = firstExplainEntry(plan.plan);
  const rootPlan = object(entry?.Plan);
  return planTreeHasNumber(rootPlan, 'WAL Records')
    || planTreeHasNumber(rootPlan, 'WAL FPI')
    || planTreeHasNumber(rootPlan, 'WAL Bytes');
}

function explainPlanHasTriggerTiming(plan: Record<string, unknown>): boolean {
  const entry = firstExplainEntry(plan.plan);
  const triggers = Array.isArray(entry?.Triggers) ? entry.Triggers : [];
  return triggers
    .map(object)
    .some((trigger) => trigger !== null
      && finiteNumber(trigger.Calls) !== null
      && finiteNumber(trigger.Time) !== null);
}

function explainPlanMentionsTable(plan: Record<string, unknown>, table: string): boolean {
  const label = typeof plan.label === 'string' ? plan.label : '';
  const statement = typeof plan.statement === 'string' ? plan.statement : '';
  return label.includes(table) || statement.includes(table);
}

function checkExplain(parsed: unknown): EvidenceCheck[] {
  const explain = object(parsed);
  if (!explain) return [fail('explain_content', 'EXPLAIN output is not an object')];
  const plans = Array.isArray(explain.plans) ? explain.plans : [];
  if (plans.length === 0) return [fail('explain_content', 'EXPLAIN output has no captured plans')];
  const planRows = plans.map(object).filter((plan): plan is Record<string, unknown> => plan !== null);
  const withPlan = planRows.filter((plan) => plan.plan != null);
  if (withPlan.length !== plans.length) return [fail('explain_content', `${plans.length - withPlan.length} EXPLAIN plan(s) are missing plan data`)];
  const checks: EvidenceCheck[] = [];
  if (explain.analyze !== true) {
    checks.push(fail('explain_analyze', 'EXPLAIN output was not captured with ANALYZE enabled'));
  } else {
    checks.push(pass('explain_analyze', 'EXPLAIN output was captured with ANALYZE enabled'));
  }
  if (explain.wal !== true) {
    checks.push(fail('explain_wal', 'EXPLAIN output was not captured with WAL enabled'));
  } else {
    checks.push(pass('explain_wal', 'EXPLAIN output was captured with WAL enabled'));
  }
  if (explain.type !== 'mixed') {
    checks.push(fail('explain_workload', 'EXPLAIN output must use --type mixed so all ingestion event tables are exercised'));
  } else {
    checks.push(pass('explain_workload', 'EXPLAIN output used mixed workload'));
  }

  const planTexts = textSetFromRows(plans, ['label', 'statement']);
  const missingTables = requiredExplainTables.filter((table) => !containsTable(planTexts, table));
  if (missingTables.length > 0) {
    checks.push(fail('explain_table_coverage', `EXPLAIN output is missing required hot-path table evidence: ${missingTables.join(', ')}`));
  } else {
    checks.push(pass('explain_table_coverage', `EXPLAIN output covers ${requiredExplainTables.length} required hot-path table references`));
  }

  const missingWalTables = requiredExplainTables.filter((table) => !planRows
    .filter((plan) => explainPlanMentionsTable(plan, table))
    .some(explainPlanHasWal));
  if (missingWalTables.length > 0) {
    checks.push(fail('explain_wal_counters', `EXPLAIN output is missing WAL counter evidence for table(s): ${missingWalTables.join(', ')}`));
  } else {
    checks.push(pass('explain_wal_counters', `EXPLAIN output includes WAL counter evidence for ${requiredExplainTables.length} required hot-path table reference(s)`));
  }

  const missingTriggerTables = requiredTypedEventTriggerTables.filter((table) => !planRows
    .filter((plan) => explainPlanMentionsTable(plan, table))
    .some(explainPlanHasTriggerTiming));
  if (missingTriggerTables.length > 0) {
    checks.push(fail('explain_trigger_timing', `EXPLAIN output is missing trigger call/time evidence for typed event table(s): ${missingTriggerTables.join(', ')}`));
  } else {
    checks.push(pass('explain_trigger_timing', `EXPLAIN output includes trigger call/time evidence for ${requiredTypedEventTriggerTables.length} typed event table(s)`));
  }
  checks.unshift(pass('explain_content', `EXPLAIN output contains ${plans.length} captured plan(s)`));
  return checks;
}

function checkDbAudit(parsed: unknown): EvidenceCheck[] {
  const audit = object(parsed);
  if (!audit) return [fail('db_audit_content', 'DB audit output is not an object')];
  const tables = Array.isArray(audit.tables) ? audit.tables : [];
  const indexes = Array.isArray(audit.indexes) ? audit.indexes : [];
  const constraints = Array.isArray(audit.constraints) ? audit.constraints : [];
  const triggers = Array.isArray(audit.triggers) ? audit.triggers : [];
  const primaryAuthIndexes = Array.isArray(audit.primaryAuthIndexes) ? audit.primaryAuthIndexes : [];
  const pgbossTables = Array.isArray(audit.pgbossTables) ? audit.pgbossTables : [];
  const pgbossQueues = Array.isArray(audit.pgbossQueues) ? audit.pgbossQueues : [];
  if (tables.length === 0) return [fail('db_audit_content', 'DB audit has no captured tables')];
  if (indexes.length === 0) return [fail('db_audit_content', 'DB audit has no captured indexes')];
  if (constraints.length === 0) return [fail('db_audit_content', 'DB audit has no captured constraints')];

  const tableNames = textSetFromRows(tables, ['table_name']);
  for (const row of tables) {
    const table = object(row);
    const schemaName = typeof table?.schema_name === 'string' ? table.schema_name : null;
    const tableName = typeof table?.table_name === 'string' ? table.table_name : null;
    if (schemaName && tableName) tableNames.add(`${schemaName}.${tableName}`);
  }
  const missingTables = requiredIngestionTables.filter((table) => !tableNames.has(table));
  const checks = [
    pass(
      'db_audit_content',
      `DB audit captured tables=${tables.length}, indexes=${indexes.length}, constraints=${constraints.length}, triggers=${triggers.length}`,
    ),
  ];
  if (missingTables.length > 0) {
    checks.push(fail('db_audit_table_coverage', `DB audit is missing required ingestion table(s): ${missingTables.join(', ')}`));
  } else {
    checks.push(pass('db_audit_table_coverage', `DB audit covers ${requiredIngestionTables.length} required ingestion hot-path tables`));
  }
  const requestIndexNames = new Set<string>();
  for (const row of indexes) {
    const index = object(row);
    if (index?.table_name === 'events_requests' && typeof index.index_name === 'string') {
      requestIndexNames.add(index.index_name);
    }
  }
  const missingRequestIndexes = requiredRequestHotPathIndexes.filter((index) => !requestIndexNames.has(index));
  const presentForbiddenRequestIndexes = forbiddenRequestHotPathIndexes.filter((index) => requestIndexNames.has(index));
  if (missingRequestIndexes.length > 0 || presentForbiddenRequestIndexes.length > 0) {
    checks.push(fail(
      'db_audit_request_hot_path_indexes',
      `events_requests index state is not ingestion-optimized: missing required=${missingRequestIndexes.join(', ') || 'none'}; forbidden still present=${presentForbiddenRequestIndexes.join(', ') || 'none'}`,
    ));
  } else {
    checks.push(pass(
      'db_audit_request_hot_path_indexes',
      `events_requests keeps ${requiredRequestHotPathIndexes.length} required hot-path indexes and has removed ${forbiddenRequestHotPathIndexes.length} write-amplifying indexes`,
    ));
  }
  const typedEventTriggerRows = triggers
    .map(object)
    .filter((trigger): trigger is Record<string, unknown> => (
      trigger !== null
      && (
        trigger.trigger_name === 'trg_sync_typed_event_contract'
        || trigger.function_name === 'logdb_sync_typed_event_contract'
      )
    ));
  const typedEventTriggerTables = new Set(
    typedEventTriggerRows
      .map((trigger) => typeof trigger.table_name === 'string' ? trigger.table_name : null)
      .filter((table): table is string => table !== null),
  );
  const missingTypedEventTriggerTables = requiredTypedEventTriggerTables
    .filter((table) => !typedEventTriggerTables.has(table));
  const forbiddenTypedEventTriggerAttachments = forbiddenTypedEventTriggerTables
    .filter((table) => typedEventTriggerTables.has(table));
  if (missingTypedEventTriggerTables.length > 0 || forbiddenTypedEventTriggerAttachments.length > 0) {
    checks.push(fail(
      'db_audit_typed_event_trigger_attachment',
      `typed-event trigger attachment is not canonical: missing=${missingTypedEventTriggerTables.join(', ') || 'none'}; forbidden=${forbiddenTypedEventTriggerAttachments.join(', ') || 'none'}`,
    ));
  } else {
    checks.push(pass(
      'db_audit_typed_event_trigger_attachment',
      `typed-event trigger is attached to ${requiredTypedEventTriggerTables.length} canonical events tables and not attached to group tables`,
    ));
  }
  const typedEventFunctionSource = typedEventTriggerRows
    .map((trigger) => typeof trigger.function_source === 'string' ? trigger.function_source : '')
    .find((source) => source.includes('logdb_sync_typed_event_contract')) ?? '';
  const normalizedTypedEventFunctionSource = typedEventFunctionSource.replace(/\s+/g, ' ');
  const hasFastEnvironmentGuard = normalizedTypedEventFunctionSource
    .includes("NEW.metadata->>'environment' IS DISTINCT FROM NEW.environment");
  const hasOldUnconditionalMetadataRewrite = normalizedTypedEventFunctionSource
    .includes('NEW.metadata := jsonb_set( CASE WHEN jsonb_typeof');
  if (!typedEventFunctionSource) {
    checks.push(fail(
      'db_audit_typed_event_trigger_source',
      'DB audit is missing logdb_sync_typed_event_contract function source; rerun ingestion:db:audit without --no-functions',
    ));
  } else if (!hasFastEnvironmentGuard || hasOldUnconditionalMetadataRewrite) {
    checks.push(fail(
      'db_audit_typed_event_trigger_source',
      'logdb_sync_typed_event_contract is not the fast contract: missing environment mismatch guard or still has the old unconditional metadata rewrite',
    ));
  } else {
    checks.push(pass(
      'db_audit_typed_event_trigger_source',
      'logdb_sync_typed_event_contract uses the fast metadata guard instead of unconditional jsonb_set work',
    ));
  }
  const pgbossTableNames = textSetFromRows(pgbossTables, ['table_name']);
  for (const row of pgbossTables) {
    const table = object(row);
    const schemaName = typeof table?.schema_name === 'string' ? table.schema_name : null;
    const tableName = typeof table?.table_name === 'string' ? table.table_name : null;
    if (schemaName && tableName) pgbossTableNames.add(`${schemaName}.${tableName}`);
  }
  const missingPgbossTables = ['pgboss.job', 'pgboss.archive'].filter((table) => !pgbossTableNames.has(table));
  if (missingPgbossTables.length > 0) {
    checks.push(fail('db_audit_pgboss_tables', `DB audit is missing required primary pg-boss table(s): ${missingPgbossTables.join(', ')}`));
  } else {
    checks.push(pass('db_audit_pgboss_tables', 'DB audit covers primary pg-boss job and archive tables'));
  }
  const primaryIndexNames = textSetFromRows(primaryAuthIndexes, ['index_name']);
  const missingPrimaryIndexes = requiredPrimaryAuthIndexes.filter((index) => !primaryIndexNames.has(index));
  if (missingPrimaryIndexes.length > 0) {
    checks.push(fail('db_audit_primary_auth_indexes', `DB audit is missing required primary ingestion auth index(es): ${missingPrimaryIndexes.join(', ')}`));
  } else {
    checks.push(pass('db_audit_primary_auth_indexes', `${requiredPrimaryAuthIndexes.length} primary ingestion auth indexes are present`));
  }
  const queueByName = new Map<string, Record<string, unknown>>();
  for (const row of pgbossQueues) {
    const queue = object(row);
    if (typeof queue?.name === 'string') queueByName.set(queue.name, queue);
  }
  const missingQueues = requiredIngestQueues.filter((queue) => !queueByName.has(queue));
  const notifyMissing = requiredIngestQueues.filter((queue) => queueByName.get(queue)?.notify !== true);
  const unpartitioned = requiredIngestQueues.filter((queue) => queueByName.get(queue)?.partition !== true);
  if (missingQueues.length > 0) {
    checks.push(fail('db_audit_pgboss_queues', `DB audit is missing required pg-boss ingest queue(s): ${missingQueues.join(', ')}`));
  } else if (notifyMissing.length > 0 || unpartitioned.length > 0) {
    checks.push(fail(
      'db_audit_pgboss_queues',
      `pg-boss ingest queues need optimization: notify missing=${notifyMissing.join(', ') || 'none'}; unpartitioned=${unpartitioned.join(', ') || 'none'}`,
    ));
  } else {
    checks.push(pass('db_audit_pgboss_queues', `${requiredIngestQueues.length} ingest queues are notify-enabled and partitioned`));
  }
  return checks;
}

function checkDbRuntime(parsed: unknown): EvidenceCheck[] {
  const runtime = object(parsed);
  if (!runtime) return [fail('db_runtime_content', 'DB runtime diagnostic output is not an object')];
  const snapshots = Array.isArray(runtime.snapshots) ? runtime.snapshots : [];
  const deltas = Array.isArray(runtime.deltas) ? runtime.deltas : [];
  const tables = stringArray(runtime.tables);
  const checks: EvidenceCheck[] = [];

  if (snapshots.length < 2) {
    checks.push(fail('db_runtime_samples', `DB runtime diagnostic must contain at least 2 samples; found ${snapshots.length}`));
  } else {
    checks.push(pass('db_runtime_samples', `DB runtime diagnostic contains ${snapshots.length} sample(s)`));
  }

  const missingConfiguredTables = requiredIngestionTables.filter((table) => !tables.includes(table));
  if (missingConfiguredTables.length > 0) {
    checks.push(fail('db_runtime_table_config', `DB runtime diagnostic was not configured for required ingestion table(s): ${missingConfiguredTables.join(', ')}`));
  } else {
    checks.push(pass('db_runtime_table_config', `DB runtime diagnostic was configured for ${requiredIngestionTables.length} required ingestion table(s)`));
  }

  const lastSnapshot = object(snapshots[snapshots.length - 1]);
  const logDb = object(lastSnapshot?.logDb);
  const primaryDb = object(lastSnapshot?.primaryDb);
  const logDbPool = object(lastSnapshot?.logDbPool);
  const relationStats = Array.isArray(logDb?.relationStats) ? logDb.relationStats : [];
  const pgbossQueues = Array.isArray(primaryDb?.pgbossQueues) ? primaryDb.pgbossQueues : [];
  const pgbossRelationStats = Array.isArray(primaryDb?.pgbossRelationStats) ? primaryDb.pgbossRelationStats : [];
  const pgbossRelationSizes = Array.isArray(primaryDb?.pgbossRelationSizes) ? primaryDb.pgbossRelationSizes : [];
  const primaryWaitingActivity = Array.isArray(primaryDb?.waitingActivity) ? primaryDb.waitingActivity : null;
  const primaryLocks = Array.isArray(primaryDb?.locks) ? primaryDb.locks : null;

  if (!logDbPool || !object(logDbPool.primary)) {
    checks.push(fail('db_runtime_pool_stats', 'DB runtime diagnostic is missing Log DB pool stats'));
  } else {
    checks.push(pass('db_runtime_pool_stats', 'DB runtime diagnostic includes Log DB pool stats'));
  }

  const relationNames = textSetFromRows(relationStats, ['relname']);
  for (const row of relationStats) {
    const relation = object(row);
    const schemaName = typeof relation?.schemaname === 'string' ? relation.schemaname : null;
    const relName = typeof relation?.relname === 'string' ? relation.relname : null;
    if (schemaName && relName) relationNames.add(`${schemaName}.${relName}`);
  }
  const missingRelationStats = requiredIngestionTables.filter((table) => !relationNames.has(table));
  if (missingRelationStats.length > 0) {
    checks.push(fail('db_runtime_relation_stats', `DB runtime diagnostic is missing table stats for: ${missingRelationStats.join(', ')}`));
  } else {
    checks.push(pass('db_runtime_relation_stats', `DB runtime diagnostic includes table stats for ${requiredIngestionTables.length} required ingestion table(s)`));
  }

  const queueNames = textSetFromRows(pgbossQueues, ['name']);
  const missingQueues = requiredIngestQueues.filter((queue) => !queueNames.has(queue));
  if (missingQueues.length > 0) {
    checks.push(fail('db_runtime_pgboss_queues', `DB runtime diagnostic is missing pg-boss ingest queue(s): ${missingQueues.join(', ')}`));
  } else {
    checks.push(pass('db_runtime_pgboss_queues', `DB runtime diagnostic includes ${requiredIngestQueues.length} pg-boss ingest queue(s)`));
  }
  const pgbossRelationNames = textSetFromRows(pgbossRelationStats, ['relname']);
  if (!pgbossRelationNames.has('job') || !pgbossRelationNames.has('archive')) {
    checks.push(fail('db_runtime_pgboss_relation_stats', 'DB runtime diagnostic is missing primary pg-boss job/archive relation stats'));
  } else {
    checks.push(pass('db_runtime_pgboss_relation_stats', 'DB runtime diagnostic includes primary pg-boss job/archive relation stats'));
  }
  const pgbossSizeNames = textSetFromRows(pgbossRelationSizes, ['relation_name']);
  if (!pgbossSizeNames.has('job') || !pgbossSizeNames.has('archive')) {
    checks.push(fail('db_runtime_pgboss_relation_sizes', 'DB runtime diagnostic is missing primary pg-boss job/archive relation sizes'));
  } else {
    checks.push(pass('db_runtime_pgboss_relation_sizes', 'DB runtime diagnostic includes primary pg-boss job/archive relation sizes'));
  }
  if (!primaryWaitingActivity || !primaryLocks) {
    checks.push(fail('db_runtime_primary_wait_lock_sections', 'DB runtime diagnostic is missing primary pg-boss waiting activity or lock sections'));
  } else {
    checks.push(pass('db_runtime_primary_wait_lock_sections', 'DB runtime diagnostic includes primary pg-boss waiting activity and lock sections'));
  }

  if (deltas.length === 0) {
    checks.push(fail('db_runtime_deltas', 'DB runtime diagnostic has no counter deltas; capture it with --samples 2 or more during an active committed benchmark'));
  } else {
    checks.push(pass('db_runtime_deltas', `DB runtime diagnostic includes ${deltas.length} counter delta row(s)`));
  }

  const deltaRows = deltas.map(object).filter((row): row is Record<string, unknown> => row !== null);
  const primaryPgbossDeltas = deltaRows.filter((row) => row.scope === 'primary_pgboss_table' || row.scope === 'primary_pgboss_relation_size' || row.scope === 'primary_db_wal');
  if (primaryPgbossDeltas.length === 0) {
    checks.push(fail('db_runtime_primary_pgboss_deltas', 'DB runtime diagnostic is missing primary pg-boss/WAL deltas; capture with at least two samples while API enqueue is active'));
  } else {
    checks.push(pass('db_runtime_primary_pgboss_deltas', `DB runtime diagnostic includes ${primaryPgbossDeltas.length} primary pg-boss/WAL delta row(s)`));
  }
  const insertedDelta = deltaRows.find((row) => (
    row.scope === 'log_db_table'
    && row.metric === 'n_tup_ins'
    && finiteNumber(row.delta) !== null
    && finiteNumber(row.delta)! > 0
  ));
  if (!insertedDelta) {
    checks.push(fail('db_runtime_insert_activity', 'DB runtime diagnostic does not show a positive Log DB n_tup_ins delta; capture during a committed ingestion benchmark'));
  } else {
    checks.push(pass('db_runtime_insert_activity', 'DB runtime diagnostic shows positive Log DB insert activity during the capture window'));
  }

  const requestInsertedDelta = deltaRows.find((row) => (
    row.scope === 'log_db_table'
    && row.metric === 'n_tup_ins'
    && (row.relation === 'public.events_requests' || row.relation === 'events_requests')
    && finiteNumber(row.delta) !== null
    && finiteNumber(row.delta)! > 0
  ));
  if (!requestInsertedDelta) {
    checks.push(fail('db_runtime_request_insert_activity', 'DB runtime diagnostic does not show a positive events_requests n_tup_ins delta; capture during a committed request or mixed ingestion benchmark'));
  } else {
    checks.push(pass('db_runtime_request_insert_activity', 'DB runtime diagnostic shows positive events_requests insert activity during the capture window'));
  }

  const relationSizeDeltas = deltaRows.filter((row) => (
    row.scope === 'log_db_relation_size'
    && ['total_bytes', 'heap_bytes', 'indexes_bytes'].includes(String(row.metric))
    && finiteNumber(row.delta) !== null
  ));
  if (relationSizeDeltas.length === 0) {
    checks.push(fail('db_runtime_relation_size_deltas', 'DB runtime diagnostic has no relation-size deltas; capture with at least two samples so heap/index write amplification can be judged'));
  } else {
    checks.push(pass('db_runtime_relation_size_deltas', `DB runtime diagnostic includes ${relationSizeDeltas.length} relation-size delta row(s)`));
  }

  const missingRequestSizeMetrics = ['heap_bytes', 'indexes_bytes']
    .filter((metric) => !deltaRows.some((row) => (
      row.scope === 'log_db_relation_size'
      && row.metric === metric
      && (row.relation === 'public.events_requests' || row.relation === 'events_requests')
      && finiteNumber(row.delta) !== null
    )));
  if (missingRequestSizeMetrics.length > 0) {
    checks.push(fail(
      'db_runtime_request_relation_size_deltas',
      `DB runtime diagnostic is missing events_requests relation-size delta metric(s): ${missingRequestSizeMetrics.join(', ')}`,
    ));
  } else {
    checks.push(pass('db_runtime_request_relation_size_deltas', 'DB runtime diagnostic includes events_requests heap and index size deltas'));
  }

  return checks;
}

async function checkPrometheusScrape(path: string): Promise<EvidenceCheck> {
  if (!(await exists(path))) return fail('prometheus_scrape_file', `${path} is missing`);
  const content = await readFile(path, 'utf8');
  const required = [
    'scrape_configs:',
    'metrics_path: /metrics',
    'ingest_stage_latency_ms_.*',
    'ingest_db_pool_connections',
    'ingest_queue_depth_.*',
    'ingest_fairness_starvation_guard_admissions_total',
  ];
  const missing = required.filter((text) => !content.includes(text));
  if (missing.length > 0) return fail('prometheus_scrape_file', `${path} is missing required text: ${missing.join(', ')}`);
  return pass('prometheus_scrape_file', `${path} includes ingestion scrape path and required metric families`);
}

function checkGrafanaDashboard(parsed: unknown): EvidenceCheck {
  const dashboard = object(parsed);
  if (!dashboard) return fail('grafana_dashboard_content', 'Grafana dashboard is not an object');
  const panels = Array.isArray(dashboard.panels) ? dashboard.panels : [];
  if (panels.length === 0) return fail('grafana_dashboard_content', 'Grafana dashboard has no panels');
  const content = JSON.stringify(dashboard);
  const requiredMetrics = [
    'ingest_events_inserted_by_type_total',
    'ingest_batches_processed_by_type_total',
    'ingest_stage_latency_ms_quantile',
    'perType\\\\..*\\\\.durationMs',
    'ingest_processing_latency_ms_quantile',
    'ingest_e2e_latency_ms_quantile',
    'ingest_db_query_duration_ms_quantile',
    'ingest_db_pool_connections',
    'ingest_queue_depth_ready',
    'ingest_jobs_retried_total',
    'ingest_fairness_starvation_guard_admissions_total',
    'ingest_dlq_retained_jobs',
    'ingest_events_duplicate_total',
    '0.999',
  ];
  const missing = requiredMetrics.filter((metric) => !content.includes(metric));
  if (missing.length > 0) return fail('grafana_dashboard_content', `Grafana dashboard is missing required metric(s): ${missing.join(', ')}`);
  return pass('grafana_dashboard_content', `Grafana dashboard includes ${panels.length} ingestion observability panel(s)`);
}

function checkMetricsScrapeProof(parsed: unknown): EvidenceCheck {
  const proof = object(parsed);
  if (!proof) return fail('metrics_scrape_proof_content', 'metrics scrape proof is not an object');
  if (proof.passed !== true) return fail('metrics_scrape_proof_content', 'metrics scrape proof did not pass');
  if (Number(proof.status) !== 200) return fail('metrics_scrape_proof_content', `metrics scrape status was ${String(proof.status)}`);
  const checks = Array.isArray(proof.checks) ? proof.checks : [];
  if (checks.length === 0) return fail('metrics_scrape_proof_content', 'metrics scrape proof has no metric checks');
  const missing = checks
    .map(object)
    .filter((check) => check && check.present !== true)
    .map((check) => String(check?.metric ?? 'unknown'));
  if (missing.length > 0) {
    return fail('metrics_scrape_proof_content', `metrics scrape proof missing required metric(s): ${missing.join(', ')}`);
  }
  const samples = Array.isArray(proof.samples) ? proof.samples : [];
  if (samples.length === 0) return fail('metrics_scrape_proof_content', 'metrics scrape proof has no required sample checks');
  const missingSamples = samples
    .map(object)
    .filter((sample) => sample && sample.present !== true)
    .map((sample) => String(sample?.sample ?? 'unknown'));
  if (missingSamples.length > 0) {
    return fail('metrics_scrape_proof_content', `metrics scrape proof missing required sample(s): ${missingSamples.join(', ')}`);
  }
  return pass('metrics_scrape_proof_content', `metrics scrape proof passed with ${checks.length} required metric family check(s) and ${samples.length} required sample check(s)`);
}

function scenarioRows(parsed: unknown): Record<string, unknown>[] {
  if (Array.isArray(parsed)) return parsed.map(object).filter((item): item is Record<string, unknown> => item != null);
  const root = object(parsed);
  const scenarios = Array.isArray(root?.scenarios) ? root.scenarios : [];
  return scenarios.map(object).filter((item): item is Record<string, unknown> => item != null);
}

function normalizeScenarioName(value: unknown): string {
  if (typeof value !== 'string') return '';
  const normalized = value.trim().toLowerCase();
  return requiredFailureScenarios.find((scenario) => scenario.toLowerCase() === normalized) ?? value.trim();
}

async function checkFailureScenarios(parsed: unknown, path: string): Promise<EvidenceCheck[]> {
  const rows = scenarioRows(parsed);
  if (rows.length === 0) return [fail('failure_scenarios_content', 'failure scenarios artifact has no scenario rows')];

  const byScenario = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    const scenario = normalizeScenarioName(row.scenario);
    if (requiredFailureScenarios.includes(scenario)) byScenario.set(scenario, row);
  }

  const missing = requiredFailureScenarios.filter((scenario) => !byScenario.has(scenario));
  if (missing.length > 0) {
    return [fail('failure_scenarios_content', `failure scenarios artifact is missing required scenario(s): ${missing.join(', ')}`)];
  }

  const failed: string[] = [];
  const weak: string[] = [];
  const missingArtifacts: string[] = [];
  const baseDir = dirname(resolve(path));
  for (const scenario of requiredFailureScenarios) {
    const row = byScenario.get(scenario)!;
    if (row.status !== 'passed') failed.push(scenario);
    if (typeof row.evidence !== 'string' || !row.evidence.trim()) weak.push(`${scenario}: evidence`);
    if (typeof row.command !== 'string' || !row.command.trim()) weak.push(`${scenario}: command`);
    if (typeof row.artifact !== 'string' || !row.artifact.trim()) {
      weak.push(`${scenario}: artifact`);
      continue;
    }
    const artifactPath = isAbsolute(row.artifact) ? row.artifact : resolve(baseDir, row.artifact);
    if (!(await exists(artifactPath))) missingArtifacts.push(`${scenario}: ${row.artifact}`);
  }

  const checks = [
    pass('failure_scenarios_content', `failure scenarios artifact covers ${requiredFailureScenarios.length} required scenario(s)`),
  ];
  if (failed.length > 0) checks.push(fail('failure_scenarios_status', `scenario(s) did not pass: ${failed.join(', ')}`));
  else checks.push(pass('failure_scenarios_status', 'all required failure scenario statuses are passed'));
  if (weak.length > 0) checks.push(fail('failure_scenarios_metadata', `scenario rows are missing required metadata: ${weak.join(', ')}`));
  else checks.push(pass('failure_scenarios_metadata', 'all scenario rows include evidence, command, and artifact metadata'));
  if (missingArtifacts.length > 0) checks.push(fail('failure_scenarios_artifacts', `scenario artifact file(s) are missing: ${missingArtifacts.join(', ')}`));
  else checks.push(pass('failure_scenarios_artifacts', 'all scenario artifact file references exist'));
  return checks;
}

async function main(): Promise<void> {
  const config = parseArgs();
  const checks: EvidenceCheck[] = [];

  const benchmarkMatrix = await checkJsonFile(config.benchmarkMatrixPath, 'benchmark_matrix_file');
  checks.push(benchmarkMatrix.check, ...checkBenchmarkMatrix(benchmarkMatrix.parsed));
  checks.push(...await checkBenchmarkSummary(config.benchmarkSummaryPath));

  const matrixCompare = await checkJsonFile(config.matrixComparePath, 'matrix_compare_file');
  checks.push(matrixCompare.check, ...checkMatrixCompare(matrixCompare.parsed));

  const explain = await checkJsonFile(config.explainPath, 'explain_file');
  checks.push(explain.check, ...checkExplain(explain.parsed));
  checks.push(await checkExplainSummary(config.explainSummaryPath));

  const dbAudit = await checkJsonFile(config.dbAuditPath, 'db_audit_file');
  checks.push(dbAudit.check, ...checkDbAudit(dbAudit.parsed));
  checks.push(await checkDbAuditSummary(config.dbAuditSummaryPath));
  const dbRuntime = await checkJsonFile(config.dbRuntimePath, 'db_runtime_file');
  checks.push(dbRuntime.check, ...checkDbRuntime(dbRuntime.parsed));
  checks.push(await checkDbRuntimeSummary(config.dbRuntimeSummaryPath));
  checks.push(await checkAdmissionSummary(config.admissionSummaryPath));
  checks.push(await checkWorkerSummary(config.workerSummaryPath));
  checks.push(await checkTriageSummary(config.triageSummaryPath));

  checks.push(await checkPrometheusScrape(config.prometheusScrapePath));
  const grafanaDashboard = await checkJsonFile(config.grafanaDashboardPath, 'grafana_dashboard_file');
  checks.push(grafanaDashboard.check, checkGrafanaDashboard(grafanaDashboard.parsed));
  const metricsScrapeProof = await checkJsonFile(config.metricsScrapeProofPath, 'metrics_scrape_proof_file');
  checks.push(metricsScrapeProof.check, checkMetricsScrapeProof(metricsScrapeProof.parsed));
  const failureScenarios = await checkJsonFile(config.failureScenariosPath, 'failure_scenarios_file');
  checks.push(failureScenarios.check, ...await checkFailureScenarios(failureScenarios.parsed, config.failureScenariosPath));

  checks.push(...await checkTestReport(config.testReportPath));

  const passed = checks.every((check) => check.status === 'passed');
  const output = {
    passed,
    checkedAt: new Date().toISOString(),
    checks,
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
