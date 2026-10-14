/**
 * Summarize ingestion_profile JSON logs into worker hot-path evidence.
 */
import { readFile, writeFile } from 'fs/promises';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

type OutputFormat = 'markdown' | 'json';

interface SummaryConfig {
  logsPath: string;
  format: OutputFormat;
  outPath: string | null;
}

interface Percentiles {
  count: number;
  min: number | null;
  p50: number | null;
  p95: number | null;
  p99: number | null;
  max: number | null;
}

interface WorkerProfile {
  phase?: string;
  queue?: string;
  eventType?: string;
  failureClass?: string;
  sqlState?: string;
  received?: number;
  validated?: number;
  rejected?: number;
  inserted?: number;
  duplicates?: number;
  outboxInserted?: number;
  batchBytes?: number;
  dbQueries?: number;
  dbQueryMs?: number;
  queueWaitMs?: number;
  writeAdmissionWaitMs?: number;
  dbConnectionWaitMs?: number;
  beginMs?: number;
  insertMs?: number;
  commitMs?: number;
  rollbackMs?: number;
  transactionMs?: number;
  outboxMs?: number;
  usageAccountingMs?: number;
  serializationMs?: number;
  validationMs?: number;
  normalizationMs?: number;
  totalProcessingMs?: number;
  perType?: Record<string, { received?: number; inserted?: number; durationMs?: number }>;
}

interface EventTypeSummary {
  eventType: string;
  profiles: number;
  received: number;
  inserted: number;
  rejected: number;
  failed: number;
  insertMs: Percentiles;
  commitMs: Percentiles;
  totalProcessingMs: Percentiles;
}

interface FailureSummary {
  failureClass: string;
  profiles: number;
  received: number;
  totalProcessingMs: Percentiles;
  rollbackMs: Percentiles;
}

interface PerTypeSummary {
  eventType: string;
  profiles: number;
  received: number;
  inserted: number;
  durationMs: Percentiles;
}

interface WorkerSummary {
  profiles: number;
  successful: number;
  failed: number;
  received: number;
  validated: number;
  rejected: number;
  inserted: number;
  duplicates: number;
  outboxInserted: number;
  batchBytes: number;
  dbQueries: number;
  dbQueryMs: number;
  successStages: Record<string, Percentiles>;
  failedStages: Record<string, Percentiles>;
  eventTypes: EventTypeSummary[];
  failureClasses: FailureSummary[];
  perType: PerTypeSummary[];
  diagnosticClassification: string[];
  findings: string[];
}

function usage(): void {
  console.error(`Usage:
  npm run ingestion:worker:summary -- --logs production-worker.jsonl [--format markdown|json] [--out artifacts/ingestion-worker-summary.md]
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

  const logsPath = args.logs;
  if (typeof logsPath !== 'string') usage();
  if (typeof logsPath !== 'string') process.exit(2);
  return {
    logsPath,
    format: args.format === 'json' ? 'json' : 'markdown',
    outPath: typeof args.out === 'string' ? args.out : null,
  };
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function finite(value: unknown): number | null {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function percentile(sorted: number[], pct: number): number | null {
  if (sorted.length === 0) return null;
  const index = Math.min(sorted.length - 1, Math.ceil((pct / 100) * sorted.length) - 1);
  return sorted[index] ?? null;
}

function percentiles(values: number[]): Percentiles {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return {
    count: sorted.length,
    min: sorted[0] ?? null,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    max: sorted[sorted.length - 1] ?? null,
  };
}

function round(value: number | null): number | null {
  return value === null ? null : Math.round(value * 100) / 100;
}

function rounded(stats: Percentiles): Percentiles {
  return {
    count: stats.count,
    min: round(stats.min),
    p50: round(stats.p50),
    p95: round(stats.p95),
    p99: round(stats.p99),
    max: round(stats.max),
  };
}

function stageStats(profiles: WorkerProfile[], stages: string[]): Record<string, Percentiles> {
  const output: Record<string, Percentiles> = {};
  for (const stage of stages) {
    output[stage] = rounded(percentiles(profiles
      .map((profile) => finite((profile as unknown as Record<string, unknown>)[stage]))
      .filter((value): value is number => value !== null)));
  }
  return output;
}

async function readProfiles(path: string): Promise<WorkerProfile[]> {
  const content = await readFile(path, 'utf8');
  const profiles: WorkerProfile[] = [];
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const row = object(parsed);
    if (row?.phase !== 'ingestion_profile' && row?.phase !== 'ingestion_profile_failed') continue;
    profiles.push(row as unknown as WorkerProfile);
  }
  return profiles;
}

function summarizeByEventType(profiles: WorkerProfile[]): EventTypeSummary[] {
  const grouped = new Map<string, WorkerProfile[]>();
  for (const profile of profiles) {
    const eventType = profile.eventType ?? 'unknown';
    grouped.set(eventType, [...(grouped.get(eventType) ?? []), profile]);
  }

  return [...grouped.entries()]
    .map(([eventType, rows]) => ({
      eventType,
      profiles: rows.length,
      received: sum(rows, 'received'),
      inserted: sum(rows, 'inserted'),
      rejected: sum(rows, 'rejected'),
      failed: rows.filter((row) => row.phase === 'ingestion_profile_failed').length,
      insertMs: rounded(percentiles(values(rows, 'insertMs'))),
      commitMs: rounded(percentiles(values(rows, 'commitMs'))),
      totalProcessingMs: rounded(percentiles(values(rows, 'totalProcessingMs'))),
    }))
    .sort((a, b) => (b.totalProcessingMs.p95 ?? -1) - (a.totalProcessingMs.p95 ?? -1));
}

function summarizeFailures(profiles: WorkerProfile[]): FailureSummary[] {
  const grouped = new Map<string, WorkerProfile[]>();
  for (const profile of profiles.filter((row) => row.phase === 'ingestion_profile_failed')) {
    const failureClass = profile.failureClass ?? profile.sqlState ?? 'unknown';
    grouped.set(failureClass, [...(grouped.get(failureClass) ?? []), profile]);
  }

  return [...grouped.entries()]
    .map(([failureClass, rows]) => ({
      failureClass,
      profiles: rows.length,
      received: sum(rows, 'received'),
      totalProcessingMs: rounded(percentiles(values(rows, 'totalProcessingMs'))),
      rollbackMs: rounded(percentiles(values(rows, 'rollbackMs'))),
    }))
    .sort((a, b) => b.profiles - a.profiles);
}

function summarizePerType(profiles: WorkerProfile[]): PerTypeSummary[] {
  const grouped = new Map<string, Array<{ received: number; inserted: number; durationMs: number | null }>>();
  for (const profile of profiles) {
    const perType = object(profile.perType);
    if (!perType) continue;
    for (const [eventType, stats] of Object.entries(perType)) {
      const row = object(stats);
      if (!row) continue;
      const rows = grouped.get(eventType) ?? [];
      rows.push({
        received: finite(row.received) ?? 0,
        inserted: finite(row.inserted) ?? 0,
        durationMs: finite(row.durationMs),
      });
      grouped.set(eventType, rows);
    }
  }

  return [...grouped.entries()]
    .map(([eventType, rows]) => ({
      eventType,
      profiles: rows.length,
      received: rows.reduce((total, row) => total + row.received, 0),
      inserted: rows.reduce((total, row) => total + row.inserted, 0),
      durationMs: rounded(percentiles(rows.map((row) => row.durationMs).filter((value): value is number => value !== null))),
    }))
    .sort((a, b) => (b.durationMs.p95 ?? -1) - (a.durationMs.p95 ?? -1));
}

function values(profiles: WorkerProfile[], field: keyof WorkerProfile): number[] {
  return profiles.map((profile) => finite(profile[field])).filter((value): value is number => value !== null);
}

function sum(profiles: WorkerProfile[], field: keyof WorkerProfile): number {
  return values(profiles, field).reduce((total, value) => total + value, 0);
}

export function summarize(profiles: WorkerProfile[]): WorkerSummary {
  const successful = profiles.filter((profile) => profile.phase === 'ingestion_profile');
  const failed = profiles.filter((profile) => profile.phase === 'ingestion_profile_failed');
  const successStages = stageStats(successful, [
    'totalProcessingMs',
    'queueWaitMs',
    'writeAdmissionWaitMs',
    'dbConnectionWaitMs',
    'beginMs',
    'insertMs',
    'commitMs',
    'transactionMs',
    'outboxMs',
    'usageAccountingMs',
    'serializationMs',
    'validationMs',
    'normalizationMs',
    'dbQueryMs',
  ]);
  const failedStages = stageStats(failed, [
    'totalProcessingMs',
    'queueWaitMs',
    'writeAdmissionWaitMs',
    'dbConnectionWaitMs',
    'beginMs',
    'insertMs',
    'rollbackMs',
    'transactionMs',
    'dbQueryMs',
  ]);
  const failureClasses = summarizeFailures(profiles);
  const eventTypes = summarizeByEventType(profiles);
  const perType = summarizePerType(profiles);

  const findings: string[] = [];
  const diagnosticClassification: string[] = [];
  if (profiles.length === 0) {
    findings.push('No worker ingestion profile rows found.');
    diagnosticClassification.push('No worker profile rows were available to classify.');
  }
  if (failureClasses.length > 0) {
    const top = failureClasses[0];
    findings.push(`Top failed transaction class was ${top.failureClass} with ${top.profiles} profile(s).`);
    if (failureClasses.some((row) => row.failureClass === 'db_lock_timeout')) {
      findings.push('db_lock_timeout rows indicate PostgreSQL lock contention; inspect runtime lock wait evidence before changing concurrency.');
    }
    if (failureClasses.some((row) => row.failureClass === 'db_statement_timeout')) {
      findings.push('db_statement_timeout rows indicate a bounded slow SQL statement; capture EXPLAIN and runtime DB diagnostics for the same workload.');
    }
    if (failureClasses.some((row) => row.failureClass === 'db_connection')) {
      findings.push('db_connection rows indicate database connectivity or pool health pressure.');
    }
  }

  const requestRows = eventTypes.filter((row) => row.eventType === 'request');
  const requestInsertP95 = requestRows[0]?.insertMs.p95 ?? 0;
  const successfulWriteAdmissionWaitP95 = successStages.writeAdmissionWaitMs?.p95 ?? 0;
  const failedWriteAdmissionWaitP95 = failedStages.writeAdmissionWaitMs?.p95 ?? 0;
  const writeAdmissionWaitP95 = Math.max(
    successfulWriteAdmissionWaitP95,
    failedWriteAdmissionWaitP95,
  );
  const dbConnectionWaitP95 = successStages.dbConnectionWaitMs?.p95 ?? 0;
  const commitP95 = successStages.commitMs?.p95 ?? 0;
  const insertP95 = successStages.insertMs?.p95 ?? 0;
  const totalP95 = successStages.totalProcessingMs?.p95 ?? 0;
  const transactionP95 = successStages.transactionMs?.p95 ?? 0;
  const insertCommitP95 = insertP95 + commitP95;
  if (totalP95 > 1000 && insertCommitP95 > Math.max(1000, totalP95 * 0.7) && dbConnectionWaitP95 < 100) {
    diagnosticClassification.push(`Log DB write path bottleneck: insert p95 ${insertP95}ms plus commit p95 ${commitP95}ms dominates total p95 ${totalP95}ms while DB connection wait p95 is ${dbConnectionWaitP95}ms.`);
    diagnosticClassification.push('Next proof required: capture ingestion:db:runtime during the same workload and compare Log DB lock waits, WAL sync time, relation/index growth, dead tuples, and EXPLAIN trigger/WAL evidence.');
  }
  if (totalP95 > 1000 && transactionP95 > Math.max(1000, totalP95 * 0.7)) {
    diagnosticClassification.push(`Transaction-bound worker latency: transaction p95 ${transactionP95}ms accounts for most of total p95 ${totalP95}ms.`);
  }
  if (writeAdmissionWaitP95 > 100) {
    diagnosticClassification.push(`Write-admission saturation: admission wait p95 ${writeAdmissionWaitP95}ms is high; compare queued permits, worker demand, and the configured Log DB write capacity before increasing concurrency.`);
  }
  if (dbConnectionWaitP95 > 100) {
    diagnosticClassification.push(`Log DB pool acquisition pressure: DB connection wait p95 ${dbConnectionWaitP95}ms remains high after admission and must be compared with pool health and non-ingestion pool users.`);
  }
  if (diagnosticClassification.length === 0 && profiles.length > 0) {
    diagnosticClassification.push('No single worker bottleneck classification crossed the built-in thresholds; inspect stage tables and runtime DB evidence.');
  }
  if (requestInsertP95 > 1000 && dbConnectionWaitP95 < 100) {
    findings.push(`Request typed insert p95 is ${requestInsertP95}ms while DB connection wait p95 is ${dbConnectionWaitP95}ms; the bottleneck is inside Log DB write/trigger/index/WAL/storage work, not pool acquisition.`);
  }
  if (commitP95 > 1000) {
    findings.push(`Commit p95 is ${commitP95}ms; capture WAL/fsync/checkpoint evidence with ingestion:db:runtime before changing synchronous_commit.`);
  }
  if (writeAdmissionWaitP95 > 100) {
    findings.push(`Write admission wait p95 is ${writeAdmissionWaitP95}ms; workers are queueing before pool checkout, so this is admission-capacity pressure rather than pool acquisition time.`);
  }
  if (dbConnectionWaitP95 > 100) {
    findings.push(`DB connection wait p95 is ${dbConnectionWaitP95}ms; compare worker concurrency against Log DB pool capacity.`);
  }
  const duplicates = sum(successful, 'duplicates');
  if (duplicates > 0) {
    findings.push(`${duplicates} duplicate event(s) were reported; verify idempotency behavior in benchmark and runtime evidence.`);
  }
  if (findings.length === 0) {
    findings.push('No obvious worker pressure above thresholds was visible in the profile rows.');
  }

  return {
    profiles: profiles.length,
    successful: successful.length,
    failed: failed.length,
    received: sum(profiles, 'received'),
    validated: sum(profiles, 'validated'),
    rejected: sum(profiles, 'rejected'),
    inserted: sum(successful, 'inserted'),
    duplicates: sum(successful, 'duplicates'),
    outboxInserted: sum(successful, 'outboxInserted'),
    batchBytes: sum(profiles, 'batchBytes'),
    dbQueries: sum(profiles, 'dbQueries'),
    dbQueryMs: Math.round(sum(profiles, 'dbQueryMs') * 100) / 100,
    successStages,
    failedStages,
    eventTypes,
    failureClasses,
    perType,
    diagnosticClassification,
    findings,
  };
}

function renderNumber(value: number | null): string {
  return value === null ? '' : String(value);
}

function renderPercentileRow(label: string, stats: Percentiles): string {
  return `| ${label} | ${stats.count} | ${renderNumber(stats.min)} | ${renderNumber(stats.p50)} | ${renderNumber(stats.p95)} | ${renderNumber(stats.p99)} | ${renderNumber(stats.max)} |`;
}

export function renderMarkdown(summary: WorkerSummary): string {
  return [
    '# Ingestion Worker Profile Summary',
    '',
    `Profiles: ${summary.profiles}`,
    '',
    '## Totals',
    '',
    '| Metric | Value |',
    '| --- | ---: |',
    `| Successful profiles | ${summary.successful} |`,
    `| Failed profiles | ${summary.failed} |`,
    `| Received | ${summary.received} |`,
    `| Validated | ${summary.validated} |`,
    `| Rejected | ${summary.rejected} |`,
    `| Inserted | ${summary.inserted} |`,
    `| Duplicates | ${summary.duplicates} |`,
    `| Outbox inserted | ${summary.outboxInserted} |`,
    `| Batch bytes | ${summary.batchBytes} |`,
    `| DB queries | ${summary.dbQueries} |`,
    `| DB query ms | ${summary.dbQueryMs} |`,
    '',
    '## Successful Stage Latency',
    '',
    '| Stage | Count | Min ms | p50 ms | p95 ms | p99 ms | Max ms |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...Object.entries(summary.successStages).map(([stage, stats]) => renderPercentileRow(stage, stats)),
    '',
    '## Failed Transaction Latency',
    '',
    '| Stage | Count | Min ms | p50 ms | p95 ms | p99 ms | Max ms |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...Object.entries(summary.failedStages).map(([stage, stats]) => renderPercentileRow(stage, stats)),
    '',
    '## Event Type Summary',
    '',
    '| Event type | Profiles | Received | Inserted | Rejected | Failed | Insert p95 ms | Commit p95 ms | Total p95 ms |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...summary.eventTypes.map((row) => `| ${row.eventType} | ${row.profiles} | ${row.received} | ${row.inserted} | ${row.rejected} | ${row.failed} | ${renderNumber(row.insertMs.p95)} | ${renderNumber(row.commitMs.p95)} | ${renderNumber(row.totalProcessingMs.p95)} |`),
    '',
    '## Failure Classes',
    '',
    '| Failure class | Profiles | Received | Total p95 ms | Rollback p95 ms |',
    '| --- | ---: | ---: | ---: | ---: |',
    ...summary.failureClasses.map((row) => `| ${row.failureClass} | ${row.profiles} | ${row.received} | ${renderNumber(row.totalProcessingMs.p95)} | ${renderNumber(row.rollbackMs.p95)} |`),
    '',
    '## Per-Type Typed Insert Latency',
    '',
    '| Event type | Profiles | Received | Inserted | Duration p50 ms | Duration p95 ms | Duration p99 ms |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...summary.perType.map((row) => `| ${row.eventType} | ${row.profiles} | ${row.received} | ${row.inserted} | ${renderNumber(row.durationMs.p50)} | ${renderNumber(row.durationMs.p95)} | ${renderNumber(row.durationMs.p99)} |`),
    '',
    '## Diagnostic Classification',
    '',
    ...summary.diagnosticClassification.map((classification) => `- ${classification}`),
    '',
    '## Findings',
    '',
    ...summary.findings.map((finding) => `- ${finding}`),
    '',
  ].join('\n');
}

async function main(): Promise<void> {
  const config = parseArgs();
  const profiles = await readProfiles(config.logsPath);
  const summary = summarize(profiles);
  const output = config.format === 'json'
    ? `${JSON.stringify(summary, null, 2)}\n`
    : renderMarkdown(summary);
  if (config.outPath) await writeFile(config.outPath, output, 'utf8');
  process.stdout.write(output);
}

const entrypoint = process.argv[1] ? resolve(process.argv[1]) : null;
if (entrypoint === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
